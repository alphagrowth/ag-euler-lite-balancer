import { useAccount, useWriteContract } from '@wagmi/vue'
import type { Address } from 'viem'
import axios from 'axios'

import type { Campaign, CampaignsRequest, MerkleProofRequest } from '~/entities/brevis'
import { CampaignAction } from '~/entities/brevis'

const BREVIS_API_URL = 'https://incentra-prd.brevis.network/sdk/v1/eulerCampaigns'
const BREVIS_MERKLE_PROOF_URL = 'https://incentra-prd.brevis.network/v1/getMerkleProofsBatch'

const brevisClaimABI = [
  {
    type: 'function',
    name: 'claim',
    inputs: [
      {
        name: 'earner',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'cumulativeAmounts',
        type: 'uint256[]',
        internalType: 'uint256[]',
      },
      {
        name: 'epoch',
        type: 'uint64',
        internalType: 'uint64',
      },
      {
        name: 'proof',
        type: 'bytes32[]',
        internalType: 'bytes32[]',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const

const address = ref('')

const isLoaded = ref(false)
const lendCampaigns: Ref<Campaign[]> = ref([])
const borrowCampaigns: Ref<Campaign[]> = ref([])
const userRewards: Ref<Campaign[]> = ref([])
const isCampaignsLoading = ref(true)
const isRewardsLoading = ref(true)

let interval: NodeJS.Timeout | null = null

const loadCampaigns = async (isInitialLoading = true) => {
  try {
    if (isInitialLoading) {
      isCampaignsLoading.value = true
    }

    const request: CampaignsRequest = {
      chain_id: [1],
      action: [CampaignAction.LEND, CampaignAction.BORROW],
      status: [3],
    }

    const res = await axios.post(BREVIS_API_URL, request)

    if (res.data.err) {
      console.warn('Brevis API error:', res.data.err)
      return
    }

    const campaigns: Campaign[] = res.data.campaigns || []

    const lends: Campaign[] = []
    const borrows: Campaign[] = []

    for (const campaign of campaigns) {
      if (campaign.action === CampaignAction.LEND) {
        lends.push(campaign)
      }
      else if (campaign.action === CampaignAction.BORROW) {
        borrows.push(campaign)
      }
    }

    lendCampaigns.value = lends
    borrowCampaigns.value = borrows
  }
  catch (e) {
    console.warn(e)
  }
  finally {
    isCampaignsLoading.value = false
  }
}

const loadRewards = async (isInitialLoading = true) => {
  try {
    if (!address.value) {
      userRewards.value = []
      return
    }
    if (isInitialLoading) {
      isRewardsLoading.value = true
    }

    const request: CampaignsRequest = {
      chain_id: [1],
      user_address: [address.value],
    }

    const res = await axios.post(BREVIS_API_URL, request)

    if (res.data.err) {
      console.warn('Brevis API error:', res.data.err)
      return
    }

    userRewards.value = res.data.campaigns || []
  }
  catch (e) {
    console.warn(e)
  }
  finally {
    isRewardsLoading.value = false
  }
}

const getCampaignOfLendVault = (vaultAddress: string) => {
  return lendCampaigns.value.find(campaign => campaign.vault_address.toLowerCase() === vaultAddress.toLowerCase())
}

const getCampaignOfBorrowVault = (vaultAddress: string) => {
  return borrowCampaigns.value.find(campaign => campaign.vault_address.toLowerCase() === vaultAddress.toLowerCase())
}

export const useBrevis = () => {
  const { isConnected, address: wagmiAddress } = useAccount()
  const { writeContractAsync } = useWriteContract()

  const claimReward = async (campaign: Campaign) => {
    if (!wagmiAddress.value) {
      throw new Error('Wallet not connected')
    }

    const request: MerkleProofRequest = {
      user_addr: wagmiAddress.value,
      campaign_id: [campaign.campaign_id],
      chain_id: [campaign.chain_id],
    }

    const res = await axios.post(BREVIS_MERKLE_PROOF_URL, request)

    if (res.data.err) {
      throw new Error(res.data.err.msg || 'Failed to fetch merkle proof')
    }

    const rewardsBatch = res.data.rewardsBatch
    if (!rewardsBatch || rewardsBatch.length === 0) {
      throw new Error('No claimable rewards found')
    }

    const merkleData = rewardsBatch[0]

    const hash = await writeContractAsync({
      address: merkleData.claimContractAddr as Address,
      abi: brevisClaimABI,
      functionName: 'claim',
      args: [
        wagmiAddress.value,
        merkleData.cumulativeRewards.map(r => BigInt(r)),
        BigInt(merkleData.epoch),
        merkleData.merkleProof as Address[],
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

  watch(isConnected, () => {
    if (!isLoaded.value) {
      loadCampaigns()
      loadRewards()
      isLoaded.value = true
    }

    if (!interval) {
      interval = setInterval(() => {
        loadRewards(false)
        loadCampaigns(false)
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
    lendCampaigns,
    borrowCampaigns,
    userRewards,
    isCampaignsLoading,
    isRewardsLoading,
    loadCampaigns,
    loadRewards,
    claimReward,
    getCampaignOfLendVault,
    getCampaignOfBorrowVault,
  }
}
