import { Address } from '@ton/ton'
import { SenderFactory, type EvmProxyMsg } from '@tonappchain/sdk'
import axios from 'axios'
import { ethers } from 'ethers'

import type { Opportunity, REULLock, Reward, RewardsResponseItem, RewardToken } from '~/entities/merkl'

const {
  MERKL_API_BASE_URL,
  MERKL_EULER_CHAIN_ID,
  MERKL_PROXY,
  MERKL_TAC_SA_FACTORY,
  EVM_PROVIDER_URL,
  REUL_TOKEN_CONTRACT_ADDRESS,
  EUL_TOKEN_CONTRACT_ADDRESS,
} = useConfig()

const endpoints = {
  tokens: `${MERKL_API_BASE_URL}/tokens/reward`,
  opportunities: `${MERKL_API_BASE_URL}/opportunities/campaigns`,
  rewards: (addr: string) => `${MERKL_API_BASE_URL}/users/${addr}/rewards`,
  campaignById: (id: string) => `${MERKL_API_BASE_URL}/campaigns/${id}`,
}

const { friendlyAddress, tonConnectUI } = useTonConnect()

const address = ref('')

const lendOpportunities: Ref<Opportunity[]> = ref([])
const borrowOpportunities: Ref<Opportunity[]> = ref([])
const rewards: Ref<Reward[]> = ref([])
const rewardTokens: Ref<RewardToken[]> = ref([])
const isTokensLoading = ref(true)
const isOpportunitiesLoading = ref(true)
const isRewardsLoading = ref(true)
const isLocksLoading = ref(true)
const locks: Ref<REULLock[]> = ref([])

let interval: NodeJS.Timeout | null = null

const loadTokens = async (isInitialLoading = true) => {
  try {
    if (isInitialLoading) {
      isTokensLoading.value = true
    }
    const res = await axios.get(endpoints.tokens, {
      params: {
        chainId: MERKL_EULER_CHAIN_ID,
      },
    })

    const data: RewardToken[] = res.data[MERKL_EULER_CHAIN_ID]
    rewardTokens.value = data
  }
  catch (e) {
    console.warn(e)
  }
  finally {
    isTokensLoading.value = false
  }
}

