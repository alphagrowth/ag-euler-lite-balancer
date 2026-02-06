import { ethers } from 'ethers'
import type { Address } from 'viem'
import { USD_ADDRESS, EUR_ADDRESS } from '~/entities/constants'
import { erc20SymbolAbi } from '~/abis/erc20'

const resolvedSymbols: Ref<Map<string, string>> = shallowRef(new Map())
const pendingAddresses = new Set<string>()
const failedAddresses = new Set<string>()
let cachedProvider: ethers.JsonRpcProvider | null = null
let cachedProviderUrl: string | null = null

export const useTokenSymbolResolver = () => {
  const { EVM_PROVIDER_URL } = useEulerConfig()
  const { getAll } = useVaultRegistry()

  const getProvider = (): ethers.JsonRpcProvider => {
    if (!cachedProvider || cachedProviderUrl !== EVM_PROVIDER_URL) {
      cachedProvider = new ethers.JsonRpcProvider(EVM_PROVIDER_URL)
      cachedProviderUrl = EVM_PROVIDER_URL
      resolvedSymbols.value = new Map()
      pendingAddresses.clear()
      failedAddresses.clear()
    }
    return cachedProvider
  }

  const buildKnownSymbols = (): Map<string, string> => {
    const map = new Map<string, string>()

    map.set(USD_ADDRESS.toLowerCase(), 'USD')
    map.set(EUR_ADDRESS.toLowerCase(), 'EUR')

    getAll().forEach(({ vault }) => {
      if (vault.asset?.address && vault.asset?.symbol) {
        map.set(vault.asset.address.toLowerCase(), vault.asset.symbol)
      }
    })

    return map
  }

  const shortenAddress = (address: string) => `${address.slice(0, 6)}...${address.slice(-4)}`

  const lazyResolveSymbol = (address: string) => {
    const key = address.toLowerCase()
    if (pendingAddresses.has(key)) return
    if (resolvedSymbols.value.has(key)) return
    if (failedAddresses.has(key)) return

    pendingAddresses.add(key)

    const contract = new ethers.Contract(address, erc20SymbolAbi, getProvider())

    contract.symbol()
      .then((symbol: string) => {
        const updated = new Map(resolvedSymbols.value)
        updated.set(key, symbol)
        resolvedSymbols.value = updated
      })
      .catch((error: unknown) => {
        failedAddresses.add(key)
        console.warn(`[useTokenSymbolResolver] Failed to resolve symbol for ${address}:`, error)
      })
      .finally(() => {
        pendingAddresses.delete(key)
      })
  }

  const resolveSymbol = (address: Address | string, knownSymbols: Map<string, string>): string => {
    const key = address.toLowerCase()

    const known = knownSymbols.get(key)
    if (known) return known

    const resolved = resolvedSymbols.value.get(key)
    if (resolved) return resolved

    lazyResolveSymbol(address)
    return shortenAddress(address)
  }

  return {
    buildKnownSymbols,
    resolveSymbol,
    shortenAddress,
  }
}
