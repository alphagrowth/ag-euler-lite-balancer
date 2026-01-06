import { PriceServiceConnection } from '@pythnetwork/price-service-client'
import { ethers } from 'ethers'
import type { Address, Hex } from 'viem'
import { collectPythFeedIds, type PythFeed } from '~/entities/oracle'
import type { Vault } from '~/entities/vault'
import type { EVCCall } from './evc-converter'

const PYTH_ABI = [
  {
    type: 'function',
    name: 'getUpdateFee',
    inputs: [{ name: 'updateData', type: 'bytes[]' }],
    outputs: [{ name: 'feeAmount', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'updatePriceFeeds',
    inputs: [{ name: 'updateData', type: 'bytes[]' }],
    outputs: [],
    stateMutability: 'payable',
  },
] as const

const normalizeHex = (value: string): Hex => (value.startsWith('0x') ? value : (`0x${value}` as Hex))
const normalizeFeedId = (value: string): Hex => normalizeHex(value).toLowerCase() as Hex

const DEFAULT_PRICE_CACHE_TTL_MS = 15_000

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

  const feeds = [
    ...collectPythFeedIds(vault.oracleDetailedInfo, maxDepth),
    ...collectPythFeedIds(vault.backupAssetOracleInfo, maxDepth),
  ]

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

export const fetchPythUpdateData = async (feedIds: Hex[], endpoint?: string): Promise<Hex[]> => {
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
    console.warn('[fetchPythUpdateData] error', err)
    return []
  }
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

  const grouped = new Map<Address, Set<Hex>>()
  feeds.forEach((feed) => {
    const key = feed.pythAddress
    if (!grouped.has(key)) {
      grouped.set(key, new Set())
    }
    grouped.get(key)?.add(feed.feedId)
  })

  const provider = new ethers.JsonRpcProvider(providerUrl)
  const calls: EVCCall[] = []
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

export const pythAbi = PYTH_ABI
