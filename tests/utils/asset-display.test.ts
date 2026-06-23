import { describe, expect, it } from 'vitest'
import {
  getDisplayAssetName,
  getDisplayAssetSymbol,
  toDisplayAsset,
} from '~/utils/asset-display'

const rawBeefy = {
  address: '0xd0331a023c35514c2ef99eb34ed868737e9dcea3',
  name: 'Beefy mooBalancer Monad wnUSDT0-wnAUSD-wnUSDC',
  symbol: 'mooBalancerMonadwnUSDT0-wnAUSD-wnUSDC',
  decimals: 18n,
}

const wrappedBeefy = {
  address: '0x6e58131ea11ed990d4b62476529cf2502fe0ec5f',
  name: 'WMoo Balancer Monad wnUSDT0-wnAUSD-wnUSDC',
  symbol: 'wmooBalancerMonadwnUSDT0-wnAUSD-wnUSDC',
  decimals: 18n,
}

describe('asset display metadata', () => {
  it('aliases the raw Beefy token display metadata', () => {
    expect(getDisplayAssetSymbol(rawBeefy)).toBe('Beefy USDT0-AUSD-USDC')
    expect(getDisplayAssetName(rawBeefy)).toBe('Beefy Balancer Monad wnUSDT0-wnAUSD-wnUSDC')
  })

  it('aliases the wrapped Beefy token display metadata', () => {
    expect(getDisplayAssetSymbol(wrappedBeefy)).toBe('Beefy USDT0-AUSD-USDC')
    expect(getDisplayAssetName(wrappedBeefy)).toBe('Wrapped Beefy Balancer Monad wnUSDT0-wnAUSD-wnUSDC')
  })

  it('leaves unrelated tokens unchanged', () => {
    const ausd = {
      address: '0x00000000efe302beaa2b3e6e1b18d08d69a9012a',
      name: 'AUSD',
      symbol: 'AUSD',
      decimals: 6n,
    }

    expect(toDisplayAsset(ausd)).toEqual(ausd)
  })
})
