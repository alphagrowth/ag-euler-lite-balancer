import { describe, expect, it } from 'vitest'
import {
  getAssetLogoKeyByAddress,
  getDisplayAssetName,
  getDisplayAssetSymbol,
  toDisplayAsset,
} from '~/utils/asset-display'

const rawBeefy = {
  address: '0xd0331a023c35514c2ef99eb34ed868737e9dcea3',
  name: 'Beefy mooBalancer Monad wnUSDT0-wnAUSD-wnUSDC',
  symbol: 'mooBalancerMonadwnUSDT0-wnAUSD-wnUSDC',
  decimals: 18n,
  logoKey: 'beefy-usdt0-ausd-usdc',
}

const wrappedBeefy = {
  address: '0x6e58131ea11ed990d4b62476529cf2502fe0ec5f',
  name: 'WMoo Balancer Monad wnUSDT0-wnAUSD-wnUSDC',
  symbol: 'wmooBalancerMonadwnUSDT0-wnAUSD-wnUSDC',
  decimals: 18n,
  logoKey: 'beefy-usdt0-ausd-usdc',
}

const balancerAssets = [
  {
    address: '0x2DAA146dfB7EAef0038F9F15B2EC1e4DE003f72b',
    name: 'Balancer wnAUSD-wnUSDC-wnUSDT0',
    symbol: 'wnAUSD-wnUSDC-wnUSDT0',
    displayName: 'Balancer wnAUSD-wnUSDC-wnUSDT0',
    displaySymbol: 'Balancer USDT0-AUSD-USDC',
    logoKey: 'wnAUSD-wnUSDC-wnUSDT0',
  },
  {
    address: '0xbddb004A6c393C3F83BCCCF7F07eE9d409b214dE',
    name: 'Balancer wnLOAZND-AZND-wnAUSD',
    symbol: 'wnLOAZND-AZND-wnAUSD',
    displayName: 'Balancer wnLOAZND-AZND-wnAUSD',
    displaySymbol: 'Balancer AZND-AUSD-loAZND',
    logoKey: 'wnLOAZND-AZND-wnAUSD',
  },
  {
    address: '0x02b34a02db24179Ac2D77Ae20AA6215C7153E7f8',
    name: 'Balancer wnSMON-wnWMON',
    symbol: 'wnSMON-wnWMON',
    displayName: 'Balancer wnSMON-wnWMON',
    displaySymbol: 'Balancer sMON-WMON',
    logoKey: 'smon-wnwmon',
  },
  {
    address: '0x340Fa62AE58e90473da64b0af622cdd6113106Cb',
    name: 'Balancer wnSHMON-wnWMON',
    symbol: 'wnSHMON-wnWMON',
    displayName: 'Balancer wnSHMON-wnWMON',
    displaySymbol: 'Balancer shMON-WMON',
    logoKey: 'shmon-wnwmon',
  },
]

describe('asset display metadata', () => {
  it('aliases the raw Beefy token display metadata', () => {
    expect(getDisplayAssetSymbol(rawBeefy)).toBe('Beefy USDT0-AUSD-USDC')
    expect(getDisplayAssetName(rawBeefy)).toBe('Beefy Balancer Monad wnUSDT0-wnAUSD-wnUSDC')
    expect(getAssetLogoKeyByAddress(rawBeefy.address)).toBe(rawBeefy.logoKey)
  })

  it('aliases the wrapped Beefy token display metadata', () => {
    expect(getDisplayAssetSymbol(wrappedBeefy)).toBe('Beefy USDT0-AUSD-USDC')
    expect(getDisplayAssetName(wrappedBeefy)).toBe('Wrapped Beefy Balancer Monad wnUSDT0-wnAUSD-wnUSDC')
    expect(getAssetLogoKeyByAddress(wrappedBeefy.address)).toBe(wrappedBeefy.logoKey)
  })

  it.each(balancerAssets)('aliases $symbol display metadata', (asset) => {
    expect(getDisplayAssetSymbol(asset)).toBe(asset.displaySymbol)
    expect(getDisplayAssetName(asset)).toBe(asset.displayName)
    expect(getAssetLogoKeyByAddress(asset.address)).toBe(asset.logoKey)
  })

  it('leaves unrelated tokens unchanged', () => {
    const ausd = {
      address: '0x00000000efe302beaa2b3e6e1b18d08d69a9012a',
      name: 'AUSD',
      symbol: 'AUSD',
      decimals: 6n,
    }

    expect(toDisplayAsset(ausd)).toEqual(ausd)
    expect(getAssetLogoKeyByAddress(ausd.address)).toBeUndefined()
  })
})
