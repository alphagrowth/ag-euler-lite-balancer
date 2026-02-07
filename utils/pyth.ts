import { PriceServiceConnection } from '@pythnetwork/price-service-client'
import { ethers } from 'ethers'
import type { Address, Hex } from 'viem'
import { PYTH_ABI } from '~/abis/pyth'
import { EVC_ABI, type BatchItem, type BatchItemResult } from '~/abis/evc'
import { DEFAULT_PRICE_CACHE_TTL_MS } from '~/entities/constants'
import { collectPythFeedIds, type PythFeed } from '~/entities/oracle'
import type { Vault } from '~/entities/vault'
import type { EVCCall } from './evc-converter'

const normalizeHex = (value: string): Hex => (value.startsWith('0x') ? value : (`0x${value}` as Hex))
const normalizeFeedId = (value: string): Hex => normalizeHex(value).toLowerCase() as Hex

type PriceFeedLike = {
  id: string
  getPriceUnchecked: () => { price: string; expo: number }
}

type CachedPrice = {
  price: bigint
  expiresAt: number
}

let priceServiceEndpoint = ''
let priceServiceClient: PriceServiceConnection | undefined
const priceCache = new Map<string, CachedPrice>()

// -------------------------------------------
// Pyth Update Data Batching
// -------------------------------------------

const PYTH_BATCH_DELAY_MS = 50 // Wait 50ms to collect requests before batching
const PYTH_UPDATE_CACHE_TTL_MS = 15 * 1000 // Cache Pyth update data for 15 seconds

type PythPendingRequest = {
  feedIds: Hex[]
  endpoint: string
  resolve: (data: Hex[]) => void
  reject: (err: unknown) => void
}

type CachedPythUpdate = {
  data: Hex[]
  fetchedAt: number
}

let pythPendingRequests: PythPendingRequest[] = []
let pythBatchTimeout: ReturnType<typeof setTimeout> | null = null
const pythUpdateCache = new Map<string, CachedPythUpdate>()

const getPythCacheKey = (feedIds: Hex[], endpoint: string): string => {
  const sortedIds = [...feedIds].sort().join(',')
  return `${endpoint}:${sortedIds}`
}

/**
 * Execute all pending Pyth update requests as batched calls.
 */
const executePythBatch = async () => {
  pythBatchTimeout = null
  const requests = pythPendingRequests
  pythPendingRequests = []

  if (requests.length === 0) return

  // Group requests by endpoint
  const byEndpoint = new Map<string, PythPendingRequest[]>()
  for (const req of requests) {
    const existing = byEndpoint.get(req.endpoint) || []
    existing.push(req)
    byEndpoint.set(req.endpoint, existing)
  }

  // Execute batched requests for each endpoint
  for (const [endpoint, endpointRequests] of byEndpoint.entries()) {
    // Collect all unique feed IDs for this endpoint
    const allFeedIds = new Set<Hex>()
    for (const req of endpointRequests) {
      req.feedIds.forEach(id => allFeedIds.add(normalizeFeedId(id)))
    }

    const feedIdArray = [...allFeedIds]
    const cacheKey = getPythCacheKey(feedIdArray, endpoint)
    const now = Date.now()

    // Check cache first
    const cached = pythUpdateCache.get(cacheKey)
    if (cached && (now - cached.fetchedAt) < PYTH_UPDATE_CACHE_TTL_MS) {
      for (const req of endpointRequests) {
        req.resolve(cached.data)
      }
      continue
    }

    try {
      const data = await fetchPythUpdateDataDirect(feedIdArray, endpoint)

      // Cache the result with current timestamp (after async operation completes)
      pythUpdateCache.set(cacheKey, {
        data,
        fetchedAt: Date.now(),
      })

      // Resolve all requests for this endpoint
      for (const req of endpointRequests) {
        req.resolve(data)
      }
    }
    catch (err) {
      for (const req of endpointRequests) {
        req.reject(err)
      }
    }
  }
}

/**
 * Direct fetch without batching - used internally by the batching system.
 */
