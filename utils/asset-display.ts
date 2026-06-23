import { getAddress } from 'viem'

type AssetDisplayOverride = {
  symbol: string
  name: string
}

type AssetLike = {
  address?: string | null
  symbol?: string
  name?: string
}

const BEEFY_RAW_TOKEN = '0xd0331a023c35514c2ef99eb34ed868737e9dcea3'
const BEEFY_WRAPPED_TOKEN = '0x6e58131ea11ed990d4b62476529cf2502fe0ec5f'
const BALANCER_USDT0_AUSD_USDC = '0x2daa146dfb7eaef0038f9f15b2ec1e4de003f72b'
const BALANCER_AZND_AUSD_LOAZND = '0xbddb004a6c393c3f83bcccf7f07ee9d409b214de'
const BALANCER_SMON_WMON = '0x02b34a02db24179ac2d77ae20aa6215c7153e7f8'
const BALANCER_SHMON_WMON = '0x340fa62ae58e90473da64b0af622cdd6113106cb'

const displayOverrides = new Map<string, AssetDisplayOverride>([
  [BEEFY_RAW_TOKEN, {
    symbol: 'Beefy USDT0-AUSD-USDC',
    name: 'Beefy Balancer Monad wnUSDT0-wnAUSD-wnUSDC',
  }],
  [BEEFY_WRAPPED_TOKEN, {
    symbol: 'Beefy USDT0-AUSD-USDC',
    name: 'Wrapped Beefy Balancer Monad wnUSDT0-wnAUSD-wnUSDC',
  }],
  [BALANCER_USDT0_AUSD_USDC, {
    symbol: 'Balancer USDT0-AUSD-USDC',
    name: 'Balancer wnAUSD-wnUSDC-wnUSDT0',
  }],
  [BALANCER_AZND_AUSD_LOAZND, {
    symbol: 'Balancer AZND-AUSD-loAZND',
    name: 'Balancer wnLOAZND-AZND-wnAUSD',
  }],
  [BALANCER_SMON_WMON, {
    symbol: 'Balancer sMON-WMON',
    name: 'Balancer wnSMON-wnWMON',
  }],
  [BALANCER_SHMON_WMON, {
    symbol: 'Balancer shMON-WMON',
    name: 'Balancer wnSHMON-wnWMON',
  }],
])

const normalizeAddress = (address?: string | null): string | null => {
  if (!address) return null
  try {
    return getAddress(address).toLowerCase()
  }
  catch {
    return address.toLowerCase()
  }
}

export const getAssetDisplayOverride = (address?: string | null): AssetDisplayOverride | undefined => {
  const key = normalizeAddress(address)
  return key ? displayOverrides.get(key) : undefined
}

export const getDisplayAssetSymbol = (asset?: AssetLike | null): string =>
  getAssetDisplayOverride(asset?.address)?.symbol ?? asset?.symbol ?? ''

export const getDisplayAssetName = (asset?: AssetLike | null): string =>
  getAssetDisplayOverride(asset?.address)?.name ?? asset?.name ?? getDisplayAssetSymbol(asset)

export const getDisplayAssetSymbolByAddress = (address?: string | null, fallback = ''): string =>
  getAssetDisplayOverride(address)?.symbol ?? fallback

export const getDisplayAssetNameByAddress = (address?: string | null, fallback = ''): string =>
  getAssetDisplayOverride(address)?.name ?? fallback

export const toDisplayAsset = <T extends AssetLike>(asset: T): T => {
  const override = getAssetDisplayOverride(asset.address)
  if (!override) return asset

  return {
    ...asset,
    symbol: override.symbol,
    ...(asset.name !== undefined ? { name: override.name } : {}),
  }
}
