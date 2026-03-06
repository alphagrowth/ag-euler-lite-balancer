import { createError } from 'h3'
import { createRateLimiter } from '~/server/utils/rate-limit'
import { STABLEWATCH_POOLS_URL } from '~/entities/constants'

const TIMEOUT_MS = 10_000

const rateLimiter = createRateLimiter({
  max: 100,
  windowMs: 60_000,
  label: 'stablewatch-pools',
})

export default defineEventHandler(async (event) => {
  rateLimiter.consume(event)

  const apiKey = process.env.STABLEWATCH_API_KEY

  if (!apiKey) {
    return { pools: [] }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const url = `${STABLEWATCH_POOLS_URL}?api_key=${encodeURIComponent(apiKey)}`
    const resp = await fetch(url, { signal: controller.signal })

    if (!resp.ok) {
      console.warn('[stablewatch-pools] API returned', resp.status)
      throw createError({ statusCode: 502, statusMessage: 'Upstream error' })
    }

    const data = await resp.json()
    return data
  }
  catch (error) {
    if (error && typeof error === 'object' && 'statusCode' in error) {
      throw error
    }
    console.warn('[stablewatch-pools] API error:', error)
    throw createError({ statusCode: 502, statusMessage: 'Upstream error' })
  }
  finally {
    clearTimeout(timeout)
  }
})
