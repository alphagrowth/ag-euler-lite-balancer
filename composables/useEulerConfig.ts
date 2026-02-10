import {
  DEFILLAMA_YIELDS_URL,
  BREVIS_API_URL,
  BREVIS_MERKLE_PROOF_URL,
  EULER_INTERFACES_CHAINS_URL,
  MERKL_API_BASE_URL,
  MERKL_DISTRIBUTOR_ADDRESS,
} from '~/entities/constants'

const getRpcUrlByChainId = (chainId?: number, origin?: string): string => {
  if (!chainId) {
    return ''
  }
  if (!origin) {
    return `/api/rpc/${chainId}`
  }
  return `${origin}/api/rpc/${chainId}`
}

export const useEulerConfig = () => {
  const rc = useRuntimeConfig().public
  const { labelsRepo } = useDeployConfig()
  const { chainId } = useEulerAddresses()
  const requestUrl = useRequestURL()

  const labelsBaseUrl = `https://raw.githubusercontent.com/${labelsRepo}/refs/heads/master`

  return {
    // APIs (from constants)
    DEFILLAMA_YIELDS_URL,
    BREVIS_API_URL,
    BREVIS_MERKLE_PROOF_URL,
    EULER_INTERFACES_CHAINS_URL,
    MERKL_API_BASE_URL,

    // Labels (built from CONFIG_LABELS_REPO)
    getEulerLabelsEntitiesUrl: (id: number) => `${labelsBaseUrl}/${id}/entities.json`,
    getEulerLabelsProductsUrl: (id: number) => `${labelsBaseUrl}/${id}/products.json`,
    getEulerLabelsEarnVaultsUrl: (id: number) => `${labelsBaseUrl}/${id}/earn-vaults.json`,
    getEulerLabelsPointsUrl: (id: number) => `${labelsBaseUrl}/${id}/points.json`,
    EULER_LABELS_ENTITY_LOGO_URL: `${labelsBaseUrl}/logo`,

    // Runtime config APIs
    EULER_API_URL: rc.eulerApiUrl,
    SWAP_API_URL: rc.swapApiUrl,
    PRICE_API_URL: rc.priceApiUrl,
    PYTH_HERMES_URL: rc.pythHermesUrl,

    // Chain-specific (computed)
    EVM_PROVIDER_URL: computed(() => getRpcUrlByChainId(chainId.value, requestUrl.origin)).value,
    SUBGRAPH_URL: computed(() => (rc.subgraphUris as Record<string, string>)[String(chainId.value)] || '').value,
    MERKL_ADDRESS: MERKL_DISTRIBUTOR_ADDRESS,
  }
}
