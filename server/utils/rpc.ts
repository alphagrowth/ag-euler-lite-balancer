import config from '~/entities/config'

type ConfigKey = keyof typeof config

export const resolveRpcUrl = (chainId: number, network?: string): string | undefined => {
  const key = `NEXT_PUBLIC_RPC_HTTP_${chainId}` as const
  const preferred = network ? config[network as ConfigKey] : undefined
  const candidates = [preferred, config.mainnet, config.testnet].filter(Boolean) as Array<Record<string, string | undefined>>

  for (const candidate of candidates) {
    const url = candidate[key]
    if (url) return url
  }

  for (const candidate of Object.values(config) as Array<Record<string, string | undefined>>) {
    const url = candidate[key]
    if (url) return url
  }

  return undefined
}
