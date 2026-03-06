import axios from 'axios'

import type { FuulIncentive } from '~/entities/fuul'
import type { RewardCampaign } from '~/entities/reward-campaign'
import { CACHE_TTL_1MIN_MS, POLL_INTERVAL_10S_MS } from '~/entities/tuning-constants'
import { logWarn } from '~/utils/errorHandling'

const isLoaded = ref(false)
const fuulCampaigns: Ref<Map<string, RewardCampaign[]>> = shallowRef(new Map())
const isCampaignsLoading = ref(true)

let interval: NodeJS.Timeout | null = null

const cacheState = {
  campaigns: { chainId: 0, timestamp: 0 },
}

let latestRequestId = 0

const getFuulCampaignsForVault = (vaultAddress: string): RewardCampaign[] => {
  return fuulCampaigns.value.get(vaultAddress.toLowerCase()) || []
}

export const useFuul = () => {
  const { FUUL_API_BASE_URL } = useEulerConfig()
  const { chainId } = useEulerAddresses()

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

    const requestId = ++latestRequestId

    try {
      if (isInitialLoading) {
        isCampaignsLoading.value = true
      }

      const res = await axios.get(`${FUUL_API_BASE_URL}/incentives`, {
        params: { protocol: 'euler', chain_id: currentChainId },
      })

      if (requestId !== latestRequestId || chainId.value !== currentChainId) return

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
      if (requestId === latestRequestId) {
        isCampaignsLoading.value = false
      }
    }
  }

  watch(chainId, (val, oldVal) => {
    if (oldVal && val !== oldVal) {
      isLoaded.value = false
      fuulCampaigns.value = new Map()
      cacheState.campaigns = { chainId: 0, timestamp: 0 }
      isCampaignsLoading.value = true
    }

    if (!isLoaded.value) {
      loadIncentives()
      isLoaded.value = true
    }

    if (!interval) {
      interval = setInterval(() => {
        loadIncentives(false)
      }, POLL_INTERVAL_10S_MS)
    }
  }, { immediate: true })

  onUnmounted(() => {
    if (interval) {
      clearInterval(interval)
      interval = null
    }
  })

  return {
    fuulCampaigns,
    isCampaignsLoading,
    loadIncentives,
    getFuulCampaignsForVault,
  }
}