const fetchPythUpdateDataDirect = async (feedIds: Hex[], endpoint: string): Promise<Hex[]> => {
  if (!feedIds.length || !endpoint) {
    return []
  }

  try {
    const url = new URL('/v2/updates/price/latest', endpoint)
    feedIds.forEach(id => url.searchParams.append('ids[]', id))
    url.searchParams.set('encoding', 'hex')

    const response = await fetch(url.toString())
    if (!response.ok) {
      throw new Error(`Failed to fetch Pyth data: ${response.status}`)
    }

    const body = await response.json()
    const binaryData = body?.binary?.data || []
    if (!Array.isArray(binaryData)) {
      return []
    }

    return binaryData.map((item: string) => normalizeHex(item))
  }
  catch (err) {
    console.warn('[fetchPythUpdateDataDirect] error', err)
    return []
  }
}

const getPriceServiceClient = (endpoint: string) => {
  if (!priceServiceClient || priceServiceEndpoint !== endpoint) {
    priceServiceEndpoint = endpoint
    priceServiceClient = new PriceServiceConnection(endpoint)
  }
  return priceServiceClient
}

const priceToAmountOutMid = (price: { price: string; expo: number }): bigint => {
  const raw = BigInt(price.price)
  const scale = price.expo + 18
  if (scale >= 0) {
    return raw * (10n ** BigInt(scale))
  }
  return raw / (10n ** BigInt(-scale))
}

const collectFeedsFromVault = (vault: Vault | undefined, maxDepth: number): PythFeed[] => {
  if (!vault) return []

  const feeds = collectPythFeedIds(vault.oracleDetailedInfo, maxDepth)

  const unique = new Map<string, PythFeed>()
  feeds.forEach((feed) => {
    const key = `${feed.pythAddress.toLowerCase()}:${feed.feedId.toLowerCase()}`
    if (!unique.has(key)) {
      unique.set(key, feed)
    }
  })

  return [...unique.values()]
}

export const collectPythFeedsFromVaults = (
  vaults: (Vault | undefined)[],
  maxDepth = 3,
): PythFeed[] => {
  const merged = vaults.flatMap(vault => collectFeedsFromVault(vault, maxDepth))
  const unique = new Map<string, PythFeed>()

  merged.forEach((feed) => {
    const key = `${feed.pythAddress.toLowerCase()}:${feed.feedId.toLowerCase()}`
    if (!unique.has(key)) {
      unique.set(key, feed)
    }
  })

  return [...unique.values()]
}

/**
 * Fetch Pyth update data with automatic request batching.
 * Multiple calls within 50ms are combined into a single network request.
 */
export const fetchPythUpdateData = async (feedIds: Hex[], endpoint?: string): Promise<Hex[]> => {
  if (!feedIds.length || !endpoint) {
    return []
  }

  const normalizedIds = feedIds.map(id => normalizeFeedId(id))
  const cacheKey = getPythCacheKey(normalizedIds, endpoint)
  const now = Date.now()

  // Check cache first to avoid adding to batch
  const cached = pythUpdateCache.get(cacheKey)
  if (cached && (now - cached.fetchedAt) < PYTH_UPDATE_CACHE_TTL_MS) {
    return cached.data
  }

  // Add to pending batch
  return new Promise<Hex[]>((resolve, reject) => {
    pythPendingRequests.push({
      feedIds: normalizedIds,
      endpoint,
      resolve,
      reject,
    })

    // Schedule batch execution if not already scheduled
    if (!pythBatchTimeout) {
      pythBatchTimeout = setTimeout(executePythBatch, PYTH_BATCH_DELAY_MS)
    }
  })
}

export const buildPythUpdateCalls = async (
  vaults: (Vault | undefined)[],
  providerUrl: string,
  hermesEndpoint: string | undefined,
  sender: Address,
): Promise<{ calls: EVCCall[]; totalFee: bigint }> => {
  const feeds = collectPythFeedsFromVaults(vaults)
  if (!feeds.length || !hermesEndpoint) {
    return { calls: [], totalFee: 0n }
  }

  const grouped = new Map<string, { pythAddress: Address; feedIds: Set<Hex> }>()
  feeds.forEach((feed) => {
    const key = feed.pythAddress.toLowerCase()
    if (!grouped.has(key)) {
      grouped.set(key, { pythAddress: feed.pythAddress, feedIds: new Set() })
    }
    grouped.get(key)?.feedIds.add(feed.feedId)
  })

  const provider = new ethers.JsonRpcProvider(providerUrl)
  const calls: EVCCall[] = []
  let totalFee = 0n

  for (const [, { pythAddress, feedIds: feedSet }] of grouped.entries()) {
    const updateData = await fetchPythUpdateData([...feedSet], hermesEndpoint)
    if (!updateData.length) continue

    const pythContract = new ethers.Contract(pythAddress, PYTH_ABI, provider)

    let fee = 0n
    try {
      fee = await pythContract.getUpdateFee(updateData)
    }
    catch (err) {
      console.warn('[buildPythUpdateCalls] getUpdateFee failed', err)
      continue
    }

    calls.push({
      targetContract: pythAddress,
      onBehalfOfAccount: sender,
      value: fee,
      data: pythContract.interface.encodeFunctionData('updatePriceFeeds', [updateData]) as Hex,
    })

    totalFee += fee
  }

  return { calls, totalFee }
}

