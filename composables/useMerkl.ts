import { useAccount, useWriteContract } from '@wagmi/vue'
import type { Address } from 'viem'
import axios from 'axios'

import type { Opportunity, Reward, RewardsResponseItem, RewardToken } from '~/entities/merkl'

const {
  MERKL_API_BASE_URL,
} = useEulerConfig()

const endpoints = {
  tokens: `${MERKL_API_BASE_URL}/tokens/reward`,
  opportunities: `${MERKL_API_BASE_URL}/opportunities/campaigns`,
  rewards: (addr: string) => `${MERKL_API_BASE_URL}/users/${addr}/rewards`,
  campaignById: (id: string) => `${MERKL_API_BASE_URL}/campaigns/${id}`,
}
const DISTRIBUTOR_ADDRESS = '0x3Ef3D8bA38EBe18DB133cEc108f4D14CE00Dd9Ae'

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

const getOpportunityOfLendVault = (vaultAddress: string) => {
  return lendOpportunities.value.find(opportunity => opportunity.identifier === vaultAddress)
}

const getOpportunityOfBorrowVault = (assetAddress: string) => {
  return borrowOpportunities.value.find(opportunity => !!(opportunity.tokens.find(tokenInfo => tokenInfo.address === assetAddress)))
}

export const useMerkl = () => {
  const { isConnected, address: wagmiAddress } = useAccount()
  const { writeContractAsync } = useWriteContract()

  const claimReward = async (reward: Reward) => {
    if (!wagmiAddress.value) {
      throw new Error('Wallet not connected')
    }

    const hash = await writeContractAsync({
      address: DISTRIBUTOR_ADDRESS as Address,
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

  watch(wagmiAddress, (val) => {
    if (val) {
      address.value = val
    }
    else {
      address.value = ''
    }
  }, { immediate: true })

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
      }, 5000)
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
    loadOpportunities,
    loadTokens,
    loadRewards,
    getOpportunityOfLendVault,
    getOpportunityOfBorrowVault,
  }
}
