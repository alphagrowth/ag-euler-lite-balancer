import { createError } from 'h3'
import { createRateLimiter } from '~/server/utils/rate-limit'

const TIMEOUT_MS = 10_000
const CACHE_TTL_MS = 300_000

const rateLimiter = createRateLimiter({
  max: 100,
  windowMs: 60_000,
  label: 'token-list',
})

let cachedData: { tokens: Array<{ chainId: number, address: string, name: string, symbol: string, decimals: number, logoURI?: string }> } | null = null
let cacheTimestamp = 0

export default defineEventHandler(async (event) => {
  rateLimiter.consume(event)

  const url = process.env.NUXT_PUBLIC_CONFIG_TOKEN_LIST_URL || 'https://tokens.uniswap.org'

  const now = Date.now()
  if (cachedData && (now - cacheTimestamp) < CACHE_TTL_MS) {
    return cachedData
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const resp = await fetch(url, { signal: controller.signal })

    if (!resp.ok) {
      console.warn('[token-list] Upstream returned', resp.status)
      throw createError({ statusCode: 502, statusMessage: 'Upstream error' })
    }

    const data = await resp.json()
    const tokens = data.tokens || []
    cachedData = { tokens }
    cacheTimestamp = Date.now()
    return cachedData
  }
  catch (error) {
    if (error && typeof error === 'object' && 'statusCode' in error) {
      throw error
    }
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.warn('[token-list] Upstream error:', message)
    throw createError({ statusCode: 502, statusMessage: 'Upstream error' })
  }
  finally {
    clearTimeout(timeout)
  }
})
