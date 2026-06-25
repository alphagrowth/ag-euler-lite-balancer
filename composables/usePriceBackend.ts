import { configureBackend, clearBackendCache } from '~/services/pricing'
import type { BackendConfig } from '~/services/pricing'

/**
 * Composable for accessing price backend configuration.
 *
 * Prices are fetched through the same-origin /api/prices proxy, which calls
 * Euler V3 server-side.
 *
 * Usage:
 * ```typescript
 * const { backendConfig } = usePriceBackend()
 *
 * // Use with price functions - pass 'off-chain' source and backend config
 * const price = await getAssetUsdPrice(vault, 'off-chain', backendConfig.value)
 * const value = await getAssetUsdValue(amount, vault, 'off-chain', backendConfig.value)
 * ```
 */
export const usePriceBackend = () => {
  const { chainId } = useEulerAddresses()

  const backendUrl = '/api/prices'

  // Initial configuration
  configureBackend(backendUrl, chainId.value)

  // On chain switch: clear stale cache first, then reconfigure with new chainId
  watch(chainId, () => {
    clearBackendCache()
    configureBackend(backendUrl, chainId.value)
  })

  const backendConfig = computed<BackendConfig>(() => ({
    url: backendUrl,
    chainId: chainId.value,
  }))

  const isBackendEnabled = computed(() => true)

  return {
    /**
     * Backend configuration to pass to async price functions.
     * Contains URL and chainId.
     */
    backendConfig,

    /**
     * Whether the backend is enabled (URL is configured).
     */
    isBackendEnabled,

    /**
     * The raw backend URL (for debugging/display).
     */
    backendUrl,
  }
}
