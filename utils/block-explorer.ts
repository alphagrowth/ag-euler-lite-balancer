import {
  arbitrum,
  avalanche,
  base,
  berachain,
  bob,
  bsc,
  linea,
  mainnet,
  monad,
  plasma,
  sonic,
  swellchain,
  tac,
  unichain,
  type Chain,
} from '@reown/appkit/networks'

const explorerChains: Chain[] = [
  mainnet,
  arbitrum,
  base,
  swellchain,
  sonic,
  bob,
  berachain,
  avalanche,
  bsc,
  unichain,
  tac,
  linea,
  plasma,
  monad,
]

const chainById = new Map<number, Chain>(explorerChains.map(chain => [chain.id, chain]))

const cleanUrl = (url?: string) => {
  if (!url) return ''
  return url.endsWith('/') ? url : `${url}/`
}

const resolveExplorerBase = (chainId?: number) => {
  if (!chainId) {
    return cleanUrl(mainnet.blockExplorers?.default.url) || 'https://etherscan.io/'
  }
  const chain = chainById.get(chainId)
  return cleanUrl(chain?.blockExplorers?.default.url) || cleanUrl(mainnet.blockExplorers?.default.url) || 'https://etherscan.io/'
}

export const getExplorerLink = (
  hashOrAddress?: string,
  chainId?: number,
  isAddress = false,
) => {
  const baseUrl = resolveExplorerBase(chainId)
  if (!hashOrAddress) {
    return baseUrl
  }

  const chain = chainId ? chainById.get(chainId) : undefined
  const explorerName = chain?.blockExplorers?.default?.name
  const path = isAddress
    ? 'address'
    : explorerName === 'Tenderly'
      ? 'tx/mainnet'
      : 'tx'

  return `${baseUrl}${path}/${hashOrAddress}`
}
