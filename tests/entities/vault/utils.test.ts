import { describe, it, expect } from 'vitest'
import { getUtilization } from '~/entities/vault/utils'

describe('getUtilization', () => {
  it('returns 0 when totalAssets is zero', () => {
    expect(getUtilization(0n, 100n)).toBe(0)
  })

  it('returns 0 when totalBorrow is zero', () => {
    expect(getUtilization(1000n, 0n)).toBe(0)
  })

  it('returns 0 when totalAssets is negative', () => {
    expect(getUtilization(-1n, 100n)).toBe(0)
  })

  it('calculates utilization correctly', () => {
    // borrow=750, assets=1000 → 75%
    expect(getUtilization(1000n, 750n)).toBe(75)
  })

  it('handles 100% utilization', () => {
    expect(getUtilization(1000n, 1000n)).toBe(100)
  })

  it('rounds to 2 decimal places', () => {
    // borrow=333, assets=1000 → 33.3%
    expect(getUtilization(1000n, 333n)).toBe(33.3)
  })
})
