import { createError, getHeader, getMethod, readRawBody, setResponseHeader, setResponseStatus } from 'h3'
import { resolveRpcUrl } from '~/server/utils/rpc'

export default defineEventHandler(async (event) => {
  const chainIdRaw = event.context.params?.chainId
  const chainId = Number(chainIdRaw)

  if (!Number.isFinite(chainId)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid chainId' })
  }

  if (getMethod(event) !== 'POST') {
    throw createError({ statusCode: 405, statusMessage: 'Method Not Allowed' })
  }

  const { public: { network } } = useRuntimeConfig()
  const rpcUrl = resolveRpcUrl(chainId, network)
  if (!rpcUrl) {
    throw createError({ statusCode: 404, statusMessage: 'RPC not configured' })
  }

  const rawBody = await readRawBody(event)
  const contentType = getHeader(event, 'content-type') || 'application/json'

  const response = await fetch(rpcUrl, {
    method: 'POST',
    body: rawBody ?? undefined,
    headers: {
      'content-type': contentType,
    },
  })

  setResponseStatus(event, response.status)
  setResponseHeader(event, 'content-type', response.headers.get('content-type') || 'application/json')

  return await response.text()
})
