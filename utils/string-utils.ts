export const truncate = (string = '', length = 6) => {
  return string.slice(0, length) + '...' + string.slice(string.length - 4, string.length)
}

// Truncate address to first 19 bytes (0x + 38 hex chars) for subgraph optimization
export const truncateAddressForSubgraph = (address: string): string => {
  return address.toLowerCase().slice(0, 40)
}

export const formatNumber = (value: string | number = 0, maximumFractionDigits = 2, minimumFractionDigits = 2) => {
  const num = Number(value)
  if (!Number.isFinite(num)) return '-'
  return num.toLocaleString('en-US', { minimumFractionDigits, maximumFractionDigits })
}

/**
 * Format USD value with smart handling of small amounts.
 * - Shows "<$0.01" for small positive values (0 < value < 0.01)
 * - Shows "$0.00" for zero or negative tiny values
 * - Shows normal formatting for larger values
 */
export const formatUsdValue = (value: string | number = 0, maximumFractionDigits = 2): string => {
  const numericValue = Number(value)
  if (!Number.isFinite(numericValue)) {
    return '$0.00'
  }
  if (numericValue > 0 && numericValue < 0.01) {
    return '<$0.01'
  }
  if (numericValue < 0 && numericValue > -0.01) {
    return '-<$0.01'
  }
  return `$${formatNumber(numericValue, maximumFractionDigits)}`
}

export const formatSignificant = (value: string | number = 0, maximumSignificantDigits = 2) => {
  const numericValue = Number(value)
  if (!Number.isFinite(numericValue)) {
    return '0'
  }
  return new Intl.NumberFormat('en-US', {
    maximumSignificantDigits,
    useGrouping: false,
  }).format(numericValue)
}

export const compactNumber = (value: string | number = 0, maximumFractionDigits = 2, minimumFractionDigits = 0) => {
  return Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits,
    minimumFractionDigits,
  }).format(Number(value))
}

/**
 * Format USD value with compact notation for large amounts.
 * - Shows "<$0.01" for small positive values (0 < value < 0.01)
 * - Shows "$0" for zero
 * - Uses compact notation (e.g., $1.5M, $2.3K) for larger values
 */
export const formatCompactUsdValue = (value: string | number = 0, maximumFractionDigits = 2): string => {
  const numericValue = Number(value)
  if (!Number.isFinite(numericValue)) {
    return '$0'
  }
  if (numericValue > 0 && numericValue < 0.01) {
    return '<$0.01'
  }
  if (numericValue < 0 && numericValue > -0.01) {
    return '-<$0.01'
  }
  return `$${compactNumber(numericValue, maximumFractionDigits)}`
}

export const preciseNumber = (value: string | number, decimals = 36) => {
  return Intl.NumberFormat('en-US', { maximumFractionDigits: decimals, useGrouping: false }).format(Number(value))
}

export const stringToColor = (value: string, saturation = 40, lightness = 45) => {
  let hash = 0
  for (let i = 0; i < value.length; i++) {
    hash = value.charCodeAt(i) + ((hash << 5) - hash)
    hash = hash & hash
  }
  return `hsl(${(hash % 360)}, ${saturation}%, ${lightness}%)`
}
