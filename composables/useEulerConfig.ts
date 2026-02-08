import config from '~/entities/config'

const getRpcUrlByChainId = (chainId?: number, origin?: string): string => {
  if (!chainId) {
    return ''
  }
  if (!origin) {
    return `/api/rpc/${chainId}`
  }
  return `${origin}/api/rpc/${chainId}`
}
const getSubgraphUrlByChainId = (chainId: number, config: object): string => {
  const key = `SUBGRAPH_URI_${chainId}`
  return (config[key as keyof typeof config] as string) || ''
}
const getMerklAddressByChainId = (chainId: number, config: object): string => {
  const key = `MERKL_ADDRESS_${chainId}`
  return (config[key as keyof typeof config] as string) || ''
}

export const useEulerConfig = () => {
  const { network, pythHermesUrl, eulerApiUrl, swapApiUrl, priceApiUrl } = useRuntimeConfig().public
  const { chainId } = useEulerAddresses()
  const requestUrl = useRequestURL()

  const baseConfig = config[network as keyof typeof config]

  return {
    ...baseConfig,
    EULER_API_URL: eulerApiUrl,
    SWAP_API_URL: swapApiUrl,
    PRICE_API_URL: priceApiUrl,
    EVM_PROVIDER_URL: computed(() => getRpcUrlByChainId(chainId.value, requestUrl.origin)).value,
    SUBGRAPH_URL: computed(() => getSubgraphUrlByChainId(chainId.value, baseConfig)).value,
    MERKL_ADDRESS: computed(() => getMerklAddressByChainId(chainId.value, baseConfig)).value,
    PYTH_HERMES_URL: pythHermesUrl,
  }
}
