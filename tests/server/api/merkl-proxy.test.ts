import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, createRouter, toWebHandler } from 'h3'
import merklProxyHandler, { isAllowedMerklPath, isPublicMerklPath, normalizeMerklPath } from '~/server/api/merkl/[...path].get'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('merkl proxy path validation', () => {
  it('normalizes catch-all route paths', () => {
    expect(normalizeMerklPath('opportunities')).toBe('/opportunities')
    expect(normalizeMerklPath('/opportunities/')).toBe('/opportunities')
    expect(normalizeMerklPath('users/0x08334B4118f57ef2FBb547e4040e2EEeE0b0ad05/rewards')).toBe('/users/0x08334B4118f57ef2FBb547e4040e2EEeE0b0ad05/rewards')
  })

  it('allows Merkl opportunity and token endpoints used by APY reads', () => {
    expect(isAllowedMerklPath('/opportunities')).toBe(true)
    expect(isAllowedMerklPath('/tokens/reward')).toBe(true)
  })

  it('allows user rewards only for valid EVM addresses', () => {
    expect(isAllowedMerklPath('/users/0x08334B4118f57ef2FBb547e4040e2EEeE0b0ad05/rewards')).toBe(true)
    expect(isAllowedMerklPath('/users/0xnot-an-address/rewards')).toBe(false)
  })

  it('keeps the proxy allowlist narrow', () => {
    expect(isAllowedMerklPath('/')).toBe(false)
    expect(isAllowedMerklPath('/users/0x08334B4118f57ef2FBb547e4040e2EEeE0b0ad05')).toBe(false)
    expect(isAllowedMerklPath('/https://api.example.com')).toBe(false)
    expect(isAllowedMerklPath('/opportunities/anything')).toBe(false)
  })

  it('marks public reads as cacheable but leaves user rewards uncached', () => {
    expect(isPublicMerklPath('/opportunities')).toBe(true)
    expect(isPublicMerklPath('/tokens/reward')).toBe(true)
    expect(isPublicMerklPath('/campaigns/campaign-1')).toBe(true)
    expect(isPublicMerklPath('/users/0x08334B4118f57ef2FBb547e4040e2EEeE0b0ad05/rewards')).toBe(false)
  })

  it('serves repeated public reads from cache', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify([{ identifier: 'monad_aUSD' }]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const app = createApp()
    const router = createRouter()
    router.get('/api/merkl/:path', merklProxyHandler)
    app.use(router)
    const handler = toWebHandler(app)
    const url = 'http://localhost:3000/api/merkl/opportunities?chainId=143&type=EULER&campaigns=true'

    const first = await handler(new Request(url))
    const second = await handler(new Request(url))

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(await first.json()).toEqual([{ identifier: 'monad_aUSD' }])
    expect(await second.json()).toEqual([{ identifier: 'monad_aUSD' }])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.merkl.xyz/v4/opportunities?chainId=143&type=EULER&campaigns=true')
  })
})
