export const truncate = (string = '', length = 6) => {
  return string.slice(0, length) + '...' + string.slice(string.length - 4, string.length)
}

// Truncate address to first 19 bytes (0x + 38 hex chars) for subgraph optimization
export const truncateAddressForSubgraph = (address: string): string => {
  return address.toLowerCase().slice(0, 40)
}

export const formatNumber = (value: string | number = 0, maximumFractionDigits = 2, minimumFractionDigits = 2) =>
  Number(value).toLocaleString('en-US', { minimumFractionDigits, maximumFractionDigits })

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

export const preciseNumber = (value: string | number, decimals = 36) => {
  return Intl.NumberFormat('en-US', { maximumFractionDigits: decimals, useGrouping: false }).format(Number(value))
}

export const stringToColor = (value: string, saturation = 20, lightness = 20) => {
  let hash = 0
  for (let i = 0; i < value.length; i++) {
    hash = value.charCodeAt(i) + ((hash << 5) - hash)
    hash = hash & hash
  }
  return `hsl(${(hash % 360)}, ${saturation}%, ${lightness}%)`
}
