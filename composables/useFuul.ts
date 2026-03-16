import { useAccount, useSwitchChain, useWriteContract } from '@wagmi/vue'
import type { Address } from 'viem'
import axios from 'axios'

import { fuulManagerABI, fuulFactoryABI } from '~/abis/fuul'
import { getPublicClient } from '~/utils/public-client'
import type { FuulClaimableEntry, FuulClaimableReward, FuulIncentive } from '~/entities/fuul'
import type { RewardCampaign } from '~/entities/reward-campaign'
import type { TxPlan } from '~/entities/txPlan'
import { CACHE_TTL_1MIN_MS, POLL_INTERVAL_10S_MS } from '~/entities/tuning-constants'
import { logWarn } from '~/utils/errorHandling'

const address = ref('')

const isLoaded = ref(false)
const fuulCampaigns: Ref<Map<string, RewardCampaign[]>> = shallowRef(new Map())
const isCampaignsLoading = ref(true)
const fuulClaimableEntries: Ref<FuulClaimableEntry[]> = shallowRef([])
const isClaimableLoading = ref(true)

let interval: NodeJS.Timeout | null = null
let subscriberCount = 0
let latestClaimableRequestId = 0

const cacheState = {
  campaigns: { chainId: 0, timestamp: 0 },
  claimable: { timestamp: 0, address: '', chainId: 0 },
}

const getFuulCampaignsForVault = (vaultAddress: string): RewardCampaign[] => {
  return fuulCampaigns.value.get(vaultAddress.toLowerCase()) || []
}

