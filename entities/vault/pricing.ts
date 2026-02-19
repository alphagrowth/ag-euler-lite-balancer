import type { Address } from 'viem'
import { USD_ADDRESS } from '~/entities/constants'
import { eulerUtilsLensABI } from '~/entities/euler/abis'
import { getPublicClient } from '~/utils/public-client'

const unitOfAccountPriceCache = new Map<string, { amountOutMid: bigint } | null>()

const ONE_18 = 10n ** 18n

export const resolveAssetPriceInfo = async (
  rpcUrl: string,
  utilsLensAddress: string,
  assetAddress: string,
): Promise<{ amountOutMid: bigint } | undefined> => {
  try {
    const client = getPublicClient(rpcUrl)
    const priceInfo = await client.readContract({
      address: utilsLensAddress as Address,
      abi: eulerUtilsLensABI,
      functionName: 'getAssetPriceInfo',
      args: [assetAddress as Address, USD_ADDRESS],
    }) as Record<string, unknown>

    // Note: 0n is a valid price (very small value), only reject null/undefined or explicit failure
    if (priceInfo.queryFailure || priceInfo.amountOutMid === undefined || priceInfo.amountOutMid === null) {
      return undefined
    }

    return { amountOutMid: priceInfo.amountOutMid as bigint }
  }
  catch (e) {
    console.warn(`Error fetching price for asset ${assetAddress}:`, e)
    return undefined
  }
}

export const resolveUnitOfAccountPriceInfo = async (
  rpcUrl: string,
  utilsLensAddress: string,
  unitOfAccount?: string,
): Promise<{ amountOutMid: bigint } | undefined> => {
  if (!unitOfAccount) {
    return undefined
  }
  const normalized = unitOfAccount.toLowerCase()

  if (normalized === USD_ADDRESS.toLowerCase()) {
    return { amountOutMid: ONE_18 }
  }

  // Check cache
  const cached = unitOfAccountPriceCache.get(normalized)
  if (cached) {
    return cached
  }
  if (cached === null) {
    return undefined
  }

  const priceInfo = await resolveAssetPriceInfo(rpcUrl, utilsLensAddress, unitOfAccount)
  unitOfAccountPriceCache.set(normalized, priceInfo || null)
  return priceInfo
}
