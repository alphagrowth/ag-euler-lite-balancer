import { createError, getRequestURL } from 'h3'

// 1 MB for RPC, 2 MB for Tenderly
const RPC_LIMIT = 1 * 1024 * 1024
const TENDERLY_LIMIT = 2 * 1024 * 1024
const DEFAULT_LIMIT = 1 * 1024 * 1024

function getLimit(pathname: string): number {
  if (pathname.startsWith('/api/tenderly/')) return TENDERLY_LIMIT
  if (pathname.startsWith('/api/rpc/')) return RPC_LIMIT
  return DEFAULT_LIMIT
}

export default defineEventHandler((event) => {
  const method = event.node.req.method
  if (!method || method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return
  }

  const url = getRequestURL(event)
  if (!url.pathname.startsWith('/api/')) {
    return
  }

  const contentLength = event.node.req.headers['content-length']
  if (!contentLength) {
    return
  }

  const length = parseInt(contentLength, 10)
  if (Number.isNaN(length)) {
    return
  }

  const limit = getLimit(url.pathname)
  if (length > limit) {
    throw createError({
      statusCode: 413,
      statusMessage: 'Payload Too Large',
    })
  }
})
