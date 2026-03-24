import axios from 'axios'
import { getAddress, zeroAddress } from 'viem'
import type { VaultAsset } from '~/entities/vault'
import { logWarn } from '~/utils/errorHandling'
import { CACHE_TTL_5MIN_MS } from '~/entities/tuning-constants'
import { getChainById } from '~/entities/chainRegistry'
import { createRaceGuard } from '~/utils/race-guard'

interface TokenListEntry {
  chainId: number
  address: string
  name: string
  symbol: string
  decimals: number
  logoURI?: string
}

// Singleton state
const tokenMap = shallowRef(new Map<string, TokenListEntry>())
const isLoading = ref(false)
const isLoaded = ref(false)
const guard = createRaceGuard()

const loadState = {
  chainId: 0,
  timestamp: 0,
  rawTokens: [] as TokenListEntry[],
}

const filterByChain = (chainId: number) => {
  const filtered = new Map<string, TokenListEntry>()
  for (const token of loadState.rawTokens) {
    if (token.chainId !== chainId) continue
    try {
      const normalized = getAddress(token.address).toLowerCase()
      if (!filtered.has(normalized)) {
        filtered.set(normalized, token)
      }
    }
    catch {
      // skip invalid addresses
    }
  }
  // Ensure the native currency is always present at address zero
  if (!filtered.has(zeroAddress)) {
    const chain = getChainById(chainId)
    if (chain?.nativeCurrency) {
      filtered.set(zeroAddress, {
        chainId,
        address: zeroAddress,
        name: chain.nativeCurrency.name,
        symbol: chain.nativeCurrency.symbol,
        decimals: chain.nativeCurrency.decimals,
      })
    }
  }

  tokenMap.value = filtered
}

const loadTokenList = async (forceRefresh = false) => {
  try {
    const { chainId: currentChainId } = useEulerAddresses()
    const chainId = currentChainId.value
    if (!chainId) return

    const now = Date.now()

    // DefiLlama data is per-chain, so re-fetch when chain changes
    if (!forceRefresh
      && loadState.rawTokens.length > 0
      && loadState.chainId === chainId
      && (now - loadState.timestamp) < CACHE_TTL_5MIN_MS) {
      return
    }

    const gen = guard.next()
    isLoading.value = true

    const res = await axios.get('/api/token-list', { params: { chainId } })
    if (guard.isStale(gen)) return

    const tokens: TokenListEntry[] = res.data?.tokens || []
    loadState.rawTokens = tokens
    loadState.timestamp = Date.now()
    loadState.chainId = chainId

    filterByChain(chainId)
    isLoaded.value = true
  }
  catch (e) {
    logWarn('tokenList/load', e)
  }
  finally {
    isLoading.value = false
  }
}

export const getTokenListLogoUrl = (address: string): string | undefined => {
  try {
    const logoURI = tokenMap.value.get(getAddress(address).toLowerCase())?.logoURI
    if (!logoURI) return undefined
    // CoinGecko /thumb/ images are 25x25 — upgrade to /small/ (64x64) for sharper display
    return logoURI.replace('/thumb/', '/small/')
  }
  catch {
    return undefined
  }
}

const hasToken = (address: string): boolean => {
  try {
    return tokenMap.value.has(getAddress(address).toLowerCase())
  }
  catch {
    return false
  }
}

const getAllTokens = (): TokenListEntry[] => {
  return [...tokenMap.value.values()]
}

const toVaultAsset = (entry: TokenListEntry): VaultAsset => ({
  name: entry.name,
  symbol: entry.symbol,
  address: getAddress(entry.address),
  decimals: BigInt(entry.decimals),
})

export const useTokenList = () => {
  return {
    loadTokenList,
    hasToken,
    getAllTokens,
    toVaultAsset,
    isLoading,
    isLoaded,
  }
}
