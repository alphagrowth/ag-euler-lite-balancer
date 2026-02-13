import { createError, readBody } from 'h3'

const SCREENING_TIMEOUT_MS = 5000

function isValidAddress(value: unknown): value is string {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value)
}

export default defineEventHandler(async (event) => {
  const body = await readBody(event)

  if (!body || !isValidAddress(body.address)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid address' })
  }

  const address = body.address
  const vpnIsUsed = String(body.vpnIsUsed ?? false)

  // Prefer server-only name; fall back to legacy public name during migration
  const screeningUri = process.env.WALLET_SCREENING_URI || process.env.NUXT_PUBLIC_WALLET_SCREENING_URI

  if (!screeningUri) {
    // If not configured, allow all (same behavior as current client-side)
    return { addressIsSuspicious: false }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), SCREENING_TIMEOUT_MS)

  try {
    const resp = await fetch(screeningUri, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address, chain: 'all', vpnIsUsed }),
      signal: controller.signal,
    })

    if (!resp.ok) {
      console.warn('[screen-address] TRM API returned', resp.status)
      // Fail open on API errors (same as current client-side behavior)
      return { addressIsSuspicious: false }
    }

    const data = await resp.json()
    const isSuspicious = Boolean(data?.addressIsSuspicious)

    if (isSuspicious) {
      console.warn('[screen-address] Flagged address:', address)
    }

    return { addressIsSuspicious: isSuspicious }
  }
  catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      console.warn('[screen-address] TRM API timeout')
    } else {
      console.warn('[screen-address] TRM API error:', error)
    }
    // Fail open on errors (same as current client-side behavior)
    return { addressIsSuspicious: false }
  }
  finally {
    clearTimeout(timeout)
  }
})
