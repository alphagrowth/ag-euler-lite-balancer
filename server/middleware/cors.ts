import { createError, getRequestURL, setResponseHeader, sendNoContent } from 'h3'

function parseAllowedOrigins(): Set<string> {
  const appUrl = process.env.NUXT_PUBLIC_APP_URL?.trim()
  const isDevelopment = process.env.NODE_ENV === 'development'

  if (isDevelopment) {
    const origins = new Set<string>()
    const ports = [3000, 3001, 3002, 3003]
    for (const port of ports) {
      origins.add(`http://localhost:${port}`)
      origins.add(`https://localhost:${port}`)
      origins.add(`http://127.0.0.1:${port}`)
      origins.add(`https://127.0.0.1:${port}`)
    }
    if (appUrl && appUrl !== '*') {
      appUrl.split(',').forEach((url) => origins.add(url.trim()))
    }
    return origins
  }

  if (!appUrl || appUrl === '*') {
    throw new Error('NUXT_PUBLIC_APP_URL must be set in production (comma-separated list of allowed origins)')
  }

  const origins = new Set<string>()
  appUrl.split(',').forEach((url) => origins.add(url.trim()))
  return origins
}

const allowedOrigins = parseAllowedOrigins()

export default defineEventHandler((event) => {
  const rawCountry = event.node.req.headers['x-country-code']
  const country = (typeof rawCountry === 'string' && /^[A-Z]{2}$/.test(rawCountry))
    ? rawCountry
    : undefined
  if (country) {
    setResponseHeader(event, 'x-country-code', country)
  }

  const url = getRequestURL(event)

  if (!url.pathname.startsWith('/api/')) {
    return
  }

  // Always set Vary: Origin so CDNs/proxies don't serve a cached
  // response (including preflights) for one origin to another.
  setResponseHeader(event, 'Vary', 'Origin')

  const origin = event.node.req.headers.origin

  if (origin && allowedOrigins.has(origin)) {
    setResponseHeader(event, 'Access-Control-Allow-Origin', origin)
  } else if (origin && process.env.NODE_ENV === 'production') {
    if (allowedOrigins.size > 0) {
      console.warn('[cors] Rejected origin not in allow list:', origin)
    }
    throw createError({ statusCode: 403, statusMessage: 'Origin not allowed' })
  }

  setResponseHeader(event, 'Access-Control-Allow-Methods', 'POST, OPTIONS')
  setResponseHeader(event, 'Access-Control-Allow-Headers', 'Content-Type')

  if (event.node.req.method === 'OPTIONS') {
    setResponseHeader(event, 'Access-Control-Max-Age', 86400)
    return sendNoContent(event)
  }
})
