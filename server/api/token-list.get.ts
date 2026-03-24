import { createError, getQuery } from 'h3'
import { createRateLimiter } from '~/server/utils/rate-limit'

const TIMEOUT_MS = 10_000
const CACHE_TTL_MS = 300_000
const DEFILLAMA_DEFAULT_URL = 'https://d3g10bzo9rdluh.cloudfront.net'

interface TokenEntry {
  chainId: number
  address: string
  name: string
  symbol: string
  decimals: number
  logoURI?: string
}

const rateLimiter = createRateLimiter({
  max: 100,
  windowMs: 60_000,
  label: 'token-list',
})

// Uniswap cache (all chains in one response)
let uniswapCache: { tokens: TokenEntry[] } | null = null
let uniswapCacheTimestamp = 0

// DefiLlama cache (per-chain)
const defillamaCache = new Map<number, { tokens: TokenEntry[], timestamp: number }>()

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { signal: controller.signal })
  }
  finally {
    clearTimeout(timeout)
  }
}

async function fetchUniswap(): Promise<TokenEntry[]> {
  const url = process.env.NUXT_PUBLIC_CONFIG_UNISWAP_TOKEN_LIST_URL || 'https://tokens.uniswap.org'
  const now = Date.now()

  if (uniswapCache && (now - uniswapCacheTimestamp) < CACHE_TTL_MS) {
    return uniswapCache.tokens
  }

  const resp = await fetchWithTimeout(url, TIMEOUT_MS)
  if (!resp.ok) {
    console.warn('[token-list] Uniswap upstream returned', resp.status)
    throw new Error(`Uniswap upstream returned ${resp.status}`)
  }

  const data = await resp.json()
  const tokens: TokenEntry[] = data.tokens || []
  uniswapCache = { tokens }
  uniswapCacheTimestamp = Date.now()
  return tokens
}

async function fetchDefillama(chainId: number): Promise<TokenEntry[]> {
  const now = Date.now()
  const cached = defillamaCache.get(chainId)

  if (cached && (now - cached.timestamp) < CACHE_TTL_MS) {
    return cached.tokens
  }

  const baseUrl = process.env.NUXT_PUBLIC_CONFIG_DEFILLAMA_TOKEN_LIST_URL || DEFILLAMA_DEFAULT_URL
  const url = `${baseUrl}/tokenlists-${chainId}.json`
  const resp = await fetchWithTimeout(url, TIMEOUT_MS)
  if (!resp.ok) {
    console.warn('[token-list] DefiLlama upstream returned', resp.status, 'for chain', chainId)
    return cached?.tokens || []
  }

  const data = await resp.json()

  // DefiLlama format: object keyed by address → normalize to array
  const tokens: TokenEntry[] = Object.values(data).map((entry: any) => ({
    chainId: entry.chainId ?? chainId,
    address: entry.address,
    name: entry.name,
    symbol: entry.symbol,
    decimals: entry.decimals,
    logoURI: entry.logoURI,
  }))

  defillamaCache.set(chainId, { tokens, timestamp: Date.now() })
  return tokens
}

/** Merge two token arrays, deduplicating by lowercase address. Primary entries take precedence. */
function deduplicateTokens(primary: TokenEntry[], secondary: TokenEntry[]): TokenEntry[] {
  const seen = new Set<string>()
  const result: TokenEntry[] = []

  for (const token of primary) {
    const key = token.address.toLowerCase()
    if (!seen.has(key)) {
      seen.add(key)
      result.push(token)
    }
  }

  for (const token of secondary) {
    const key = token.address.toLowerCase()
    if (!seen.has(key)) {
      seen.add(key)
      result.push(token)
    }
  }

  return result
}

export default defineEventHandler(async (event) => {
  rateLimiter.consume(event)

  const query = getQuery(event)
  const chainId = query.chainId ? Number(query.chainId) : null

  // Fetch both sources in parallel; DefiLlama is best-effort
  const [uniswapResult, defillamaResult] = await Promise.allSettled([
    fetchUniswap(),
    chainId ? fetchDefillama(chainId) : Promise.resolve([]),
  ])

  if (uniswapResult.status === 'rejected') {
    console.warn('[token-list] Uniswap fetch failed:', uniswapResult.reason?.message || 'Unknown error')

    // If we have stale Uniswap cache, use it
    if (uniswapCache) {
      const defillamaTokens = defillamaResult.status === 'fulfilled' ? defillamaResult.value : []
      return { tokens: deduplicateTokens(uniswapCache.tokens, defillamaTokens) }
    }

    throw createError({ statusCode: 502, statusMessage: 'Upstream error' })
  }

  const uniswapTokens = uniswapResult.value
  const defillamaTokens = defillamaResult.status === 'fulfilled' ? defillamaResult.value : []

  return { tokens: deduplicateTokens(uniswapTokens, defillamaTokens) }
})
