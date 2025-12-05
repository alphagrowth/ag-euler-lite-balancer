import { ethers } from 'ethers'

export const nanoToValue = (src: bigint | number | string, decimals: number | bigint = 9) => {
  return +ethers.formatUnits(src, decimals)
}

export const valueToNano = (src: number | string, decimals: number | bigint = 9) => {
  if (!src) {
    return 0n
  }
  const parts = String(src).split('.')
  const value = parts[0] + '.' + (parts[1] || '').substring(0, Number(decimals))
  return ethers.parseUnits(value, decimals)
}

export const TTL_INFINITY = BigInt(
  '0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF',
)
export const TTL_MORE_THAN_ONE_YEAR = TTL_INFINITY - BigInt(1)
export const TTL_LIQUIDATION = -BigInt(1)
export const TTL_ERROR = -BigInt(2)

export interface FormatTtlResult {
  display: string
  type: 'success' | 'error' | 'warning' | 'info'
  days?: number
}

export function formatTtl(ttl?: bigint): FormatTtlResult | undefined {
  if (ttl === undefined || ttl === null) {
    return undefined
  }

  if (ttl === TTL_INFINITY) {
    return { display: '∞', type: 'success' }
  }

  if (ttl === TTL_MORE_THAN_ONE_YEAR) {
    return { display: '>1 year', type: 'success' }
  }

  if (ttl === TTL_LIQUIDATION) {
    return { display: 'Liquidated', type: 'error' }
  }

  if (ttl === TTL_ERROR) {
    return { display: 'Error', type: 'error' }
  }

  if (ttl === 0n) {
    return { display: '<1 day', type: 'error' }
  }

  const days = Number(ttl)

  if (isNaN(days) || days < 0) {
    return undefined
  }

  if (days < 1) {
    return { display: '<1 day', type: 'error', days }
  }

  if (days < 2) {
    return { display: `${days} day`, type: 'error', days }
  }

  if (days < 7) {
    return { display: `${days} days`, type: 'warning', days }
  }

  if (days < 14) {
    return { display: `${days} days`, type: 'info', days }
  }

  return { display: `${days} days`, type: 'success', days }
}

export function formatTtlRelative(ttl?: bigint): string {
  const result = formatTtl(ttl)

  if (!result) {
    return '-'
  }

  if (result.days !== undefined && result.days >= 1) {
    return `in ${result.display}`
  }

  return result.display
}
