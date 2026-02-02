import config from '~/entities/config'

type ConfigKey = keyof typeof config

export const resolveRpcUrl = (chainId: number, network?: string): string | undefined => {
  const key = `NEXT_PUBLIC_RPC_HTTP_${chainId}` as const
  const baseConfig = (config[network as ConfigKey] || config.mainnet || config.testnet) as Record<string, string | undefined>

  return baseConfig[key]
}
