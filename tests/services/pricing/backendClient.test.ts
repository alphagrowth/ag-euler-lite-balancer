import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearBackendCache,
  configureBackend,
  fetchBackendPrices,
  fetchBackendPrice,
} from '~/services/pricing/backendClient'

const addressA = '0x0000000000000000000000000000000000000011'
const addressB = '0x0000000000000000000000000000000000000012'

beforeEach(() => {
  clearBackendCache()
  configureBackend('/api/prices', 1)
})

afterEach(() => {
  vi.restoreAllMocks()
  clearBackendCache()
  configureBackend('/api/prices', 1)
})

describe('pricing backend client', () => {
  it('calls the same-origin /api/prices proxy with the legacy assets query', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        [addressA]: {
          address: addressA,
          price: 1.5,
          source: 'euler-v3',
          symbol: 'AAA',
          timestamp: 1782388800,
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const result = await fetchBackendPrices([addressA], 143)

    expect(result?.get(addressA)).toEqual({
      address: addressA,
      price: 1.5,
      source: 'euler-v3',
      symbol: 'AAA',
      timestamp: 1782388800,
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const url = new URL(fetchMock.mock.calls[0]?.[0] as string)
    expect(url.origin).toBe('http://localhost')
    expect(url.pathname).toBe('/api/prices')
    expect(url.searchParams.get('chainId')).toBe('143')
    expect(url.searchParams.get('assets')).toBe(addressA)
  })

  it('supports relative proxy URLs when fetching a single price', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        [addressB]: {
          address: addressB,
          price: 2.5,
          source: 'euler-v3',
          symbol: 'BBB',
          timestamp: 1782388860,
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const result = await fetchBackendPrice(addressB, 144)

    expect(result).toEqual({
      address: addressB,
      price: 2.5,
      source: 'euler-v3',
      symbol: 'BBB',
      timestamp: 1782388860,
    })
  })

  it('serves repeated reads from the client cache', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        [addressA]: {
          address: addressA,
          price: 3.5,
          source: 'euler-v3',
          symbol: 'AAA',
          timestamp: 1782388920,
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const first = await fetchBackendPrices([addressA], 145)
    const second = await fetchBackendPrices([addressA], 145)

    expect(first?.get(addressA)).toEqual(second?.get(addressA))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
