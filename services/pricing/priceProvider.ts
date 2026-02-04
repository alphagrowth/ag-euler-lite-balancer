import { ethers } from 'ethers'
import { USD_ADDRESS } from '~/entities/constants'
import type {
  Vault,
  EarnVault,
  PriceResult,
  VaultCollateralPrice,
} from '~/entities/vault'
import { nanoToValue } from '~/utils/crypto-utils'

const ONE_18 = 10n ** 18n
const UOA_CACHE_TTL_MS = 2 * 60 * 1000 // 2 minutes

export type PriceSource = 'on-chain' | 'off-chain'

type CachedUoAPrice = {
  amountOutMid: bigint
  fetchedAt: number
}

const uoaPriceCache = new Map<string, CachedUoAPrice>()

/**
 * Clear stale entries from UoA cache.
 * Call periodically to prevent memory leaks.
 */
export const clearStaleUoACache = () => {
  const now = Date.now()
  for (const [key, cached] of uoaPriceCache.entries()) {
    if ((now - cached.fetchedAt) >= UOA_CACHE_TTL_MS) {
      uoaPriceCache.delete(key)
    }
  }
}

// -------------------------------------------
// Layer 1: Raw Oracle Prices (Unit of Account)
// -------------------------------------------

/**
 * Get raw oracle price for a vault's asset in the vault's unit of account.
 * Uses liabilityPriceInfo from the vault lens.
 *
 * @param vault - The vault to get the asset price for
 * @returns PriceResult in unit of account, or undefined if no valid price
 */
export const getAssetOraclePrice = (vault: Vault | null | undefined): PriceResult | undefined => {
  if (!vault) return undefined

  if (!vault.liabilityPriceInfo || vault.liabilityPriceInfo.queryFailure) {
    return undefined
  }

  const { amountOutAsk, amountOutBid, amountOutMid } = vault.liabilityPriceInfo
  if (!amountOutMid) {
    return undefined
  }

  const ask = amountOutAsk && amountOutAsk > 0n ? amountOutAsk : amountOutMid
  const bid = amountOutBid && amountOutBid > 0n ? amountOutBid : amountOutMid

  return { amountOutAsk: ask, amountOutBid: bid, amountOutMid }
}

/**
 * Get collateral share price from the liability vault's perspective.
 * Returns price in the liability vault's unit of account.
 *
 * @param liabilityVault - The borrow vault that defines the collateral relationship
 * @param collateralVault - The collateral vault
 * @returns VaultCollateralPrice in unit of account, or undefined
 */
export const getCollateralShareOraclePrice = (
  liabilityVault: Vault | null | undefined,
  collateralVault: Vault | null | undefined,
): VaultCollateralPrice | undefined => {
  if (!liabilityVault || !collateralVault) return undefined
  const collateralAddress = collateralVault.address.toLowerCase()

  const priceInfo = liabilityVault.collateralPrices.find(
    p => p.asset.toLowerCase() === collateralAddress,
  )

  if (!priceInfo) {
    return undefined
  }

  // Return price if available, even if queryFailure is true
  // (queryFailure may indicate stale price but we can still use it)
  if (priceInfo.queryFailure && !priceInfo.amountOutMid) {
    return undefined
  }

  return priceInfo
}

/**
 * Get collateral ASSET price from the liability vault's perspective.
 * Converts share price to asset price using totalShares/totalAssets.
 * Returns price in the liability vault's unit of account.
 *
 * @param liabilityVault - The borrow vault that defines the collateral relationship
 * @param collateralVault - The collateral vault
 * @returns PriceResult in unit of account, or undefined
 */
export const getCollateralOraclePrice = (
  liabilityVault: Vault | null | undefined,
  collateralVault: Vault | null | undefined,
): PriceResult | undefined => {
  if (!liabilityVault || !collateralVault) return undefined
  const sharePrice = getCollateralShareOraclePrice(liabilityVault, collateralVault)

  if (!sharePrice) {
    return undefined
  }

  const { totalAssets, totalShares } = collateralVault

  if (totalAssets === 0n) {
    return undefined
  }

  // assetPrice = sharePrice × (totalShares / totalAssets)
  const amountOutMid = (sharePrice.amountOutMid * totalShares) / totalAssets
  const amountOutAsk = (sharePrice.amountOutAsk * totalShares) / totalAssets
  const amountOutBid = (sharePrice.amountOutBid * totalShares) / totalAssets

  if (!amountOutMid) {
    return undefined
  }

  const ask = amountOutAsk && amountOutAsk > 0n ? amountOutAsk : amountOutMid
  const bid = amountOutBid && amountOutBid > 0n ? amountOutBid : amountOutMid

  return { amountOutAsk: ask, amountOutBid: bid, amountOutMid }
}