export const fetchPythPrices = async (
  feedIds: Hex[],
  hermesEndpoint?: string,
  cacheTtlMs = DEFAULT_PRICE_CACHE_TTL_MS,
): Promise<Map<string, bigint>> => {
  const prices = new Map<string, bigint>()
  if (!feedIds.length || !hermesEndpoint) {
    return prices
  }

  const now = Date.now()
  const missing: Hex[] = []

  feedIds.forEach((feedId) => {
    const key = normalizeFeedId(feedId)
    const cached = priceCache.get(key)
    if (cached && cached.expiresAt > now) {
      prices.set(key, cached.price)
      return
    }
    missing.push(key)
  })

  if (!missing.length) {
    return prices
  }

  try {
    const client = getPriceServiceClient(hermesEndpoint)
    const priceFeeds = await client.getLatestPriceFeeds(missing) as PriceFeedLike[]

    priceFeeds.forEach((feed) => {
      const key = normalizeFeedId(feed.id)
      const amountOutMid = priceToAmountOutMid(feed.getPriceUnchecked())
      priceCache.set(key, {
        price: amountOutMid,
        expiresAt: now + cacheTtlMs,
      })
      prices.set(key, amountOutMid)
    })
  }
  catch (err) {
    console.warn('[fetchPythPrices] error', err)
  }

  return prices
}

export const sumCallValues = (calls: EVCCall[]): bigint => calls.reduce((acc, call) => acc + (call.value || 0n), 0n)

/**
 * Build batch items for Pyth updates.
 * Reusable for both vault fetching AND account lens fetching via batchSimulation.
 *
 * @param vaults - Array of vaults to collect Pyth feeds from
 * @param providerUrl - JSON-RPC provider URL
 * @param hermesEndpoint - Pyth Hermes endpoint URL
 * @returns BatchItem array for Pyth updates and total fee required
 */
export const buildPythBatchItems = async (
  vaults: (Vault | undefined)[],
  providerUrl: string,
  hermesEndpoint: string | undefined,
): Promise<{ items: BatchItem[]; totalFee: bigint }> => {
  const feeds = collectPythFeedsFromVaults(vaults)
  if (!feeds.length || !hermesEndpoint) {
    return { items: [], totalFee: 0n }
  }

  const grouped = new Map<Address, Set<Hex>>()
  feeds.forEach((feed) => {
    const key = feed.pythAddress
    if (!grouped.has(key)) {
      grouped.set(key, new Set())
    }
    grouped.get(key)?.add(feed.feedId)
  })

  const provider = new ethers.JsonRpcProvider(providerUrl)
  const items: BatchItem[] = []
  let totalFee = 0n

  for (const [pythAddress, feedSet] of grouped.entries()) {
    const updateData = await fetchPythUpdateData([...feedSet], hermesEndpoint)
    if (!updateData.length) continue

    const pythContract = new ethers.Contract(pythAddress, PYTH_ABI, provider)

    let fee = 0n
    try {
      fee = await pythContract.getUpdateFee(updateData)
    }
    catch (err) {
      console.warn('[buildPythBatchItems] getUpdateFee failed', err)
      continue
    }

    items.push({
      targetContract: pythAddress,
      onBehalfOfAccount: ethers.ZeroAddress,
      value: fee,
      data: pythContract.interface.encodeFunctionData('updatePriceFeeds', [updateData]),
    })
    totalFee += fee
  }

  return { items, totalFee }
}

