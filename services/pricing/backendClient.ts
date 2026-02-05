import type { Address } from 'viem'

// -------------------------------------------
// Backend Response Types
// -------------------------------------------

/**
 * Expected response shape from the price backend.
 * ADJUST THIS when the actual backend is implemented.
 */
export type BackendPriceData = {
  /** Price in USD (e.g., "1.0023" or "2847.50") */
  usd: string
  /** Unix timestamp when this price was recorded */
  timestamp: number
  /** Optional: confidence interval or spread */
  confidence?: string
}

export type BackendPriceResponse = {
  prices: Record<string, BackendPriceData>
  /** Chain ID this response is for */
  chainId: number
  /** Server timestamp */
  serverTime: number
}

/**
 * Collateral price response - price of collateral in context of a liability vault.
 * ADJUST THIS when the actual backend is implemented.
 */
export type BackendCollateralPriceData = {
  /** Collateral asset address */
  collateral: string
  /** Price in USD */
  usd: string
  /** Unix timestamp */
  timestamp: number
}

export type BackendCollateralPriceResponse = {
  prices: BackendCollateralPriceData[]
  /** Liability vault this is in context of */
  liabilityVault: string
  chainId: number
  serverTime: number
}

// -------------------------------------------
// Configuration
// -------------------------------------------

let backendEndpoint: string | undefined
let currentChainId: number | undefined

/**
 * Configure the backend client.
 * Call this when the app initializes or chain changes.
 */
export const configureBackend = (endpoint: string | undefined, chainId?: number) => {
  backendEndpoint = endpoint || undefined
  currentChainId = chainId
}

/**
 * Check if backend is configured and available.
 */
export const isBackendConfigured = (): boolean => {
  return !!backendEndpoint
}

// -------------------------------------------
// Cache
// -------------------------------------------

const CACHE_TTL_MS = 30 * 1000 // 30 seconds

type CachedPrice = {
  data: BackendPriceData
  fetchedAt: number
}

const priceCache = new Map<string, CachedPrice>()

const getCacheKey = (assetAddress: string, chainId?: number): string => {
  return `${chainId || currentChainId || 1}:${assetAddress.toLowerCase()}`
}

/**
 * Clear stale cache entries.
 */
export const clearStaleBackendCache = () => {
  const now = Date.now()
  for (const [key, cached] of priceCache.entries()) {
    if ((now - cached.fetchedAt) >= CACHE_TTL_MS) {
      priceCache.delete(key)
    }
  }
}

// -------------------------------------------
// Fetch Functions
// -------------------------------------------

/**
 * Fetch asset prices from backend.
 * Returns undefined if backend is not configured or request fails.
 *
 * @param assetAddresses - Array of asset addresses to fetch prices for
 * @param chainId - Optional chain ID (uses configured default if not provided)
 */
export const fetchBackendPrices = async (
  assetAddresses: Address[],
  chainId?: number,
): Promise<Map<string, BackendPriceData> | undefined> => {
  if (!backendEndpoint || !assetAddresses.length) {
    return undefined
  }

  const effectiveChainId = chainId || currentChainId || 1
  const now = Date.now()
  const results = new Map<string, BackendPriceData>()
  const missingAddresses: Address[] = []

  // Check cache first
  for (const address of assetAddresses) {
    const key = getCacheKey(address, effectiveChainId)
    const cached = priceCache.get(key)
    if (cached && (now - cached.fetchedAt) < CACHE_TTL_MS) {
      results.set(address.toLowerCase(), cached.data)
    }
    else {
      missingAddresses.push(address)
    }
  }

  // All found in cache
  if (missingAddresses.length === 0) {
    return results
  }

  try {
    // Build request URL
    // ADJUST THIS when actual backend API is known
    const url = new URL('/v1/prices', backendEndpoint)
    url.searchParams.set('chainId', String(effectiveChainId))
    missingAddresses.forEach(addr => url.searchParams.append('assets', addr))

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    })

    if (!response.ok) {
      console.warn(`[backendClient] Price fetch failed: ${response.status}`)
      return results.size > 0 ? results : undefined
    }

    const data: BackendPriceResponse = await response.json()

    // Map response to results and update cache
    // ADJUST FIELD MAPPING HERE when actual backend response is known
    for (const [address, priceData] of Object.entries(data.prices)) {
      const normalizedAddr = address.toLowerCase()
      results.set(normalizedAddr, priceData)

      // Update cache
      const key = getCacheKey(address, effectiveChainId)
      priceCache.set(key, {
        data: priceData,
        fetchedAt: now,
      })
    }

    return results
  }
  catch (err) {
    console.warn('[backendClient] Error fetching prices:', err)
    // Return cached results if we have any
    return results.size > 0 ? results : undefined
  }
}

/**
 * Fetch a single asset price from backend.
 */
export const fetchBackendPrice = async (
  assetAddress: Address,
  chainId?: number,
): Promise<BackendPriceData | undefined> => {
  const prices = await fetchBackendPrices([assetAddress], chainId)
  return prices?.get(assetAddress.toLowerCase())
}

/**
 * Fetch collateral prices in context of a liability vault.
 * Returns undefined if backend is not configured or request fails.
 *
 * @param liabilityVaultAddress - The liability vault address
 * @param collateralAddresses - Array of collateral asset addresses
 * @param chainId - Optional chain ID
 */
export const fetchBackendCollateralPrices = async (
  liabilityVaultAddress: Address,
  collateralAddresses: Address[],
  chainId?: number,
): Promise<Map<string, BackendPriceData> | undefined> => {
  if (!backendEndpoint || !collateralAddresses.length) {
    return undefined
  }

  const effectiveChainId = chainId || currentChainId || 1

  try {
    // Build request URL
    // ADJUST THIS when actual backend API is known
    const url = new URL('/v1/collateral-prices', backendEndpoint)
    url.searchParams.set('chainId', String(effectiveChainId))
    url.searchParams.set('liabilityVault', liabilityVaultAddress)
    collateralAddresses.forEach(addr => url.searchParams.append('collaterals', addr))

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    })

    if (!response.ok) {
      console.warn(`[backendClient] Collateral price fetch failed: ${response.status}`)
      return undefined
    }

    const data: BackendCollateralPriceResponse = await response.json()

    // Map response to results
    // ADJUST FIELD MAPPING HERE when actual backend response is known
    const results = new Map<string, BackendPriceData>()
    for (const item of data.prices) {
      results.set(item.collateral.toLowerCase(), {
        usd: item.usd,
        timestamp: item.timestamp,
      })
    }

    return results
  }
  catch (err) {
    console.warn('[backendClient] Error fetching collateral prices:', err)
    return undefined
  }
}

// -------------------------------------------
// Price Conversion Helper
// -------------------------------------------

const ONE_18 = 10n ** 18n

/**
 * Convert backend price string to bigint (18 decimals).
 * Use this to convert backend prices to the same format as on-chain prices.
 */
export const backendPriceToBigInt = (priceString: string): bigint => {
  try {
    const price = parseFloat(priceString)
    if (isNaN(price) || price < 0) {
      return 0n
    }
    // Convert to 18 decimal fixed point
    // Use string manipulation to avoid floating point precision issues
    const [intPart, decPart = ''] = priceString.split('.')
    const paddedDec = decPart.padEnd(18, '0').slice(0, 18)
    return BigInt(intPart + paddedDec)
  }
  catch {
    return 0n
  }
}
