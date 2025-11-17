import { SenderFactory, type EvmProxyMsg } from '@tonappchain/sdk'
import { useAccount } from '@wagmi/vue'
import axios from 'axios'
import { ethers } from 'ethers'

import type { Opportunity, Reward, RewardsResponseItem, RewardToken } from '~/entities/merkl'

const {
  MERKL_API_BASE_URL,
  MERKL_PROXY,
} = useEulerConfig()

const endpoints = {
  tokens: `${MERKL_API_BASE_URL}/tokens/reward`,
  opportunities: `${MERKL_API_BASE_URL}/opportunities/campaigns`,
  rewards: (addr: string) => `${MERKL_API_BASE_URL}/users/${addr}/rewards`,
  campaignById: (id: string) => `${MERKL_API_BASE_URL}/campaigns/${id}`,
}
const { tonConnectUI } = useTonConnect()

const address = ref('')

const isLoaded = ref(false)
const lendOpportunities: Ref<Opportunity[]> = ref([])
const borrowOpportunities: Ref<Opportunity[]> = ref([])
const rewards: Ref<Reward[]> = ref([])
const rewardTokens: Ref<RewardToken[]> = ref([])
const isTokensLoading = ref(true)
const isOpportunitiesLoading = ref(true)
const isRewardsLoading = ref(true)

let interval: NodeJS.Timeout | null = null

const loadTokens = async (isInitialLoading = true) => {
  try {
    if (isInitialLoading) {
      isTokensLoading.value = true
    }
    const res = await axios.get(endpoints.tokens, {
      params: {
        chainId: 1,
      },
    })

    const data: RewardToken[] = res.data[1]
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
        chainId: 1,
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
        chainId: 1,
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

const getOpportunityOfLendVault = (vaultAddress: string) => {
  return lendOpportunities.value.find(opportunity => opportunity.identifier === vaultAddress)
}

const getOpportunityOfBorrowVault = (assetAddress: string) => {
  return borrowOpportunities.value.find(opportunity => !!(opportunity.tokens.find(tokenInfo => tokenInfo.address === assetAddress)))
}

export const useMerkl = () => {
  const { isConnected, address: wagmiAddress } = useAccount()

  watch(isConnected, (val) => {
    if (!isLoaded.value) {
      loadOpportunities()
      loadTokens()
      loadRewards()
      isLoaded.value = true
    }

    if (val && !interval) {
      interval = setInterval(() => {
        loadRewards(false)
        loadOpportunities(false)
        loadTokens(false)
      }, 10000)
    }
    else {
      if (interval) {
        clearInterval(interval)
        interval = null
      }
    }
  }, { immediate: true })

  watch(wagmiAddress, (val) => {
    if (val) {
      address.value = val
    }
    else {
      address.value = ''
    }
  }, { immediate: true })

  return {
    lendOpportunities,
    borrowOpportunities,
    rewards,
    rewardTokens,
    isTokensLoading,
    isOpportunitiesLoading,
    isRewardsLoading,
    claimReward,
    loadOpportunities,
    loadTokens,
    loadRewards,
    getOpportunityOfLendVault,
    getOpportunityOfBorrowVault,
  }
}
