import { useAccount, useSwitchChain, useWriteContract } from '@wagmi/vue'
import type { Address } from 'viem'
import axios from 'axios'

import { fuulManagerABI, fuulFactoryABI } from '~/abis/fuul'
import { getPublicClient } from '~/utils/public-client'
import type { FuulClaimCheck, FuulIncentive, FuulTotals } from '~/entities/fuul'
import type { RewardCampaign } from '~/entities/reward-campaign'
import type { TxPlan } from '~/entities/txPlan'
import { CACHE_TTL_1MIN_MS, POLL_INTERVAL_10S_MS } from '~/entities/tuning-constants'
import { logWarn } from '~/utils/errorHandling'

const address = ref('')

const isLoaded = ref(false)
const fuulCampaigns: Ref<Map<string, RewardCampaign[]>> = shallowRef(new Map())
const isCampaignsLoading = ref(true)
const fuulTotals: Ref<FuulTotals> = ref({ claimed: [], unclaimed: [] })
const isTotalsLoading = ref(true)

let interval: NodeJS.Timeout | null = null
let subscriberCount = 0
let latestTotalsRequestId = 0

const cacheState = {
  campaigns: { chainId: 0, timestamp: 0 },
  totals: { timestamp: 0, address: '' },
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

  const loadTotals = async (isInitialLoading = true, forceRefresh = false) => {
    if (!address.value) {
      fuulTotals.value = { claimed: [], unclaimed: [] }
      isTotalsLoading.value = false
      return
    }

    const now = Date.now()
    if (!forceRefresh
      && cacheState.totals.address === address.value
      && (now - cacheState.totals.timestamp) < CACHE_TTL_1MIN_MS) {
      return
    }

    const requestId = ++latestTotalsRequestId
    const capturedAddress = address.value

    try {
      if (isInitialLoading) {
        isTotalsLoading.value = true
      }

      const res = await axios.get('/api/fuul/totals', {
        params: { user_identifier: capturedAddress },
      })

      if (requestId !== latestTotalsRequestId) return

      fuulTotals.value = res.data || { claimed: [], unclaimed: [] }
      cacheState.totals = { timestamp: Date.now(), address: capturedAddress }
    }
    catch (e) {
      logWarn('fuul/totals', e)
    }
    finally {
      if (requestId === latestTotalsRequestId) {
        isTotalsLoading.value = false
      }
    }
  }

  const fetchClaimChecks = async (): Promise<FuulClaimCheck[]> => {
    if (!wagmiAddress.value) {
      throw new Error('Wallet not connected')
    }

    const res = await axios.post('/api/fuul/claim-checks', {
      userIdentifier: wagmiAddress.value,
    })

    return Array.isArray(res.data) ? res.data : []
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

  const claimRewards = async () => {
    if (!wagmiAddress.value) {
      throw new Error('Wallet not connected')
    }

    await ensureWalletOnCurrentChain()

    const claimChecks = await fetchClaimChecks()
    if (claimChecks.length === 0) {
      throw new Error('No claimable rewards found')
    }

    // Read fee per unique project and aggregate
    const uniqueProjects = [...new Set(claimChecks.map(c => c.project_address))]
    const fees = await Promise.all(uniqueProjects.map(addr => readClaimFee(addr)))
    const feeMap = new Map(uniqueProjects.map((addr, i) => [addr, fees[i]]))
    const totalFee = claimChecks.reduce((sum, c) => sum + (feeMap.get(c.project_address) ?? 0n), 0n)

    const contractChecks = claimChecks.map(check => ({
      projectAddress: check.project_address as Address,
      to: check.to as Address,
      currency: check.currency as Address,
      currencyType: check.currency_type,
      amount: BigInt(check.amount),
      reason: check.reason,
      tokenId: BigInt(check.token_id),
      deadline: BigInt(check.deadline),
      proof: check.proof as `0x${string}`,
      signatures: check.signatures as `0x${string}`[],
    }))

    const hash = await writeContractAsync({
      address: FUUL_MANAGER_ADDRESS as Address,
      abi: fuulManagerABI,
      functionName: 'claim',
      args: [contractChecks],
      value: totalFee,
    })

    return hash
  }

  const buildClaimRewardsPlan = async (): Promise<TxPlan> => {
    if (!wagmiAddress.value) {
      throw new Error('Wallet not connected')
    }

    const claimChecks = await fetchClaimChecks()
    if (claimChecks.length === 0) {
      throw new Error('No claimable rewards found')
    }

    const uniqueProjects = [...new Set(claimChecks.map(c => c.project_address))]
    const fees = await Promise.all(uniqueProjects.map(addr => readClaimFee(addr)))
    const feeMap = new Map(uniqueProjects.map((addr, i) => [addr, fees[i]]))
    const totalFee = claimChecks.reduce((sum, c) => sum + (feeMap.get(c.project_address) ?? 0n), 0n)

    const contractChecks = claimChecks.map(check => ({
      projectAddress: check.project_address as Address,
      to: check.to as Address,
      currency: check.currency as Address,
      currencyType: check.currency_type,
      amount: BigInt(check.amount),
      reason: check.reason,
      tokenId: BigInt(check.token_id),
      deadline: BigInt(check.deadline),
      proof: check.proof as `0x${string}`,
      signatures: check.signatures as `0x${string}`[],
    }))

    return {
      kind: 'fuul-reward',
      steps: [
        {
          type: 'other',
          label: 'Claim Fuul rewards',
          to: FUUL_MANAGER_ADDRESS as Address,
          abi: fuulManagerABI,
          functionName: 'claim',
          args: [contractChecks],
          value: totalFee,
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
      fuulTotals.value = { claimed: [], unclaimed: [] }
      isTotalsLoading.value = false
      cacheState.totals = { timestamp: 0, address: '' }
    }
    if (oldVal && val && val !== oldVal) {
      loadTotals(true, true)
    }
  }, { immediate: true })

  watch(chainId, (val, oldVal) => {
    if (oldVal && val !== oldVal) {
      isLoaded.value = false
    }

    if (!isLoaded.value && val) {
      loadIncentives()
      loadTotals()
      isLoaded.value = true
    }

    if (!interval) {
      interval = setInterval(() => {
        loadIncentives(false)
        loadTotals(false)
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
    fuulTotals,
    isCampaignsLoading,
    isTotalsLoading,
    loadIncentives,
    loadTotals,
    claimRewards,
    buildClaimRewardsPlan,
    getFuulCampaignsForVault,
  }
}
