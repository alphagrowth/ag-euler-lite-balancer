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

const displayOverrides = new Map<string, AssetDisplayOverride>([
  [BEEFY_RAW_TOKEN, {
    symbol: 'Beefy USDT0-AUSD-USDC',
    name: 'Beefy Balancer Monad wnUSDT0-wnAUSD-wnUSDC',
  }],
  [BEEFY_WRAPPED_TOKEN, {
    symbol: 'Beefy USDT0-AUSD-USDC',
    name: 'Wrapped Beefy Balancer Monad wnUSDT0-wnAUSD-wnUSDC',
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