/**
 * Build batch items from pre-collected Pyth feeds.
 * Use when you've already collected feeds from multiple sources (e.g., liability + all collaterals).
 *
 * @param feeds - Array of PythFeed objects
 * @param providerUrl - JSON-RPC provider URL
 * @param hermesEndpoint - Pyth Hermes endpoint URL
 * @returns BatchItem array for Pyth updates and total fee required
 */
export const buildPythBatchItemsFromFeeds = async (
  feeds: PythFeed[],
  providerUrl: string,
  hermesEndpoint: string | undefined,
): Promise<{ items: BatchItem[]; totalFee: bigint }> => {
  if (!feeds.length || !hermesEndpoint) {
    return { items: [], totalFee: 0n }
  }

  const grouped = new Map<Address, Set<Hex>>()
  feeds.forEach((feed) => {
    const key = feed.pythAddress
    if (!grouped.has(key)) {
      grouped.set(key, new Set())
    }
    grouped.get(key)?.add(feed.feedId)
  })

  const provider = new ethers.JsonRpcProvider(providerUrl)
  const items: BatchItem[] = []
  let totalFee = 0n

  for (const [pythAddress, feedSet] of grouped.entries()) {
    const updateData = await fetchPythUpdateData([...feedSet], hermesEndpoint)
    if (!updateData.length) continue

    const pythContract = new ethers.Contract(pythAddress, PYTH_ABI, provider)

    let fee = 0n
    try {
      fee = await pythContract.getUpdateFee(updateData)
    }
    catch (err) {
      console.warn('[buildPythBatchItemsFromFeeds] getUpdateFee failed', err)
      continue
    }

    items.push({
      targetContract: pythAddress,
      onBehalfOfAccount: ethers.ZeroAddress,
      value: fee,
      data: pythContract.interface.encodeFunctionData('updatePriceFeeds', [updateData]),
    })
    totalFee += fee
  }

  return { items, totalFee }
}

/**
 * Execute a lens call with Pyth simulation.
 * Generic helper that handles the common pattern of:
 * 1. Building Pyth update batch items
 * 2. Building the lens call batch item
 * 3. Executing batchSimulation
 * 4. Returning the decoded lens result
 *
 * @param feeds - Pyth feeds to update
 * @param lensContract - The lens contract instance
 * @param lensMethod - Method name to call on the lens
 * @param lensArgs - Arguments for the lens method
 * @param evcAddress - EVC contract address
 * @param provider - JSON-RPC provider
 * @param providerUrl - Provider URL for Pyth batch building
 * @param hermesEndpoint - Pyth Hermes endpoint
 * @returns Decoded lens result, or undefined if simulation fails
 */
export const executeLensWithPythSimulation = async <T>(
  feeds: PythFeed[],
  lensContract: ethers.Contract,
  lensMethod: string,
  lensArgs: unknown[],
  evcAddress: string,
  provider: ethers.JsonRpcProvider,
  providerUrl: string,
  hermesEndpoint: string,
): Promise<T | undefined> => {
  try {
    // Build Pyth update batch items
    const { items: pythItems, totalFee } = await buildPythBatchItemsFromFeeds(
      feeds,
      providerUrl,
      hermesEndpoint,
    )

    // Build lens batch item
    const lensCallData = lensContract.interface.encodeFunctionData(lensMethod, lensArgs)
    const lensBatchItem: BatchItem = {
      targetContract: await lensContract.getAddress(),
      onBehalfOfAccount: ethers.ZeroAddress,
      value: 0n,
      data: lensCallData,
    }

    // Combine: Pyth updates first, then lens call
    const batchItems = [...pythItems, lensBatchItem]

    // Execute batch simulation
    const evcContract = new ethers.Contract(evcAddress, EVC_ABI, provider)
    const [batchResults] = await evcContract.batchSimulation.staticCall(
      batchItems,
      { value: totalFee },
    ) as [BatchItemResult[], unknown, unknown]

    // Validate and get the last result (lens call)
    if (!batchResults || batchResults.length === 0) {
      return undefined
    }

    const lensResult = batchResults[batchResults.length - 1]
    if (!lensResult || !lensResult.success) {
      return undefined
    }

    // Decode the lens result
    const decodedResult = lensContract.interface.decodeFunctionResult(lensMethod, lensResult.result)
    return decodedResult as T
  }
  catch (err) {
    console.warn('[executeLensWithPythSimulation] Error:', err)
    return undefined
  }
}

export const pythAbi = PYTH_ABI
