import { createError, getQuery } from 'h3'
import { createRateLimiter } from '~/server/utils/rate-limit'
import { createTtlCache } from '~/server/utils/cache'
import { fetchWithTimeout } from '~/server/utils/fetchWithTimeout'

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

const uniswapCache = createTtlCache<TokenEntry[]>({ ttlMs: CACHE_TTL_MS })
const defillamaCache = createTtlCache<TokenEntry[]>({ ttlMs: CACHE_TTL_MS })

async function fetchUniswap(): Promise<TokenEntry[]> {
  const url = process.env.NUXT_PUBLIC_CONFIG_UNISWAP_TOKEN_LIST_URL || 'https://tokens.uniswap.org'

  const cached = uniswapCache.get('all')
  if (cached) return cached

  const resp = await fetchWithTimeout(url, TIMEOUT_MS)
  if (!resp.ok) {
    console.warn('[token-list] Uniswap upstream returned', resp.status)
    throw new Error(`Uniswap upstream returned ${resp.status}`)
  }

  const data = await resp.json()
  const tokens: TokenEntry[] = data.tokens || []
  uniswapCache.set('all', tokens)
  return tokens
}

async function fetchDefillama(chainId: number): Promise<TokenEntry[]> {
  const key = String(chainId)
  const cached = defillamaCache.get(key)
  if (cached) return cached

  try {
    const baseUrl = process.env.NUXT_PUBLIC_CONFIG_DEFILLAMA_TOKEN_LIST_URL || DEFILLAMA_DEFAULT_URL
    const url = `${baseUrl}/tokenlists-${chainId}.json`
    const resp = await fetchWithTimeout(url, TIMEOUT_MS)
    if (!resp.ok) {
      throw new Error(`DefiLlama upstream returned ${resp.status}`)
    }

    const data = await resp.json()

    // DefiLlama format: object keyed by address → normalize to array
    const tokens: TokenEntry[] = Object.values(data).map((entry: Record<string, unknown>) => ({
      chainId: Number(entry.chainId) || chainId,
      address: entry.address as string,
      name: entry.name as string,
      symbol: entry.symbol as string,
      decimals: entry.decimals as number,
      logoURI: (entry.logoURI || entry.logoURI2) as string | undefined,
    }))

    defillamaCache.set(key, tokens)
    return tokens
  }
  catch (err) {
    console.warn('[token-list] DefiLlama fetch failed:', err instanceof Error ? err.message : err, 'for chain', chainId)
    return defillamaCache.getStale(key) || []
  }
}

/** Merge two token arrays, deduplicating by chain+address. Primary entries take precedence. */
function deduplicateTokens(primary: TokenEntry[], secondary: TokenEntry[]): TokenEntry[] {
  const seen = new Set<string>()
  const result: TokenEntry[] = []

  for (const token of primary) {
    const key = `${token.chainId}:${token.address.toLowerCase()}`
    if (!seen.has(key)) {
      seen.add(key)
      result.push(token)
    }
  }

  for (const token of secondary) {
    const key = `${token.chainId}:${token.address.toLowerCase()}`
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
    const stale = uniswapCache.getStale('all')
    if (stale) {
      const defillamaTokens = defillamaResult.status === 'fulfilled' ? defillamaResult.value : []
      return { tokens: deduplicateTokens(stale, defillamaTokens) }
    }

    throw createError({ statusCode: 502, statusMessage: 'Upstream error' })
  }

  const uniswapTokens = uniswapResult.value
  const defillamaTokens = defillamaResult.status === 'fulfilled' ? defillamaResult.value : []

  return { tokens: deduplicateTokens(uniswapTokens, defillamaTokens) }
})
