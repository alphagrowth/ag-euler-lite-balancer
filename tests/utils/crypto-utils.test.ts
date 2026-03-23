import { describe, it, expect } from 'vitest'
import {
  nanoToValue,
  valueToNano,
  formatTtl,
  formatTtlRelative,
  roundAndCompactTokens,
} from '~/utils/crypto-utils'

describe('nanoToValue', () => {
  it('converts bigint to number with default 9 decimals', () => {
    expect(nanoToValue(1_000_000_000n, 9)).toBe(1)
  })

  it('converts with 18 decimals', () => {
    expect(nanoToValue(1n * 10n ** 18n, 18)).toBe(1)
  })

  it('converts with 6 decimals', () => {
    expect(nanoToValue(1_500_000n, 6)).toBe(1.5)
  })

  it('handles zero', () => {
    expect(nanoToValue(0n, 18)).toBe(0)
  })

  it('handles string input', () => {
    expect(nanoToValue('1000000', 6)).toBe(1)
  })
})

describe('valueToNano', () => {
  it('converts number to bigint with decimals', () => {
    expect(valueToNano(1, 9)).toBe(1_000_000_000n)
  })

  it('converts with 18 decimals', () => {
    expect(valueToNano(1, 18)).toBe(10n ** 18n)
  })

  it('returns 0n for zero', () => {
    expect(valueToNano(0, 9)).toBe(0n)
  })

  it('returns 0n for empty string', () => {
    expect(valueToNano('', 9)).toBe(0n)
  })

  it('truncates excess decimal places', () => {
    // "1.123456789" with 6 decimals → truncates to "1.123456"
    expect(valueToNano('1.123456789', 6)).toBe(1_123_456n)
  })

  it('handles string input', () => {
    expect(valueToNano('1.5', 6)).toBe(1_500_000n)
  })
})

describe('formatTtl', () => {
  const TTL_INFINITY = BigInt('0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')
  const TTL_MORE_THAN_ONE_YEAR = TTL_INFINITY - 1n
  const TTL_LIQUIDATION = -1n
  const TTL_ERROR = -2n

  it('returns undefined for undefined', () => {
    expect(formatTtl(undefined)).toBeUndefined()
  })

  it('returns infinity display for TTL_INFINITY', () => {
    expect(formatTtl(TTL_INFINITY)).toEqual({ display: '∞', type: 'success' })
  })

  it('returns >1 year for TTL_MORE_THAN_ONE_YEAR', () => {
    expect(formatTtl(TTL_MORE_THAN_ONE_YEAR)).toEqual({ display: '>1 year', type: 'success' })
  })

  it('returns liquidation message for TTL_LIQUIDATION', () => {
    expect(formatTtl(TTL_LIQUIDATION)).toEqual({ display: 'Eligible for liquidation', type: 'error' })
  })

  it('returns error for TTL_ERROR', () => {
    expect(formatTtl(TTL_ERROR)).toEqual({ display: 'Error', type: 'error' })
  })

  it('returns <1 day for 0', () => {
    expect(formatTtl(0n)).toEqual({ display: '<1 day', type: 'error' })
  })

  it('returns singular day for 1', () => {
    expect(formatTtl(1n)).toEqual({ display: '1 day', type: 'error', days: 1 })
  })

  it('returns warning for 3 days', () => {
    expect(formatTtl(3n)).toEqual({ display: '3 days', type: 'warning', days: 3 })
  })

  it('returns info for 10 days', () => {
    expect(formatTtl(10n)).toEqual({ display: '10 days', type: 'info', days: 10 })
  })

  it('returns success for 30 days', () => {
    expect(formatTtl(30n)).toEqual({ display: '30 days', type: 'success', days: 30 })
  })
})

describe('formatTtlRelative', () => {
  it('returns dash for undefined', () => {
    expect(formatTtlRelative(undefined)).toBe('-')
  })

  it('prefixes with "in" for day counts', () => {
    expect(formatTtlRelative(10n)).toBe('in 10 days')
  })

  it('does not prefix special messages', () => {
    expect(formatTtlRelative(0n)).toBe('<1 day')
  })
})

describe('roundAndCompactTokens', () => {
  it('returns 0 for zero amount', () => {
    expect(roundAndCompactTokens(0n, 18n)).toBe('0')
  })

  // Note: roundAndCompactTokens internally calls compactNumber which is a Nuxt auto-import.
  // Tests that exercise the compactNumber path require @nuxt/test-utils for auto-import resolution.
  // The zero-amount path is testable without it.
})