/**
 * Get the USD rate for a vault's unit of account.
 * Returns 1.0 (as 1e18) if unit of account is USD.
 *
 * @param vault - The vault to get the UoA rate for
 * @returns UoA → USD rate as bigint (18 decimals), or undefined
 */
export const getUnitOfAccountUsdRate = (vault: Vault | null | undefined): bigint | undefined => {
  if (!vault || !vault.unitOfAccount) {
    return undefined
  }

  // Special case: USD unit of account returns 1.0
  if (vault.unitOfAccount.toLowerCase() === USD_ADDRESS.toLowerCase()) {
    return ONE_18
  }

  // Use cached unitOfAccountPriceInfo (fetched during vault loading)
  if (!vault.unitOfAccountPriceInfo?.amountOutMid) {
    return undefined
  }

  return vault.unitOfAccountPriceInfo.amountOutMid
}

// -------------------------------------------
// Layer 2: USD Price Info
// -------------------------------------------

/**
 * Determine if vault is an EarnVault (type === 'earn').
 */
const isEarnVault = (vault: Vault | EarnVault | null | undefined): vault is EarnVault => {
  return vault != null && 'type' in vault && vault.type === 'earn'
}

/**
 * Determine if vault is a Securitize vault (type === 'securitize').
 */
const isSecuritizeVault = (vault: Vault | EarnVault | null | undefined): boolean => {
  return vault != null && 'type' in vault && vault.type === 'securitize'
}

/**
 * Determine if vault is an Escrow vault (vaultCategory === 'escrow').
 */
const isEscrowVault = (vault: Vault | EarnVault | null | undefined): boolean => {
  return vault != null && 'vaultCategory' in vault && vault.vaultCategory === 'escrow'
}

/**
 * Determine if vault uses UtilsLens for pricing (escrow, securitize, or earn vaults).
 * These vaults use assetPriceInfo which is already in USD.
 */
const usesUtilsLensPricing = (vault: Vault | EarnVault | null | undefined): boolean => {
  if (!vault) return false
  return isEarnVault(vault) || isEscrowVault(vault) || isSecuritizeVault(vault)
}

/**
 * Get asset price in USD.
 *
 * Internal routing based on vault type:
 * - EarnVault/Escrow/Securitize: Uses UtilsLens assetPriceInfo (already USD)
 * - Regular EVK vaults: Uses oracle router (liabilityPriceInfo + UoA conversion)
 *
 * @param vault - The vault to get the USD price for
 * @returns PriceResult in USD, or undefined
 */
export const getAssetUsdPrice = (vault: Vault | EarnVault | null | undefined): PriceResult | undefined => {
  if (!vault) return undefined

  // Earn/Escrow/Securitize vaults - use UtilsLens (assetPriceInfo is already in USD)
  if (usesUtilsLensPricing(vault)) {
    if (vault.assetPriceInfo?.amountOutMid) {
      const mid = vault.assetPriceInfo.amountOutMid
      return { amountOutMid: mid, amountOutAsk: mid, amountOutBid: mid }
    }
    return undefined
  }

  // Regular EVK vaults - use oracle router (liabilityPriceInfo + UoA conversion)
  const oraclePrice = getAssetOraclePrice(vault as Vault)
  if (!oraclePrice) return undefined

  const uoaRate = getUnitOfAccountUsdRate(vault as Vault)
  if (!uoaRate) return undefined

  return {
    amountOutMid: (oraclePrice.amountOutMid * uoaRate) / ONE_18,
    amountOutAsk: (oraclePrice.amountOutAsk * uoaRate) / ONE_18,
    amountOutBid: (oraclePrice.amountOutBid * uoaRate) / ONE_18,
  }
}

/**
 * Get collateral price in USD in the context of a liability vault.
 *
 * Note: Collateral pricing ALWAYS uses the liability vault's oracle,
 * regardless of collateral vault type (even for escrow collaterals).
 *
 * @param liabilityVault - The borrow vault that defines the collateral relationship
 * @param collateralVault - The collateral vault
 * @returns PriceResult in USD, or undefined
 */
