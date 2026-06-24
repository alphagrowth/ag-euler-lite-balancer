import { createError, defineEventHandler, getRequestURL, getRouterParam } from 'h3'
import { MERKL_API_BASE_URL } from '~/entities/constants'
import { createTtlCache } from '~/server/utils/cache'
import { fetchWithTimeout } from '~/server/utils/fetchWithTimeout'
import { createRateLimiter } from '~/server/utils/rate-limit'

const TIMEOUT_MS = 10_000
const CACHE_TTL_MS = 60_000
const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/
const CAMPAIGN_ID_RE = /^[a-zA-Z0-9_-]+$/

const publicCache = createTtlCache<unknown>({ ttlMs: CACHE_TTL_MS })

const rateLimiter = createRateLimiter({
  max: 1000,
  windowMs: 60_000,
  label: 'merkl-proxy',
})

export const normalizeMerklPath = (path: string | undefined): string => {
  const normalized = `/${(path || '').replace(/^\/+/, '')}`
  return normalized.length > 1 ? normalized.replace(/\/+$/, '') : normalized
}

export const isAllowedMerklPath = (path: string): boolean => {
  if (path === '/tokens/reward') return true
  if (path === '/opportunities') return true

  const segments = path.split('/').filter(Boolean)
  if (segments.length === 3 && segments[0] === 'users' && segments[2] === 'rewards') {
    return EVM_ADDRESS_RE.test(segments[1])
  }

  if (segments.length === 2 && segments[0] === 'campaigns') {
    return CAMPAIGN_ID_RE.test(segments[1])
  }

  return false
}

export const isPublicMerklPath = (path: string): boolean =>
  path === '/tokens/reward'
  || path === '/opportunities'
  || path.startsWith('/campaigns/')

export default defineEventHandler(async (event) => {
  rateLimiter.consume(event)

  const path = normalizeMerklPath(getRouterParam(event, 'path'))
  if (!isAllowedMerklPath(path)) {
    const isMalformedUserRewardsPath = path.startsWith('/users/') && path.endsWith('/rewards')
    throw createError({
      statusCode: isMalformedUserRewardsPath ? 400 : 404,
      statusMessage: isMalformedUserRewardsPath ? 'Invalid Merkl user address' : 'Unknown Merkl endpoint',
    })
  }

  const requestUrl = getRequestURL(event)
  const cacheKey = `${path}${requestUrl.search}`

  if (isPublicMerklPath(path)) {
    const cached = publicCache.get(cacheKey)
    if (cached !== undefined) return cached
  }

  const upstreamUrl = `${MERKL_API_BASE_URL}${path}${requestUrl.search}`

  try {
    const resp = await fetchWithTimeout(upstreamUrl, TIMEOUT_MS)
    if (!resp.ok) {
      throw createError({
        statusCode: 502,
        statusMessage: `Merkl upstream returned ${resp.status}`,
      })
    }

    const data = await resp.json()
    if (isPublicMerklPath(path)) {
      publicCache.set(cacheKey, data)
    }
    return data
  }
  catch (error) {
    if (error && typeof error === 'object' && 'statusCode' in error) {
      throw error
    }

    const message = error instanceof Error ? error.message : 'Unknown error'
    console.warn('[merkl-proxy] error:', message)
    throw createError({ statusCode: 502, statusMessage: 'Merkl upstream error' })
  }
})