const loadOpportunities = async (isInitialLoading = true) => {
  try {
    if (isInitialLoading) {
      isOpportunitiesLoading.value = true
    }
    const res = await axios.get(endpoints.opportunities, {
      params: {
        type: 'EULER',
        chainId: MERKL_EULER_CHAIN_ID,
      },
    })

    const opportunities: Opportunity[] = res.data

    if (opportunities) {
      const lends = []
      const borrows = []

      for (let i = 0; i < opportunities.length; i++) {
        if (opportunities[i].status === 'LIVE') {
          switch (opportunities[i].action) {
            case 'BORROW':
              borrows.push(opportunities[i])
              break
            case 'LEND':
              lends.push(opportunities[i])
              break
            default:
              break
          }
        }
      }

      lendOpportunities.value = lends
      borrowOpportunities.value = borrows
    }
  }
  catch (e) {
    console.warn(e)
  }
  finally {
    isOpportunitiesLoading.value = false
  }
}
const loadRewards = async (isInitialLoading = true) => {
  await until(address).toBeTruthy()
  try {
    if (!address.value) {
      rewards.value = []
      return
    }
    if (isInitialLoading) {
      isRewardsLoading.value = true
    }
    const res = await axios.get(endpoints.rewards(address.value), {
      params: {
        chainId: MERKL_EULER_CHAIN_ID,
      },
    })

    const data = res.data

    const rewardsList: Reward[] = data
      .reduce((prev: Reward[], curr: RewardsResponseItem) => {
        return [...prev, ...curr.rewards]
      }, [] as Reward[])

    rewards.value = rewardsList.filter(reward => reward.claimed !== reward.amount)
  }
  catch (e) {
    console.warn(e)
  }
  finally {
    isRewardsLoading.value = false
  }
}
const claimReward = async (reward: Reward) => {
  const { isLoaded } = useTacSdk()
  await until(isLoaded).toBeTruthy()
  const { tacSdk } = useTacSdk()

  const encodedArguments = new ethers.AbiCoder().encode(
    ['tuple(address[],uint256[],bytes32[][],bool)'],
    [[
      [reward.token.address],
      [reward.amount],
      [reward.proofs],
      reward.token.symbol !== 'rEUL',
    ]],
  )
  const evmProxyMsg: EvmProxyMsg = {
    evmTargetAddress: MERKL_PROXY,
    methodName: 'claim(bytes,bytes)',
    encodedParameters: encodedArguments,
  }
  const sender = await SenderFactory.getSender({ tonConnect: tonConnectUI })

  const res = await tacSdk.sendCrossChainTransaction(
    evmProxyMsg,
    sender,
  )
  tacSdk.closeConnections()

  const tsResult = res?.sendTransactionResult as {
    success: boolean
    error: Record<string, unknown>
  }
  if (!tsResult?.success) {
    throw tsResult?.error?.info || 'Unknown error'
  }

  return res
}
const loadREULLocksInfo = async (isInitialLoading = true) => {
  await until(address).toBeTruthy()
  try {
    if (!address.value) {
      locks.value = []
      return
    }
    if (isInitialLoading) {
      isLocksLoading.value = true
    }

    const provider = ethers.getDefaultProvider(EVM_PROVIDER_URL)
    const contract = new ethers.Contract(REUL_TOKEN_CONTRACT_ADDRESS, [
      'function getLockedAmounts(address account) view returns (uint256[], uint256[])',
      'function getWithdrawAmountsByLockTimestamp(address account, uint256 lockTimestamp) view returns (uint256, uint256)',
      'function withdrawToByLockTimestamp(address account, uint256 lockTimestamp, bool allowRemainderLoss) external',
    ], provider)

    const [lockTimestamps, amounts] = await contract.getLockedAmounts(address.value)
    const withdrawAmountsData: { unlockableAmount: bigint, amountToBeBurned: bigint }[] = []

    const batchSize = 5

    for (let i = 0; i < lockTimestamps.length; i += batchSize) {
      const batch = lockTimestamps
        .slice(i, i + batchSize)
        .map(async (timestamp: string) => {
          const [unlockableAmount, amountToBeBurned] = await contract.getWithdrawAmountsByLockTimestamp(address.value, timestamp)
          return {
            unlockableAmount,
            amountToBeBurned,
          }
        })

      withdrawAmountsData.push(...(await Promise.all(batch)))
    }

    locks.value = withdrawAmountsData.map((item, index) => ({
      timestamp: lockTimestamps[index],
      amount: amounts[index],
      unlockableAmount: item.unlockableAmount,
      amountToBeBurned: item.amountToBeBurned,
    }))
  }
  catch (e) {
    console.warn(e)
  }
  finally {
    isLocksLoading.value = false
  }
}
const unlockREUL = async (lockTimestamps: bigint[]) => {
  const { isLoaded } = useTacSdk()
  await until(isLoaded).toBeTruthy()
  const { tacSdk } = useTacSdk()
  // const oneTimestampFunctionSelector = '0xd47d9de6'
  const manyTimestampsFunctionSelector = '0x4f570258'

  const withdrawToByLockTimestampData = new ethers.AbiCoder().encode(
    ['tuple(uint256[],bool)'],
    [[lockTimestamps, true]],
  )

  const encodedArguments = new ethers.AbiCoder().encode(
    ['tuple(address,bytes4[],bytes[],address[])'],
    [[
      REUL_TOKEN_CONTRACT_ADDRESS,
      [manyTimestampsFunctionSelector],
      [withdrawToByLockTimestampData],
      [EUL_TOKEN_CONTRACT_ADDRESS],
    ]],
  )
  const evmProxyMsg: EvmProxyMsg = {
    evmTargetAddress: MERKL_PROXY,
    methodName: 'customFunctionCall(bytes,bytes)',
    encodedParameters: encodedArguments,
  }

  const sender = await SenderFactory.getSender({ tonConnect: tonConnectUI })
  const res = await tacSdk.sendCrossChainTransaction(evmProxyMsg, sender)
  tacSdk.closeConnections()

  const tsResult = res?.sendTransactionResult as {
    success: boolean
    error: Record<string, unknown>
  }
  if (!tsResult?.success) {
    throw tsResult?.error?.info || 'Unknown error'
  }

  return res
}
const initMerkl = async (tvmAddress: string | undefined) => {
  address.value = ''

  if (!tvmAddress) {
    return
  }

  try {
    const provider = ethers.getDefaultProvider(EVM_PROVIDER_URL)
    const tacFactoryAbi = ['function predictSmartAccountAddress(string, address) external view returns(address)']
    const addressContract = new ethers.Contract(MERKL_TAC_SA_FACTORY, tacFactoryAbi, provider)
    address.value = await addressContract.predictSmartAccountAddress(Address.parse(tvmAddress).toString({ bounceable: true }), MERKL_PROXY)
  }
  catch (e) {
    console.warn(e)
    address.value = ''
  }
}

const getOpportunityOfLendVault = (vaultAddress: string) => {
  return lendOpportunities.value.find(opportunity => opportunity.identifier === vaultAddress)
}

const getOpportunityOfBorrowVault = (assetAddress: string) => {
  return borrowOpportunities.value.find(opportunity => !!(opportunity.tokens.find(tokenInfo => tokenInfo.address === assetAddress)))
}

watch(friendlyAddress, (val) => {
  initMerkl(val)
  loadOpportunities()
  loadTokens()
  loadRewards()
  loadREULLocksInfo()
  if (val) {
    if (!interval) {
      interval = setInterval(() => {
        // loadRewards(false)
        // loadOpportunities(false)
        loadTokens(false)
        // loadREULLocksInfo(false)
      }, 10000)
    }
  }
  else {
    if (interval) {
      clearInterval(interval)
      interval = null
    }
  }
}, { immediate: true })

export const useMerkl = () => {
  return {
    lendOpportunities,
    borrowOpportunities,
    rewards,
    rewardTokens,
    locks,
    isTokensLoading,
    isOpportunitiesLoading,
    isRewardsLoading,
    isLocksLoading,
    claimReward,
    initMerkl,
    loadOpportunities,
    loadTokens,
    loadRewards,
    getOpportunityOfLendVault,
    getOpportunityOfBorrowVault,
    loadREULLocksInfo,
    unlockREUL,
  }
}