export const getCollateralUsdPrice = (
  liabilityVault: Vault | null | undefined,
  collateralVault: Vault | null | undefined,
): PriceResult | undefined => {
  if (!liabilityVault || !collateralVault) return undefined

  // Use liability vault's oracle for collateral pricing
  const oraclePrice = getCollateralOraclePrice(liabilityVault, collateralVault)
  if (!oraclePrice) return undefined

  // Convert using liability vault's UoA (the collateral price is in liability's UoA)
  const uoaRate = getUnitOfAccountUsdRate(liabilityVault)
  if (!uoaRate) return undefined

  return {
    amountOutMid: (oraclePrice.amountOutMid * uoaRate) / ONE_18,
    amountOutAsk: (oraclePrice.amountOutAsk * uoaRate) / ONE_18,
    amountOutBid: (oraclePrice.amountOutBid * uoaRate) / ONE_18,
  }
}

// -------------------------------------------
// Layer 3: USD Value Calculation
// -------------------------------------------

/**
 * Calculate USD value of an asset amount.
 *
 * @param amount - Amount as bigint (native decimals) or number (token amount)
 * @param vault - The vault
 * @returns USD value as number, or 0 if no price available
 */
export const getAssetUsdValue = (amount: number | bigint, vault: Vault | EarnVault | null | undefined): number => {
  if (!vault) return 0

  const price = getAssetUsdPrice(vault)
  if (!price) return 0

  const tokenAmount = typeof amount === 'bigint' ? nanoToValue(amount, vault.decimals) : amount
  const usdPrice = nanoToValue(price.amountOutMid, 18)
  return tokenAmount * usdPrice
}

/**
 * Calculate USD value of collateral amount in liability context.
 *
 * @param assetAmount - Amount in assets (NOT shares), in native token decimals
 * @param liabilityVault - The borrow vault that defines the collateral relationship
 * @param collateralVault - The collateral vault
 * @returns USD value as number, or 0 if no price available
 */
export const getCollateralUsdValue = (
  assetAmount: bigint,
  liabilityVault: Vault | null | undefined,
  collateralVault: Vault | null | undefined,
): number => {
  if (!liabilityVault || !collateralVault) return 0

  const price = getCollateralUsdPrice(liabilityVault, collateralVault)
  if (!price) return 0

  const tokenAmount = nanoToValue(assetAmount, collateralVault.decimals)
  const usdPrice = nanoToValue(price.amountOutMid, 18)
  return tokenAmount * usdPrice
}

/**
 * Format asset value for UI display.
 *
 * @param amount - Amount in native token decimals (bigint) or as number
 * @param vault - The vault
 * @returns Object with display string, hasPrice flag, USD value, and asset info
 */
export const formatAssetValue = (
  amount: number | bigint,
  vault: Vault | EarnVault | null | undefined,
  options: { maxDecimals?: number; minDecimals?: number } = {},
): { display: string; hasPrice: boolean; usdValue: number; assetAmount: number; assetSymbol: string } => {
  const { maxDecimals = 2, minDecimals = 2 } = options

  if (!vault) {
    return {
      display: '-',
      hasPrice: false,
      usdValue: 0,
      assetAmount: 0,
      assetSymbol: '',
    }
  }

  const actualAmount = typeof amount === 'bigint' ? nanoToValue(amount, vault.decimals) : amount
  const symbol = vault.asset.symbol

  const price = getAssetUsdPrice(vault)

  if (!price) {
    const formattedAmount = actualAmount.toLocaleString('en-US', {
      maximumFractionDigits: maxDecimals,
      minimumFractionDigits: minDecimals,
    })
    return {
      display: `${formattedAmount} ${symbol}`,
      hasPrice: false,
      usdValue: 0,
      assetAmount: actualAmount,
      assetSymbol: symbol,
    }
  }

  const usdValue = actualAmount * nanoToValue(price.amountOutMid, 18)
  return {
    display: '', // Empty - components will format USD themselves
    hasPrice: true,
    usdValue,
    assetAmount: actualAmount,
    assetSymbol: symbol,
  }
}

// -------------------------------------------
// Liquidation Price Calculation Helpers
// -------------------------------------------

/**
 * Calculate liquidation price ratio in unit of account.
 * This is the ratio at which the collateral/liability price causes liquidation.
 *
 * For displaying liquidation price in USD, multiply the result by UoA rate.
 *
 * @param collateralOraclePrice - Collateral price in UoA
 * @param liabilityOraclePrice - Liability price in UoA
 * @returns Ratio in UoA (UoA cancels in ratio)
 */
export const calculateLiquidationRatio = (
  collateralOraclePrice: PriceResult | null | undefined,
  liabilityOraclePrice: PriceResult | null | undefined,
): bigint => {
  if (!collateralOraclePrice || !liabilityOraclePrice) return 0n
  if (liabilityOraclePrice.amountOutBid === 0n) return 0n
  return (collateralOraclePrice.amountOutAsk * ONE_18) / liabilityOraclePrice.amountOutBid
}
