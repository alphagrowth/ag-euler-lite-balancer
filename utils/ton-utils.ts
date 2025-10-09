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
