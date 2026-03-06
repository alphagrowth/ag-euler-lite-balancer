import { createError, readBody } from 'h3'
import { createRateLimiter } from '~/server/utils/rate-limit'
import { FUUL_API_BASE_URL } from '~/entities/constants'

const TIMEOUT_MS = 10_000

const rateLimiter = createRateLimiter({
  max: 30,
  windowMs: 60_000,
  label: 'fuul-claim-checks',
})

export default defineEventHandler(async (event) => {
  rateLimiter.consume(event)

  const apiKey = process.env.FUUL_API_KEY
  if (!apiKey) {
    throw createError({ statusCode: 503, statusMessage: 'Fuul API key not configured' })
  }

  const body = await readBody(event)
  if (!body?.userIdentifier) {
    throw createError({ statusCode: 400, statusMessage: 'userIdentifier is required' })
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const resp = await fetch(`${FUUL_API_BASE_URL}/claim-checks/claim`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        userIdentifier: body.userIdentifier,
        userIdentifierType: 'evm_address',
      }),
      signal: controller.signal,
    })

    if (!resp.ok) {
      throw createError({ statusCode: 502, statusMessage: 'Upstream error' })
    }

    return await resp.json()
  }
  catch (error) {
    if (error && typeof error === 'object' && 'statusCode' in error) {
      throw error
    }
    throw createError({ statusCode: 502, statusMessage: 'Upstream error' })
  }
  finally {
    clearTimeout(timeout)
  }
})
