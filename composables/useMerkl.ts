import { useAccount, useWriteContract } from '@wagmi/vue'
import type { Address } from 'viem'
import axios from 'axios'

import type { Opportunity, Reward, RewardsResponseItem, RewardToken } from '~/entities/merkl'
import type { TxPlan } from '~/entities/txPlan'

const {
  MERKL_API_BASE_URL,
} = useEulerConfig()

const endpoints = {
  tokens: `${MERKL_API_BASE_URL}/tokens/reward`,
  opportunities: `${MERKL_API_BASE_URL}/opportunities/campaigns`,
  rewards: (addr: string) => `${MERKL_API_BASE_URL}/users/${addr}/rewards`,
  campaignById: (id: string) => `${MERKL_API_BASE_URL}/campaigns/${id}`,
}

const merklDistributorABI = [
  {
    type: 'function',
    name: 'claim',
    inputs: [
      {
        name: 'users',
        type: 'address[]',
        internalType: 'address[]',
      },
      {
        name: 'tokens',
        type: 'address[]',
        internalType: 'address[]',
      },
      {
        name: 'amounts',
        type: 'uint256[]',
        internalType: 'uint256[]',
      },
      {
        name: 'proofs',
        type: 'bytes32[][]',
        internalType: 'bytes32[][]',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const

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

const loadTokens = async (chainId: number, isInitialLoading = true) => {
  try {
    if (isInitialLoading) {
      isTokensLoading.value = true
    }
    const res = await axios.get(endpoints.tokens, {
      params: {
        chainId,
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

const loadOpportunities = async (chainId: number, isInitialLoading = true) => {
  try {
    if (isInitialLoading) {
      isOpportunitiesLoading.value = true
    }

    // Fetch from both endpoints: EULER type for standard vaults and ERC20LOGPROCESSOR for Earn vaults
    const urls = [
      `${MERKL_API_BASE_URL}/opportunities/?chainId=${chainId}&type=EULER&campaigns=true`,
      `${MERKL_API_BASE_URL}/opportunities/?chainId=${chainId}&mainProtocolId=euler&campaigns=true&type=ERC20LOGPROCESSOR`,
    ]

    const results = await Promise.all(
      urls.map(async (url) => {
        try {
          const res = await axios.get(url)
          return Array.isArray(res.data) ? res.data : []
        }
        catch (error) {
          console.warn('Error fetching opportunities from', url, error)
          return []
        }
      }),
    )

    const allOpportunities: Opportunity[] = results.flatMap(result => result ?? [])

    if (allOpportunities.length > 0) {
      const lends = []
      const borrows = []

      for (let i = 0; i < allOpportunities.length; i++) {
        if (allOpportunities[i].status === 'LIVE') {
          switch (allOpportunities[i].action) {
            case 'BORROW':
              borrows.push(allOpportunities[i])
              break
            case 'LEND':
              lends.push(allOpportunities[i])
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
const loadRewards = async (chainId: number, isInitialLoading = true) => {
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
        chainId,
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

const getOpportunityOfLendVault = (vaultAddress: string) => {
  return lendOpportunities.value.find(opportunity => opportunity.identifier === vaultAddress)
}

const getOpportunityOfBorrowVault = (assetAddress: string) => {
  return borrowOpportunities.value.find(opportunity => !!(opportunity.tokens.find(tokenInfo => tokenInfo.address === assetAddress)))
}

export const useMerkl = () => {
  const { isConnected, address: wagmiAddress } = useAccount()
  const { MERKL_ADDRESS } = useEulerConfig()
  const { writeContractAsync } = useWriteContract()
  const { chainId } = useEulerAddresses()

  const claimReward = async (reward: Reward) => {
    if (!wagmiAddress.value) {
      throw new Error('Wallet not connected')
    }

    const hash = await writeContractAsync({
      address: MERKL_ADDRESS as Address,
      abi: merklDistributorABI,
      functionName: 'claim',
      args: [
        [wagmiAddress.value],
        [reward.token.address as Address],
        [BigInt(reward.amount)],
        [reward.proofs as Address[]],
      ],
    })

    return hash
  }

  const buildClaimRewardPlan = async (reward: Reward): Promise<TxPlan> => {
    if (!wagmiAddress.value) {
      throw new Error('Wallet not connected')
    }

    return {
      kind: 'reward',
      steps: [
        {
          type: 'other',
          label: 'Claim reward',
          to: MERKL_ADDRESS as Address,
          abi: merklDistributorABI,
          functionName: 'claim',
          args: [
            [wagmiAddress.value],
            [reward.token.address as Address],
            [BigInt(reward.amount)],
            [reward.proofs as Address[]],
          ],
          value: 0n,
        },
      ],
    }
  }

  watch(wagmiAddress, (val) => {
    if (val) {
      address.value = val
    }
    else {
      address.value = ''
    }
  }, { immediate: true })

  watch([isConnected, chainId], (val, oldVal) => {
    if (oldVal[1] && val[1] !== oldVal[1]) {
      isLoaded.value = false
    }

    if (!isLoaded.value) {
      loadOpportunities(chainId.value)
      loadTokens(chainId.value)
      loadRewards(chainId.value)
      isLoaded.value = true
    }

    if (!interval) {
      interval = setInterval(() => {
        loadRewards(chainId.value, false)
        loadOpportunities(chainId.value, false)
        loadTokens(chainId.value, false)
      }, 10000)
    }
    else {
      if (interval) {
        clearInterval(interval)
        interval = null
      }
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
    buildClaimRewardPlan,
    loadOpportunities,
    loadTokens,
    loadRewards,
    getOpportunityOfLendVault,
    getOpportunityOfBorrowVault,
  }
}
