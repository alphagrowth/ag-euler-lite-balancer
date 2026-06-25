import { createError, defineEventHandler, getQuery, setResponseHeader } from 'h3'
import { createTtlCache } from '~/server/utils/cache'
import { fetchWithTimeout } from '~/server/utils/fetchWithTimeout'
import { createRateLimiter } from '~/server/utils/rate-limit'
import type { BackendPriceResponse } from '~/services/pricing/backendClient'

const DEFAULT_V3_API_URL = 'https://v3.euler.finance'
const TIMEOUT_MS = 10_000
const CACHE_TTL_MS = 60_000
const MAX_ADDRESSES = 100
const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/

type V3Price = {
  chainId?: number
  address?: string
  symbol?: string | null
  priceUsd?: number | string | null
  source?: string | null
  timestamp?: string | null
}

type V3PricesResponse = {
  data?: V3Price[]
  meta?: {
    timestamp?: string | null
  }
}

type CachePayload = {
  prices: BackendPriceResponse
}

const priceCache = createTtlCache<CachePayload>({ ttlMs: CACHE_TTL_MS })

const rateLimiter = createRateLimiter({
  max: 1000,
  windowMs: 60_000,
  label: 'prices-proxy',
})

const getV3ApiUrl = (): string =>
  (process.env.V3_API_URL || DEFAULT_V3_API_URL).replace(/\/+$/, '')

const getFirstQueryValue = (value: unknown): string | undefined => {
  if (Array.isArray(value)) return value.length ? String(value[0]) : undefined
  if (value === undefined || value === null) return undefined
  return String(value)
}

const parseChainId = (raw: unknown): number => {
  const value = getFirstQueryValue(raw)
  if (!value || !/^\d+$/.test(value)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid chainId' })
  }

  const chainId = Number(value)
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid chainId' })
  }

  return chainId
}

const parseAddresses = (rawAssets: unknown, rawAddresses: unknown): string[] => {
  const rawValues = [rawAssets, rawAddresses]
    .flatMap(value => Array.isArray(value) ? value.map(String) : value ? [String(value)] : [])

  const addresses = rawValues
    .flatMap(value => value.split(','))
    .map(value => value.trim())
    .filter(Boolean)

  if (addresses.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'Missing assets parameter' })
  }

  if (addresses.length > MAX_ADDRESSES) {
    throw createError({ statusCode: 400, statusMessage: 'Too many assets' })
  }

  for (const address of addresses) {
    if (!EVM_ADDRESS_RE.test(address)) {
      throw createError({ statusCode: 400, statusMessage: 'Invalid asset address' })
    }
  }

  return [...new Set(addresses.map(address => address.toLowerCase()))]
}

const toUnixSeconds = (...timestamps: Array<string | null | undefined>): number => {
  for (const timestamp of timestamps) {
    if (!timestamp) continue
    const parsed = Date.parse(timestamp)
    if (Number.isFinite(parsed)) {
      return Math.floor(parsed / 1000)
    }
  }
  return Math.floor(Date.now() / 1000)
}

const normalizeV3Response = (
  payload: V3PricesResponse,
): BackendPriceResponse => {
  const result: BackendPriceResponse = {}
  const metaTimestamp = payload.meta?.timestamp

  for (const price of payload.data || []) {
    if (!price.address || !EVM_ADDRESS_RE.test(price.address)) continue

    const priceUsd = typeof price.priceUsd === 'number'
      ? price.priceUsd
      : typeof price.priceUsd === 'string'
        ? Number(price.priceUsd)
        : NaN

    if (!Number.isFinite(priceUsd)) continue

    const normalizedAddress = price.address.toLowerCase()
    result[normalizedAddress] = {
      address: price.address,
      price: priceUsd,
      source: price.source || 'euler-v3',
      symbol: price.symbol || '',
      timestamp: toUnixSeconds(price.timestamp, metaTimestamp),
    }
  }

  return result
}

const getCacheKey = (chainId: number, addresses: string[]): string =>
  `${chainId}:${[...addresses].sort().join(',')}`

const buildV3Url = (chainId: number, addresses: string[]): string => {
  const url = new URL('/v3/prices', getV3ApiUrl())
  url.searchParams.set('chainId', String(chainId))
  url.searchParams.set('addresses', addresses.join(','))
  return url.toString()
}

export const __test__ = {
  parseAddresses,
  normalizeV3Response,
  buildV3Url,
}

export default defineEventHandler(async (event) => {
  rateLimiter.consume(event)

  const query = getQuery(event)
  const chainId = parseChainId(query.chainId)
  const addresses = parseAddresses(query.assets, query.addresses)
  const cacheKey = getCacheKey(chainId, addresses)

  const cached = priceCache.get(cacheKey)
  if (cached) {
    setResponseHeader(event, 'Cache-Control', 'public, max-age=60')
    return cached.prices
  }

  try {
    const response = await fetchWithTimeout(buildV3Url(chainId, addresses), TIMEOUT_MS)
    if (!response.ok) {
      throw createError({
        statusCode: 502,
        statusMessage: `Euler V3 prices returned ${response.status}`,
      })
    }

    const payload = await response.json() as V3PricesResponse
    const prices = normalizeV3Response(payload)
    priceCache.set(cacheKey, { prices })
    setResponseHeader(event, 'Cache-Control', 'public, max-age=60')
    return prices
  }
  catch (error) {
    const stale = priceCache.getStale(cacheKey)
    if (stale) {
      setResponseHeader(event, 'Cache-Control', 'no-cache')
      return stale.prices
    }

    if (error && typeof error === 'object' && 'statusCode' in error) {
      throw error
    }

    const message = error instanceof Error ? error.message : 'Unknown error'
    console.warn('[prices-proxy] error:', message)
    throw createError({ statusCode: 502, statusMessage: 'Euler V3 prices upstream error' })
  }
})