export const useFuul = () => {
  const { address: wagmiAddress, chain: wagmiChain } = useAccount()
  const { switchChain } = useSwitchChain()
  const { writeContractAsync } = useWriteContract()
  const { FUUL_API_BASE_URL, FUUL_MANAGER_ADDRESS, FUUL_FACTORY_ADDRESS, EVM_PROVIDER_URL } = useEulerConfig()
  const { chainId } = useEulerAddresses()

  const unclaimedFuulRewards = computed(() =>
    fuulClaimableEntries.value.flatMap(entry => entry.claimable_rewards),
  )

  const ensureWalletOnCurrentChain = async () => {
    const targetChainId = chainId.value
    if (!targetChainId) return

    if (wagmiChain.value?.id === targetChainId) return
    await switchChain({ chainId: targetChainId })
  }

  const loadIncentives = async (isInitialLoading = true, forceRefresh = false) => {
    const currentChainId = chainId.value
    if (!currentChainId) return

    const now = Date.now()
    if (!forceRefresh
      && cacheState.campaigns.chainId === currentChainId
      && fuulCampaigns.value.size > 0
      && (now - cacheState.campaigns.timestamp) < CACHE_TTL_1MIN_MS) {
      return
    }

    try {
      if (isInitialLoading) {
        isCampaignsLoading.value = true
      }

      const res = await axios.get(`${FUUL_API_BASE_URL}/incentives`, {
        params: { protocol: 'euler', chain_id: currentChainId },
      })

      const data: FuulIncentive[] = Array.isArray(res.data) ? res.data : []
      const campaignMap = new Map<string, RewardCampaign[]>()

      for (const item of data) {
        const vaultKey = item.trigger.context.token_address.toLowerCase()

        const rewardCampaign: RewardCampaign = {
          vault: vaultKey,
          type: 'euler_lend',
          apr: item.apr * 100,
          provider: 'fuul',
          endTimestamp: 0,
          rewardToken: {
            symbol: item.project,
            icon: '',
          },
          sourceUrl: 'https://www.fuul.xyz/',
        }

        const existing = campaignMap.get(vaultKey)
        if (existing) existing.push(rewardCampaign)
        else campaignMap.set(vaultKey, [rewardCampaign])
      }

      fuulCampaigns.value = campaignMap
      cacheState.campaigns = { chainId: currentChainId, timestamp: Date.now() }
    }
    catch (e) {
      logWarn('fuul/incentives', e)
    }
    finally {
      isCampaignsLoading.value = false
    }
  }

  const loadClaimableRewards = async (isInitialLoading = true, forceRefresh = false) => {
    const currentChainId = chainId.value
    if (!address.value || !currentChainId) {
      fuulClaimableEntries.value = []
      isClaimableLoading.value = false
      return
    }

    const now = Date.now()
    if (!forceRefresh
      && cacheState.claimable.address === address.value
      && cacheState.claimable.chainId === currentChainId
      && (now - cacheState.claimable.timestamp) < CACHE_TTL_1MIN_MS) {
      return
    }

    const requestId = ++latestClaimableRequestId
    const capturedAddress = address.value

    try {
      if (isInitialLoading) {
        isClaimableLoading.value = true
      }

      const res = await axios.get(`${FUUL_API_BASE_URL}/claimable-rewards`, {
        params: {
          protocol: 'euler',
          user_address: capturedAddress,
          chain_id: currentChainId,
        },
      })

      if (requestId !== latestClaimableRequestId) return

      fuulClaimableEntries.value = Array.isArray(res.data) ? res.data : []
      cacheState.claimable = { timestamp: Date.now(), address: capturedAddress, chainId: currentChainId }
    }
    catch (e) {
      logWarn('fuul/claimable-rewards', e)
    }
    finally {
      if (requestId === latestClaimableRequestId) {
        isClaimableLoading.value = false
      }
    }
  }

  const readClaimFee = async (projectAddress: string): Promise<bigint> => {
    const client = getPublicClient(EVM_PROVIDER_URL)

    const feesInfo = await client.readContract({
      address: FUUL_FACTORY_ADDRESS as Address,
      abi: fuulFactoryABI,
      functionName: 'getFeesInformation',
      args: [projectAddress as Address],
    })

    return (feesInfo as { nativeUserClaimFee: bigint }).nativeUserClaimFee
  }

  const mapRewardToContractCheck = (reward: FuulClaimableReward) => ({
    projectAddress: reward.project_address as Address,
    to: wagmiAddress.value as Address,
    currency: reward.currency_address as Address,
    currencyType: 1,
    amount: BigInt(reward.amount),
    reason: reward.reason,
    tokenId: BigInt(reward.token_id),
    deadline: BigInt(reward.deadline),
    proof: reward.proof as `0x${string}`,
    signatures: reward.signatures as `0x${string}`[],
  })

  const claimReward = async (reward: FuulClaimableReward) => {
    if (!wagmiAddress.value) {
      throw new Error('Wallet not connected')
    }

    await ensureWalletOnCurrentChain()

    const contractCheck = mapRewardToContractCheck(reward)
    const fee = await readClaimFee(reward.project_address)

    const hash = await writeContractAsync({
      address: FUUL_MANAGER_ADDRESS as Address,
      abi: fuulManagerABI,
      functionName: 'claim',
      args: [[contractCheck]],
      value: fee,
    })

    return hash
  }

  const buildClaimRewardPlan = async (reward: FuulClaimableReward): Promise<TxPlan> => {
    if (!wagmiAddress.value) {
      throw new Error('Wallet not connected')
    }

    const contractCheck = mapRewardToContractCheck(reward)
    const fee = await readClaimFee(reward.project_address)

    return {
      kind: 'fuul-reward',
      steps: [
        {
          type: 'other',
          label: 'Claim Fuul reward',
          to: FUUL_MANAGER_ADDRESS as Address,
          abi: fuulManagerABI,
          functionName: 'claim',
          args: [[contractCheck]],
          value: fee,
        },
      ],
    }
  }

  watch(wagmiAddress, (val, oldVal) => {
    if (val) {
      address.value = val
    }
    else {
      address.value = ''
      latestClaimableRequestId++
      fuulClaimableEntries.value = []
      isClaimableLoading.value = false
      cacheState.claimable = { timestamp: 0, address: '', chainId: 0 }
    }
    if (oldVal && val && val !== oldVal) {
      loadClaimableRewards(true, true)
    }
  }, { immediate: true })

  watch(chainId, (val, oldVal) => {
    if (oldVal && val !== oldVal) {
      isLoaded.value = false
    }

    if (!isLoaded.value && val) {
      loadIncentives()
      loadClaimableRewards()
      isLoaded.value = true
    }

    if (!interval) {
      interval = setInterval(() => {
        loadIncentives(false)
        loadClaimableRewards(false)
      }, POLL_INTERVAL_10S_MS)
    }
  }, { immediate: true })

  subscriberCount++

  onUnmounted(() => {
    subscriberCount--
    if (subscriberCount === 0 && interval) {
      clearInterval(interval)
      interval = null
    }
  })

  return {
    fuulCampaigns,
    unclaimedFuulRewards,
    isCampaignsLoading,
    isClaimableLoading,
    loadIncentives,
    loadClaimableRewards,
    claimReward,
    buildClaimRewardPlan,
    getFuulCampaignsForVault,
  }
}
