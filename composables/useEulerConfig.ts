import type { Network } from '@tonappchain/sdk'
import config from '~/entities/config'

const getRpcUrlByChainId = (chainId: number, config: object): string => {
  const key = `NEXT_PUBLIC_RPC_HTTP_${chainId}`
  return (config[key] as string) || ''
}
const getSubgraphUrlByChainId = (chainId: number, config: object): string => {
  const key = `SUBGRAPH_URI_${chainId}`
  return (config[key] as string) || ''
}

export const useEulerConfig = () => {
  const { network } = useRuntimeConfig().public
  const { chainId } = useEulerAddresses()

  const baseConfig = config[network as Network]

  return {
    ...baseConfig,
    EVM_PROVIDER_URL: computed(() => getRpcUrlByChainId(chainId.value, baseConfig)).value,
    SUBGRAPH_URL: computed(() => getSubgraphUrlByChainId(chainId.value, baseConfig)).value,
  }
}
