import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, createRouter, toWebHandler } from 'h3'
import pricesHandler from '~/server/api/prices.get'

const makeHandler = () => {
  const app = createApp()
  const router = createRouter()
  router.get('/api/prices', pricesHandler)
  app.use(router)
  return toWebHandler(app)
}

const addressA = '0x0000000000000000000000000000000000000001'
const addressB = '0x0000000000000000000000000000000000000002'
const addressC = '0x0000000000000000000000000000000000000003'
const addressD = '0x0000000000000000000000000000000000000004'
const checksumA = '0x0000000000000000000000000000000000000001'
const checksumB = '0x0000000000000000000000000000000000000002'

beforeEach(() => {
  process.env.V3_API_URL = 'https://v3.euler.finance'
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  delete process.env.V3_API_URL
})

describe('/api/prices proxy', () => {
  it('validates required query parameters', async () => {
    const handler = makeHandler()

    const missingChain = await handler(new Request(`http://localhost:3000/api/prices?assets=${addressA}`))
    const invalidAddress = await handler(new Request('http://localhost:3000/api/prices?chainId=1&assets=0xnot-an-address'))

    expect(missingChain.status).toBe(400)
    expect(invalidAddress.status).toBe(400)
  })

  it('builds a V3 prices request and normalizes the response into the legacy map shape', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        data: [
          {
            chainId: 1,
            address: checksumA,
            symbol: 'AAA',
            priceUsd: 123.45,
            source: 'pyth',
            timestamp: '2026-06-25T12:00:00.000Z',
          },
        ],
        meta: { timestamp: '2026-06-25T12:00:10.000Z' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const handler = makeHandler()

    const response = await handler(new Request(`http://localhost:3000/api/prices?chainId=1&assets=${addressA}`))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      [addressA]: {
        address: checksumA,
        price: 123.45,
        source: 'pyth',
        symbol: 'AAA',
        timestamp: 1782388800,
      },
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const upstream = new URL(fetchMock.mock.calls[0]?.[0] as string)
    expect(upstream.origin).toBe('https://v3.euler.finance')
    expect(upstream.pathname).toBe('/v3/prices')
    expect(upstream.searchParams.get('chainId')).toBe('1')
    expect(upstream.searchParams.get('addresses')).toBe(addressA)
  })

  it('accepts addresses as an alias and treats partial V3 responses as successful', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        data: [
          {
            chainId: 143,
            address: checksumB,
            symbol: 'BBB',
            priceUsd: 2,
            source: null,
            timestamp: null,
          },
        ],
        meta: { timestamp: '2026-06-25T12:01:00.000Z' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const handler = makeHandler()

    const response = await handler(new Request(`http://localhost:3000/api/prices?chainId=143&addresses=${addressB},${addressC}`))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      [addressB]: {
        address: checksumB,
        price: 2,
        source: 'euler-v3',
        symbol: 'BBB',
        timestamp: 1782388860,
      },
    })
  })

  it('serves repeated reads from fresh cache', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        data: [
          {
            address: addressC,
            symbol: 'CCC',
            priceUsd: 3,
            source: 'v3',
            timestamp: '2026-06-25T12:02:00.000Z',
          },
        ],
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const handler = makeHandler()
    const url = `http://localhost:3000/api/prices?chainId=144&assets=${addressC}`

    const first = await handler(new Request(url))
    const second = await handler(new Request(url))

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(await first.json()).toEqual(await second.json())
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('serves stale cache after an upstream failure', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-25T12:03:00.000Z'))

    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          data: [
            {
              address: addressD,
              symbol: 'DDD',
              priceUsd: 4,
              source: 'v3',
              timestamp: '2026-06-25T12:03:00.000Z',
            },
          ],
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(new Response('bad gateway', { status: 502 }))

    const handler = makeHandler()
    const url = `http://localhost:3000/api/prices?chainId=145&assets=${addressD}`
    const first = await handler(new Request(url))

    vi.setSystemTime(new Date('2026-06-25T12:05:00.000Z'))
    const second = await handler(new Request(url))
    vi.useRealTimers()

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(await first.json()).toEqual(await second.json())
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('returns 502 when upstream fails and no stale cache exists', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('bad gateway', { status: 502 }))
    const handler = makeHandler()

    const response = await handler(new Request(`http://localhost:3000/api/prices?chainId=146&assets=0x0000000000000000000000000000000000000005`))

    expect(response.status).toBe(502)
  })
})
