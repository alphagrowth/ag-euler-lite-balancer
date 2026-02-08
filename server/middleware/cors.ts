import { getRequestURL, setResponseHeader, sendNoContent } from 'h3'

export default defineEventHandler((event) => {
  const url = getRequestURL(event)

  if (!url.pathname.startsWith('/api/')) {
    return
  }

  const allowedOrigin = process.env.APP_URL || '*'
  const origin = event.node.req.headers.origin

  if (allowedOrigin === '*') {
    setResponseHeader(event, 'Access-Control-Allow-Origin', '*')
  }
  else if (origin && origin === allowedOrigin) {
    setResponseHeader(event, 'Access-Control-Allow-Origin', origin)
    setResponseHeader(event, 'Vary', 'Origin')
  }

  setResponseHeader(event, 'Access-Control-Allow-Methods', 'POST, OPTIONS')
  setResponseHeader(event, 'Access-Control-Allow-Headers', 'Content-Type')

  if (event.node.req.method === 'OPTIONS') {
    setResponseHeader(event, 'Access-Control-Max-Age', '86400')
    return sendNoContent(event)
  }
})
