import { ethers } from 'ethers'
import axios from 'axios'
import type { Hex } from 'viem'
import { labelsRepo } from './custom'
import { SECONDS_IN_YEAR, TARGET_TIME_AGO, USD_ADDRESS } from '~/entities/constants'
import {
  vaultConvertToAssetsAbi,
  vaultConvertToSharesAbi,
  vaultMaxWithdrawAbi,
  vaultPreviewWithdrawAbi,
} from '~/abis/vault'
import { collectPythFeedIdsForPair, type OracleDetailedInfo } from '~/entities/oracle'
import {
  // eulerAccountLensABI,
  eulerEarnVaultLensABI,
  eulerPerspectiveABI,
  eulerUtilsLensABI,
  eulerVaultLensABI,
} from '~/entities/euler/abis'
import { fetchPythPrices } from '~/utils/pyth'
import { useVaultRegistry } from '~/composables/useVaultRegistry'
import { nanoToValue } from '~/utils/crypto-utils'
// import type { AccountBorrowPosition } from '~/entities/account'

// Securitize factory address - vaults created by this factory are treated as securitize vaults
export const SECURITIZE_FACTORY_ADDRESS = '0x5f51d980f15fe6075ae30394dc35de57a4f76cbb'

// Cache for vault factory lookups
const vaultFactoryCache = new Map<string, string>()

// Fetch vault factory from subgraph
export const fetchVaultFactory = async (
  vaultAddress: string,
  subgraphUrl?: string,
): Promise<string | null> => {
  const normalizedAddress = vaultAddress.toLowerCase()

  // Check cache first
  if (vaultFactoryCache.has(normalizedAddress)) {
    return vaultFactoryCache.get(normalizedAddress)!
  }

  try {
    const url = subgraphUrl || useEulerConfig().SUBGRAPH_URL
    if (!url) {
      console.warn('[fetchVaultFactory] No subgraph URL available')
      return null
    }

    const { data } = await axios.post(url, {
      query: `query VaultFactory {
        vaults(where: { id: "${normalizedAddress}" }) {
          id
          factory
          }
          }`,
    })

    const vault = data?.data?.vaults?.[0]
    if (vault?.factory) {
      vaultFactoryCache.set(normalizedAddress, vault.factory.toLowerCase())
      return vault.factory.toLowerCase()
    }

    return null
  }
  catch (e) {
    console.warn('[fetchVaultFactory] Failed to fetch vault factory:', e)
    return null
  }
}

// Check if vault is a securitize vault - first checks registry, then falls back to subgraph
export const isSecuritizeVault = async (address: string): Promise<boolean> => {
  try {
    // First check the vault registry (if populated)
    const { getType } = useVaultRegistry()
    const registryType = getType(address)
    if (registryType) {
      return registryType === 'securitize'
    }

    // Fall back to subgraph query
    const factory = await fetchVaultFactory(address)
    if (!factory) {
      return false
    }
    return factory.toLowerCase() === SECURITIZE_FACTORY_ADDRESS.toLowerCase()
  }
  catch {
    return false
  }
}

// Synchronous check using cached factory data
export const isSecuritizeVaultSync = (address: string): boolean => {
  const normalizedAddress = address.toLowerCase()
  const factory = vaultFactoryCache.get(normalizedAddress)
  if (!factory) {
    return false
  }
  return factory.toLowerCase() === SECURITIZE_FACTORY_ADDRESS.toLowerCase()
}

// Batch fetch vault factories from subgraph
export const fetchVaultFactories = async (
  vaultAddresses: string[],
): Promise<Map<string, string>> => {
  const result = new Map<string, string>()

  if (!vaultAddresses.length) {
    return result
  }

  // Filter out already cached addresses
  const uncachedAddresses = vaultAddresses.filter(
    addr => !vaultFactoryCache.has(addr.toLowerCase()),
  )

  // Add cached results to output
  vaultAddresses.forEach((addr) => {
    const cached = vaultFactoryCache.get(addr.toLowerCase())
    if (cached) {
      result.set(addr.toLowerCase(), cached)
    }
  })

  if (!uncachedAddresses.length) {
    return result
  }

  try {
    const { SUBGRAPH_URL } = useEulerConfig()
    if (!SUBGRAPH_URL) {
      return result
    }

    const normalizedAddresses = uncachedAddresses.map(addr => addr.toLowerCase())

    // Use id_in for batch query with exact matches
    // Add first: 1000 to override The Graph's default limit of 100
    const addressList = normalizedAddresses.map(addr => `"${addr}"`).join(', ')
    const { data } = await axios.post(SUBGRAPH_URL, {
      query: `query VaultFactories {
        vaults(first: 1000, where: { id_in: [${addressList}] }) {
          id
          factory
        }
      }`,
    })

    const vaults = data?.data?.vaults || []
    vaults.forEach((vault: { id: string, factory: string }) => {
      if (vault.factory) {
        const factoryLower = vault.factory.toLowerCase()
        vaultFactoryCache.set(vault.id, factoryLower)
        result.set(vault.id, factoryLower)
      }
    })

    return result
  }
  catch (e) {
    console.warn('[fetchVaultFactories] Failed to fetch vault factories:', e)
    return result
  }
}

// Get all securitize vault addresses from a list of addresses
export const filterSecuritizeVaults = async (vaultAddresses: string[]): Promise<string[]> => {
  const factories = await fetchVaultFactories(vaultAddresses)
  const securitizeAddresses: string[] = []

  factories.forEach((factory, address) => {
    if (factory.toLowerCase() === SECURITIZE_FACTORY_ADDRESS.toLowerCase()) {
      securitizeAddresses.push(address)
    }
  })

  return securitizeAddresses
}

export interface VaultLiabilityPriceInfo {
  queryFailure?: boolean
  queryFailureReason?: string
  timestamp?: bigint
  oracle?: string
  asset?: string
  unitOfAccount?: string
  amountIn: bigint
  amountOutAsk: bigint
  amountOutBid: bigint
  amountOutMid: bigint
}
export interface VaultCollateralLTV {
  collateral: string
  borrowLTV: bigint
  rampDuration: bigint
  liquidationLTV: bigint
  targetTimestamp: bigint
  initialLiquidationLTV: bigint
}
export interface VaultCollateralPrice {
  amountIn: bigint
  amountOutAsk: bigint
  amountOutBid: bigint
  amountOutMid: bigint
  asset: string
  oracle: string
  queryFailure: false
  queryFailureReason: string
  timestamp: bigint
  unitOfAccount: string
}
export interface VaultAsset {
  name: string
  symbol: string
  address: string
  decimals: bigint
}
export interface VaultInterestRateInfo {
  borrowAPY: bigint
  borrowSPY: bigint
  borrows: bigint
  cash: bigint
  supplyAPY: bigint
}
export interface VaultIRMInfo {
  interestRateModelInfo?: {
    interestRateModelType?: number
  }
}
export interface Erc4626Vault {
  address: string
  name: string
  symbol: string
  decimals: bigint
  asset: VaultAsset
  totalShares: bigint
  totalAssets: bigint
  isEVault: boolean
}
export interface SecuritizeVault extends Erc4626Vault {
  type: 'securitize'
  governorAdmin: string
}
export interface Vault {
  verified: boolean
  name: string
  symbol: string
  supply: bigint
  borrow: bigint
  address: string
  decimals: bigint
  maxLiquidationDiscount: bigint
  supplyCap: bigint
  borrowCap: bigint
  interestFee: bigint
  configFlags: bigint
  oracle: string
  totalAssets: bigint
  totalShares: bigint
  totalCash: bigint
  asset: VaultAsset
  collateralLTVs: VaultCollateralLTV[]
  interestRateInfo: VaultInterestRateInfo
  collateralPrices: VaultCollateralPrice[]
  collateralPythPrices?: Map<string, { amountOutMid: bigint }> // keyed by collateral address
  liabilityPriceInfo: VaultLiabilityPriceInfo
  pythPriceInfo?: {
    amountOutMid: bigint
  }
  oracleDetailedInfo?: OracleDetailedInfo
  backupAssetOracleInfo?: OracleDetailedInfo
  dToken: string
  governorAdmin: string
  governorFeeReceiver: string
  unitOfAccount: string
  unitOfAccountName?: string
  unitOfAccountSymbol?: string
  unitOfAccountDecimals?: bigint
  interestRateModelAddress: string
  hookTarget: string
  irmInfo?: VaultIRMInfo
}
export interface BorrowVaultPair {
  borrow: Vault
  collateral: Vault
  borrowLTV: bigint
  liquidationLTV: bigint
  initialLiquidationLTV: bigint
}

export interface SecuritizeBorrowVaultPair {
  borrow: Vault
  collateral: SecuritizeVault
  borrowLTV: bigint
  liquidationLTV: bigint
  initialLiquidationLTV: bigint
}

// Union type for combined borrow list (regular + securitize)
export type AnyBorrowVaultPair = BorrowVaultPair | SecuritizeBorrowVaultPair

// Type guard to check if a pair is a securitize pair
export const isSecuritizeBorrowPair = (pair: AnyBorrowVaultPair): pair is SecuritizeBorrowVaultPair => {
  return 'type' in pair.collateral && pair.collateral.type === 'securitize'
}

export interface VaultIteratorResult<T> {
  vaults: T[]
  isFinished: boolean
}

export interface EarnVaultStrategyInfo {
  strategy: string
  allocatedAssets: bigint
  availableAssets: bigint
  currentAllocationCap: bigint
  pendingAllocationCap: bigint
  pendingAllocationCapValidAt: bigint
  removableAt: bigint
  info: {
    timestamp: bigint
    vault: string
    vaultName: string
    vaultSymbol: string
    vaultDecimals: bigint
    asset: string
    assetName: string
    assetSymbol: string
    assetDecimals: bigint
    totalShares: bigint
    totalAssets: bigint
    isEVault: boolean
  }
}

export interface EarnVault {
  verified: boolean
  type: 'earn'
  address: string
  name: string
  symbol: string
  decimals: bigint
  totalShares: bigint
  totalAssets: bigint
  lostAssets: bigint
  availableAssets: bigint
  timelock: bigint
  performanceFee: bigint
  feeReceiver: string
  owner: string
  creator: string
  curator: string
  guardian: string
  evc: string
  permit2: string
  pendingTimelock: bigint
  pendingTimelockValidAt: bigint
  pendingGuardian: string
  pendingGuardianValidAt: bigint
  supplyQueue: string[]
  asset: VaultAsset
  strategies: EarnVaultStrategyInfo[]
  supplyAPY?: number
  assetPriceInfo?: {
    amountOutMid: bigint
  }
}

export interface EscrowVault extends Vault {
  type: 'escrow'
}

export interface CollateralOption {
  type: string
  amount: number
  price: number
  apy?: number
  label?: string
  symbol?: string
  vaultAddress?: string
}

const collectVaultPythFeedIds = (
  oracleInfo: OracleDetailedInfo | undefined,
  backupOracleInfo: OracleDetailedInfo | undefined,
  base: string,
  quote: string,
) => {
  const feeds = [
    ...collectPythFeedIdsForPair(oracleInfo, base, quote, 3),
    ...collectPythFeedIdsForPair(backupOracleInfo, base, quote, 3),
  ].filter(feed => feed.pythAddress !== ethers.ZeroAddress)

  const unique = new Map<string, Hex>()
  feeds.forEach((feed) => {
    const key = feed.feedId.toLowerCase()
    if (!unique.has(key)) {
      unique.set(key, feed.feedId)
    }
  })

  return [...unique.values()]
}

const applyPythPriceInfo = async (vaults: Vault[], hermesEndpoint?: string) => {
  if (!vaults.length || !hermesEndpoint) return

  const feedToVaults = new Map<string, Vault[]>()
  const feedIds: Hex[] = []

  vaults.forEach((vault) => {
    const feeds = collectVaultPythFeedIds(
      vault.oracleDetailedInfo,
      vault.backupAssetOracleInfo,
      vault.asset.address,
      vault.unitOfAccount,
    )
    if (feeds.length !== 1) return
    const feedId = feeds[0]
    const key = feedId.toLowerCase()
    if (!feedToVaults.has(key)) {
      feedToVaults.set(key, [])
      feedIds.push(feedId)
    }
    feedToVaults.get(key)?.push(vault)
  })

  if (!feedIds.length) return

  const prices = await fetchPythPrices(feedIds, hermesEndpoint)

  feedToVaults.forEach((vaultList, key) => {
    const price = prices.get(key)
    if (price === undefined) return
    vaultList.forEach((vault) => {
      vault.pythPriceInfo = { amountOutMid: price }
    })
  })
}

const applyCollateralPythPriceInfo = async (vault: Vault, hermesEndpoint?: string) => {
  if (!vault.collateralPrices.length || !hermesEndpoint) return

  const feedToCollateral = new Map<string, string>() // feedId → collateralAddress
  const allFeedIds: Hex[] = []

  for (const collateralPrice of vault.collateralPrices) {
    const collateralAddress = collateralPrice.asset

    const feeds = collectPythFeedIdsForPair(
      vault.oracleDetailedInfo,
      collateralAddress, // base: collateral asset
      vault.unitOfAccount, // quote: vault's unit of account
      3,
    )

    if (feeds.length === 1) {
      const feedId = feeds[0].feedId
      const key = feedId.toLowerCase()
      if (!feedToCollateral.has(key)) {
        feedToCollateral.set(key, collateralAddress.toLowerCase())
        allFeedIds.push(feedId)
      }
    }
  }

  if (!allFeedIds.length) return

  const prices = await fetchPythPrices(allFeedIds, hermesEndpoint)

  const collateralPythPrices = new Map<string, { amountOutMid: bigint }>()

  feedToCollateral.forEach((collateralAddress, feedIdKey) => {
    const pythPrice = prices.get(feedIdKey)
    if (pythPrice && pythPrice > 0n) {
      collateralPythPrices.set(collateralAddress, { amountOutMid: pythPrice })
    }
  })

  vault.collateralPythPrices = collateralPythPrices
}

export const fetchVault = async (vaultAddress: string): Promise<Vault> => {
  const { EVM_PROVIDER_URL, PYTH_HERMES_URL } = useEulerConfig()
  const { loadEulerConfig, isReady } = useEulerAddresses()
  const { verifiedVaultAddresses } = useEulerLabels()

  if (!isReady.value) {
    loadEulerConfig()
    await until(computed(() => isReady.value)).toBeTruthy()
  }
  const { eulerLensAddresses } = useEulerAddresses()

  const provider = new ethers.JsonRpcProvider(EVM_PROVIDER_URL)
  const vaultLensContract = new ethers.Contract(
    eulerLensAddresses.value!.vaultLens,
    eulerVaultLensABI,
    provider,
  )
  const raw = await vaultLensContract.getVaultInfoFull(vaultAddress)
  const data = raw.toObject({ deep: true })

  const vault = {
    verified: verifiedVaultAddresses.value.includes(vaultAddress),
    address: data.vault,
    name: data.vaultName,
    supply: data.totalAssets,
    borrow: data.totalBorrowed,
    symbol: data.vaultSymbol,
    decimals: data.vaultDecimals,
    supplyCap: data.supplyCap,
    borrowCap: data.borrowCap,
    totalCash: data.totalCash,
    totalAssets: data.totalAssets,
    totalShares: data.totalShares,
    interestFee: data.interestFee,
    configFlags: data.configFlags,
    oracle: data.oracle,
    collateralLTVs: raw.collateralLTVInfo
      .toArray()
      .map((o: { toObject: () => void }) => o.toObject()),
    collateralPrices: raw.collateralPriceInfo
      .toArray()
      .map((o: { toObject: () => void }) => o.toObject()),
    liabilityPriceInfo: data.liabilityPriceInfo,
    maxLiquidationDiscount: data.maxLiquidationDiscount,
    // interestRateInfo: data.irmInfo.interestRateInfo._, // might be a toObject deep conversion bug
    interestRateInfo: !raw.irmInfo?.interestRateInfo?._
      ? {
          borrowAPY: 0n,
          borrowSPY: 0n,
          borrows: 0n,
          cash: 0n,
          supplyAPY: 0n,
        }
      : data.irmInfo.interestRateInfo._,
    asset: {
      address: data.asset,
      name: data.assetName,
      symbol: data.assetSymbol,
      decimals: data.assetDecimals,
    },
    oracleDetailedInfo: data.oracleInfo,
    backupAssetOracleInfo: data.backupAssetOracleInfo,
    dToken: data.dToken,
    governorAdmin: data.governorAdmin,
    governorFeeReceiver: data.governorFeeReceiver,
    unitOfAccount: data.unitOfAccount,
    unitOfAccountName: data.unitOfAccountName,
    unitOfAccountSymbol: data.unitOfAccountSymbol,
    unitOfAccountDecimals: data.unitOfAccountDecimals,
    interestRateModelAddress: data.interestRateModel,
    hookTarget: data.hookTarget,
    irmInfo: data.irmInfo
      ? {
          interestRateModelInfo: data.irmInfo.interestRateModelInfo,
        }
      : undefined,
  } as Vault

  await applyPythPriceInfo([vault], PYTH_HERMES_URL)
  await applyCollateralPythPriceInfo(vault, PYTH_HERMES_URL)

  return vault
}

export const fetchSecuritizeVault = async (vaultAddress: string): Promise<SecuritizeVault> => {
  const { EVM_PROVIDER_URL } = useEulerConfig()
  const { loadEulerConfig, isReady } = useEulerAddresses()

  if (!isReady.value) {
    loadEulerConfig()
    await until(computed(() => isReady.value)).toBeTruthy()
  }
  const { eulerLensAddresses } = useEulerAddresses()

  const provider = new ethers.JsonRpcProvider(EVM_PROVIDER_URL)
  const utilsLensContract = new ethers.Contract(
    eulerLensAddresses.value!.utilsLens,
    eulerUtilsLensABI,
    provider,
  )

  const raw = await utilsLensContract.getVaultInfoERC4626(vaultAddress)
  const data = raw.toObject({ deep: true })

  // Fetch governor admin from the vault contract
  const vaultContract = new ethers.Contract(
    vaultAddress,
    [
      {
        inputs: [],
        name: 'governorAdmin',
        outputs: [{ internalType: 'address', name: '', type: 'address' }],
        stateMutability: 'view',
        type: 'function',
      },
    ],
    provider,
  )

  let governorAdmin = ethers.ZeroAddress
  try {
    governorAdmin = await vaultContract.governorAdmin()
  }
  catch {
    // governorAdmin may not exist on all vaults
  }

  return {
    type: 'securitize',
    address: data.vault,
    name: data.vaultName,
    symbol: data.vaultSymbol,
    decimals: data.vaultDecimals,
    totalShares: data.totalShares,
    totalAssets: data.totalAssets,
    isEVault: data.isEVault,
    asset: {
      address: data.asset,
      name: data.assetName,
      symbol: data.assetSymbol,
      decimals: data.assetDecimals,
    },
    governorAdmin,
  }
}

export const fetchEarnVault = async (vaultAddress: string): Promise<EarnVault> => {
  const { EVM_PROVIDER_URL } = useEulerConfig()
  const { earnVaults } = useEulerLabels()
  const { loadEulerConfig, isReady, eulerPeripheryAddresses } = useEulerAddresses()

  if (!isReady.value) {
    loadEulerConfig()
    await until(computed(() => isReady.value && eulerPeripheryAddresses.value?.eulerEarnGovernedPerspective)).toBeTruthy()
  }

  const { eulerLensAddresses } = useEulerAddresses()

  const provider = new ethers.JsonRpcProvider(EVM_PROVIDER_URL)
  const governedPerspectiveContract = new ethers.Contract(
    eulerPeripheryAddresses.value!.eulerEarnGovernedPerspective,
    eulerPerspectiveABI,
    provider,
  )
  const earnVaultLensContract = new ethers.Contract(
    eulerLensAddresses.value!.eulerEarnVaultLens,
    eulerEarnVaultLensABI,
    provider,
  )
  const utilsLensContract = new ethers.Contract(
    eulerLensAddresses.value!.utilsLens,
    eulerUtilsLensABI,
    provider,
  )

  const raw = await earnVaultLensContract.getVaultInfoFull(vaultAddress)
  const data = raw.toObject({ deep: true })

  const strategies = raw.strategies
    .toArray()
    .map((s: { toObject: (opts?: { deep?: boolean }) => EarnVaultStrategyInfo }) => {
      const strategy = s.toObject({ deep: true })
      return {
        strategy: strategy.strategy,
        allocatedAssets: strategy.allocatedAssets,
        availableAssets: strategy.availableAssets,
        currentAllocationCap: strategy.currentAllocationCap,
        pendingAllocationCap: strategy.pendingAllocationCap,
        pendingAllocationCapValidAt: strategy.pendingAllocationCapValidAt,
        removableAt: strategy.removableAt,
        info: strategy.info,
      }
    })

  const supplyAPY = await calculateEarnVaultAPYFromExchangeRate(
    vaultAddress,
    provider,
    data.vaultDecimals,
  )

  let assetPriceInfo
  try {
    const priceInfo = await utilsLensContract.getAssetPriceInfo(data.asset, USD_ADDRESS)
    const priceData = priceInfo.toObject ? priceInfo.toObject({ deep: true }) : priceInfo

    // Check if price query failed
    if (priceData.queryFailure || !priceData.amountOutMid || priceData.amountOutMid === 0n) {
      console.warn(`No price available for asset ${data.asset} (${data.assetSymbol})`)
      assetPriceInfo = undefined
    }
    else {
      assetPriceInfo = {
        amountOutMid: priceData.amountOutMid,
      }
    }
  }
  catch (e) {
    console.warn(`Error fetching price for asset ${data.asset} (${data.assetSymbol}):`, e)
    assetPriceInfo = undefined
  }

  const verifiedEarnVaults = await governedPerspectiveContract.verifiedArray() as string[]
  const verified = labelsRepo !== 'euler-xyz/euler-labels' ? earnVaults.value.includes(vaultAddress) : verifiedEarnVaults.includes(vaultAddress)

  return {
    verified,
    type: 'earn',
    address: data.vault,
    name: data.vaultName,
    symbol: data.vaultSymbol,
    decimals: data.vaultDecimals,
    totalShares: data.totalShares,
    totalAssets: data.totalAssets,
    lostAssets: data.lostAssets,
    availableAssets: data.availableAssets,
    timelock: data.timelock,
    performanceFee: data.performanceFee,
    feeReceiver: data.feeReceiver,
    owner: data.owner,
    creator: data.creator,
    curator: data.curator,
    guardian: data.guardian,
    evc: data.evc,
    permit2: data.permit2,
    pendingTimelock: data.pendingTimelock,
    pendingTimelockValidAt: data.pendingTimelockValidAt,
    pendingGuardian: data.pendingGuardian,
    pendingGuardianValidAt: data.pendingGuardianValidAt,
    supplyQueue: data.supplyQueue,
    asset: {
      address: data.asset,
      name: data.assetName,
      symbol: data.assetSymbol,
      decimals: data.assetDecimals,
    },
    strategies,
    supplyAPY,
    assetPriceInfo,
  } as EarnVault
}

export const fetchEscrowVault = async (vaultAddress: string): Promise<EscrowVault> => {
  const { EVM_PROVIDER_URL } = useEulerConfig()
  const { eulerLensAddresses } = useEulerAddresses()

  const vault = await fetchVault(vaultAddress)

  const provider = new ethers.JsonRpcProvider(EVM_PROVIDER_URL)
  const utilsLensContract = new ethers.Contract(
    eulerLensAddresses.value!.utilsLens,
    eulerUtilsLensABI,
    provider,
  )

  try {
    const priceInfo = await utilsLensContract.getAssetPriceInfo(vault.asset.address, USD_ADDRESS)
    const priceData = priceInfo.toObject ? priceInfo.toObject({ deep: true }) : priceInfo

    if (!priceData.queryFailure && priceData.amountOutMid && priceData.amountOutMid > 0n) {
      vault.liabilityPriceInfo = {
        amountIn: priceData.amountIn || ethers.parseUnits('1', Number(vault.asset.decimals)),
        amountOutAsk: priceData.amountOutAsk || priceData.amountOutMid,
        amountOutBid: priceData.amountOutBid || priceData.amountOutMid,
        amountOutMid: priceData.amountOutMid,
        queryFailure: false,
        queryFailureReason: '',
        timestamp: priceData.timestamp,
        oracle: priceData.oracle,
        asset: vault.asset.address,
        unitOfAccount: USD_ADDRESS,
      }
    }
  }
  catch (e) {
    console.warn(`Could not fetch asset price for escrow vault ${vaultAddress}:`, e)
  }

  return {
    ...vault,
    type: 'escrow',
    verified: true,
  } as EscrowVault
}

export const fetchVaults = async function* (
  vaultAddresses?: string[],
): AsyncGenerator<
    VaultIteratorResult<Vault>,
    void,
    unknown
  > {
  const { EVM_PROVIDER_URL, PYTH_HERMES_URL } = useEulerConfig()
  const { eulerLensAddresses, chainId } = useEulerAddresses()
  const { verifiedVaultAddresses } = useEulerLabels()

  const startChainId = chainId.value

  await until(
    computed(() => eulerLensAddresses.value?.vaultLens),
  ).toBeTruthy()

  if (!eulerLensAddresses.value?.vaultLens) {
    throw new Error('Euler addresses not loaded yet')
  }

  const provider = new ethers.JsonRpcProvider(EVM_PROVIDER_URL)
  const vaultLensContract = new ethers.Contract(
    eulerLensAddresses.value.vaultLens,
    eulerVaultLensABI,
    provider,
  )

  // Use provided addresses if available, otherwise fall back to verifiedVaultAddresses
  // (pre-categorization by caller is preferred to eliminate per-vault RPC calls)
  const verifiedVaults = vaultAddresses || verifiedVaultAddresses.value
  const batchSize = 5

  for (let i = 0; i < verifiedVaults.length; i += batchSize) {
    if (chainId.value !== startChainId) {
      return
    }
    const batch = verifiedVaults.slice(i, i + batchSize)
    const batchPromises = batch.map(async (vaultAddress) => {
      try {
        const raw = await vaultLensContract.getVaultInfoFull(vaultAddress)
        const data = raw.toObject({ deep: true })

        if (!data.irmInfo?.interestRateInfo?._) {
          data.irmInfo.interestRateInfo._ = {
            borrowAPY: 0n,
            borrowSPY: 0n,
            borrows: 0n,
            cash: 0n,
            supplyAPY: 0n,
          }
        }

        return {
          verified: true,
          address: data.vault,
          name: data.vaultName,
          supply: data.totalAssets,
          borrow: data.totalBorrowed,
          symbol: data.vaultSymbol,
          decimals: data.vaultDecimals,
          supplyCap: data.supplyCap,
          borrowCap: data.borrowCap,
          totalCash: data.totalCash,
          totalAssets: data.totalAssets,
          totalShares: data.totalShares,
          interestFee: data.interestFee,
          configFlags: data.configFlags,
          oracle: data.oracle,
          collateralLTVs: raw.collateralLTVInfo
            .toArray()
            .map((o: { toObject: () => void }) => o.toObject()),
          collateralPrices: raw.collateralPriceInfo
            .toArray()
            .map((o: { toObject: () => void }) => o.toObject()),
          liabilityPriceInfo: data.liabilityPriceInfo,
          maxLiquidationDiscount: data.maxLiquidationDiscount,
          interestRateInfo: data.irmInfo.interestRateInfo._, // might be a toObject deep conversion bug
          asset: {
            address: data.asset,
            name: data.assetName,
            symbol: data.assetSymbol,
            decimals: data.assetDecimals,
          },
          oracleDetailedInfo: data.oracleInfo,
          backupAssetOracleInfo: data.backupAssetOracleInfo,
          dToken: data.dToken,
          governorAdmin: data.governorAdmin,
          governorFeeReceiver: data.governorFeeReceiver,
          unitOfAccount: data.unitOfAccount,
          unitOfAccountName: data.unitOfAccountName,
          unitOfAccountSymbol: data.unitOfAccountSymbol,
          unitOfAccountDecimals: data.unitOfAccountDecimals,
          interestRateModelAddress: data.interestRateModel,
          hookTarget: data.hookTarget,
          irmInfo: data.irmInfo
            ? {
                interestRateModelInfo: data.irmInfo.interestRateModelInfo,
              }
            : undefined,
        } as Vault
      }
      catch (e) {
        console.error(`Error fetching collaterals for vault ${vaultAddress}:`, e)
        return undefined
      }
    })

    const res = await Promise.all(batchPromises)
    const validVaults = res.filter(o => !!o) as Vault[]
    await applyPythPriceInfo(validVaults, PYTH_HERMES_URL)
    await Promise.all(validVaults.map(vault => applyCollateralPythPriceInfo(vault, PYTH_HERMES_URL)))
    const isFinished = i + batchSize >= verifiedVaults.length

    yield {
      vaults: validVaults,
      isFinished,
    }
  }
}

export const fetchEarnVaults = async function* (): AsyncGenerator<
  VaultIteratorResult<EarnVault>,
  void,
  unknown
> {
  const { EVM_PROVIDER_URL: _EVM_PROVIDER_URL } = useEulerConfig()
  const { eulerLensAddresses, eulerPeripheryAddresses, chainId } = useEulerAddresses()
  const { earnVaults, isLoading } = useEulerLabels()

  const startChainId = chainId.value

  await until(
    computed(() => {
      return (
        eulerLensAddresses.value?.eulerEarnVaultLens
        && eulerLensAddresses.value?.utilsLens
        && eulerPeripheryAddresses.value?.eulerEarnGovernedPerspective
        && !isLoading.value
      )
    }),
  ).toBeTruthy()

  if (
    !eulerLensAddresses.value?.eulerEarnVaultLens
    || !eulerLensAddresses.value?.utilsLens
    || !eulerPeripheryAddresses.value?.eulerEarnGovernedPerspective
  ) {
    throw new Error('Euler Earn addresses not loaded yet')
  }

  const provider = new ethers.JsonRpcProvider(_EVM_PROVIDER_URL)
  const governedPerspectiveContract = new ethers.Contract(
    eulerPeripheryAddresses.value.eulerEarnGovernedPerspective,
    eulerPerspectiveABI,
    provider,
  )

  const earnVaultLensContract = new ethers.Contract(
    eulerLensAddresses.value.eulerEarnVaultLens,
    eulerEarnVaultLensABI,
    provider,
  )

  const utilsLensContract = new ethers.Contract(
    eulerLensAddresses.value.utilsLens,
    eulerUtilsLensABI,
    provider,
  )

  const verifiedVaults = earnVaults.value.length ? earnVaults.value : await governedPerspectiveContract.verifiedArray() as string[]
  const batchSize = 5

  for (let i = 0; i < verifiedVaults.length; i += batchSize) {
    if (chainId.value !== startChainId) {
      return
    }
    const batch = verifiedVaults.slice(i, i + batchSize)
    const batchPromises = batch.map(async (vaultAddress) => {
      try {
        const raw = await earnVaultLensContract.getVaultInfoFull(vaultAddress)
        const data = raw.toObject({ deep: true })

        const strategies = raw.strategies
          .toArray()
          .map((s: { toObject: (opts?: { deep?: boolean }) => EarnVaultStrategyInfo }) => {
            const strategy = s.toObject({ deep: true })
            return {
              strategy: strategy.strategy,
              allocatedAssets: strategy.allocatedAssets,
              availableAssets: strategy.availableAssets,
              currentAllocationCap: strategy.currentAllocationCap,
              pendingAllocationCap: strategy.pendingAllocationCap,
              pendingAllocationCapValidAt: strategy.pendingAllocationCapValidAt,
              removableAt: strategy.removableAt,
              info: strategy.info,
            }
          })

        const supplyAPY = await calculateEarnVaultAPYFromExchangeRate(
          vaultAddress,
          provider,
          data.vaultDecimals,
        )

        let assetPriceInfo
        try {
          const priceInfo = await utilsLensContract.getAssetPriceInfo(data.asset, USD_ADDRESS)
          const priceData = priceInfo.toObject ? priceInfo.toObject({ deep: true }) : priceInfo

          // Check if price query failed
          if (priceData.queryFailure || !priceData.amountOutMid || priceData.amountOutMid === 0n) {
            // Fallback: For stablecoins, assume $1 parity
            const stablecoins = [
              'USD',
              'USDC',
              'USDT',
              'DAI',
              'FRAX',
              'LUSD',
              'GUSD',
              'USDP',
              'TUSD',
              'BUSD',
              'SUSD',
            ]
            const isStablecoin = stablecoins.some(stable =>
              data.assetSymbol?.toUpperCase().includes(stable),
            )

            if (isStablecoin) {
              assetPriceInfo = {
                amountOutMid: ethers.parseUnits('1', 18),
              }
            }
            else {
              console.warn(`No price available for asset ${data.asset} (${data.assetSymbol})`)
              assetPriceInfo = undefined
            }
          }
          else {
            assetPriceInfo = {
              amountOutMid: priceData.amountOutMid,
            }
          }
        }
        catch (e) {
          console.warn(`Error fetching price for asset ${data.asset} (${data.assetSymbol}):`, e)
          assetPriceInfo = undefined
        }

        return {
          verified: true,
          type: 'earn',
          address: data.vault,
          name: data.vaultName,
          symbol: data.vaultSymbol,
          decimals: data.vaultDecimals,
          totalShares: data.totalShares,
          totalAssets: data.totalAssets,
          lostAssets: data.lostAssets,
          availableAssets: data.availableAssets,
          timelock: data.timelock,
          performanceFee: data.performanceFee,
          feeReceiver: data.feeReceiver,
          owner: data.owner,
          creator: data.creator,
          curator: data.curator,
          guardian: data.guardian,
          evc: data.evc,
          permit2: data.permit2,
          pendingTimelock: data.pendingTimelock,
          pendingTimelockValidAt: data.pendingTimelockValidAt,
          pendingGuardian: data.pendingGuardian,
          pendingGuardianValidAt: data.pendingGuardianValidAt,
          supplyQueue: data.supplyQueue,
          asset: {
            address: data.asset,
            name: data.assetName,
            symbol: data.assetSymbol,
            decimals: data.assetDecimals,
          },
          strategies,
          supplyAPY,
          assetPriceInfo,
        } as EarnVault
      }
      catch (e) {
        console.error(`Error fetching Earn vault ${vaultAddress}:`, e)
        return undefined
      }
    })

    const res = await Promise.all(batchPromises)
    const validVaults = res.filter(o => !!o) as EarnVault[]
    const isFinished = i + batchSize >= verifiedVaults.length

    yield {
      vaults: validVaults,
      isFinished,
    }
  }
}

export const fetchEscrowVaults = async function* (): AsyncGenerator<
  VaultIteratorResult<EscrowVault>,
  void,
  unknown
> {
  const { EVM_PROVIDER_URL, PYTH_HERMES_URL } = useEulerConfig()
  const { eulerPeripheryAddresses, eulerLensAddresses, chainId } = useEulerAddresses()

  const startChainId = chainId.value

  await until(
    computed(() => {
      return (
        eulerPeripheryAddresses.value?.escrowedCollateralPerspective
        && eulerLensAddresses.value?.vaultLens
        && eulerLensAddresses.value?.utilsLens
      )
    }),
  ).toBeTruthy()

  if (
    !eulerPeripheryAddresses.value?.escrowedCollateralPerspective
    || !eulerLensAddresses.value?.vaultLens
    || !eulerLensAddresses.value?.utilsLens
  ) {
    throw new Error('Escrow perspective or vault lens address not loaded yet')
  }

  const provider = new ethers.JsonRpcProvider(EVM_PROVIDER_URL)
  const perspectiveContract = new ethers.Contract(
    eulerPeripheryAddresses.value.escrowedCollateralPerspective,
    eulerPerspectiveABI,
    provider,
  )

  const vaultLensContract = new ethers.Contract(
    eulerLensAddresses.value.vaultLens,
    eulerVaultLensABI,
    provider,
  )

  const utilsLensContract = new ethers.Contract(
    eulerLensAddresses.value.utilsLens,
    eulerUtilsLensABI,
    provider,
  )

  let verifiedVaults: string[]
  try {
    verifiedVaults = (await perspectiveContract.verifiedArray()) as string[]
  }
  catch (e) {
    console.error('Error fetching escrow vaults from perspective:', e)
    verifiedVaults = []
  }

  const batchSize = 5

  for (let i = 0; i < verifiedVaults.length; i += batchSize) {
    if (chainId.value !== startChainId) {
      return
    }
    const batch = verifiedVaults.slice(i, i + batchSize)
    const batchPromises = batch.map(async (vaultAddress) => {
      try {
        const raw = await vaultLensContract.getVaultInfoFull(vaultAddress)
        const data = raw.toObject({ deep: true })

        if (!data.irmInfo?.interestRateInfo?._) {
          data.irmInfo.interestRateInfo._ = {
            borrowAPY: 0n,
            borrowSPY: 0n,
            borrows: 0n,
            cash: 0n,
            supplyAPY: 0n,
          }
        }

        return {
          verified: true,
          type: 'escrow',
          address: data.vault,
          name: data.vaultName,
          supply: data.totalAssets,
          borrow: data.totalBorrowed,
          symbol: data.vaultSymbol,
          decimals: data.vaultDecimals,
          supplyCap: data.supplyCap,
          borrowCap: data.borrowCap,
          totalCash: data.totalCash,
          totalAssets: data.totalAssets,
          totalShares: data.totalShares,
          interestFee: data.interestFee,
          configFlags: data.configFlags,
          oracle: data.oracle,
          collateralLTVs: raw.collateralLTVInfo
            .toArray()
            .map((o: { toObject: () => void }) => o.toObject()),
          collateralPrices: raw.collateralPriceInfo
            .toArray()
            .map((o: { toObject: () => void }) => o.toObject()),
          liabilityPriceInfo: data.liabilityPriceInfo,
          maxLiquidationDiscount: data.maxLiquidationDiscount,
          interestRateInfo: data.irmInfo.interestRateInfo._,
          asset: {
            address: data.asset,
            name: data.assetName,
            symbol: data.assetSymbol,
            decimals: data.assetDecimals,
          },
          oracleDetailedInfo: data.oracleInfo,
          backupAssetOracleInfo: data.backupAssetOracleInfo,
          dToken: data.dToken,
          governorAdmin: data.governorAdmin,
          governorFeeReceiver: data.governorFeeReceiver,
          unitOfAccount: data.unitOfAccount,
          unitOfAccountName: data.unitOfAccountName,
          unitOfAccountSymbol: data.unitOfAccountSymbol,
          unitOfAccountDecimals: data.unitOfAccountDecimals,
          interestRateModelAddress: data.interestRateModel,
          hookTarget: data.hookTarget,
          irmInfo: data.irmInfo
            ? {
                interestRateModelInfo: data.irmInfo.interestRateModelInfo,
              }
            : undefined,
        } as EscrowVault
      }
      catch (e) {
        console.error(`Error fetching escrow vault ${vaultAddress}:`, e)
        return undefined
      }
    })

    const res = await Promise.all(batchPromises)
    const validVaults = res.filter(o => !!o) as EscrowVault[]
    await applyPythPriceInfo(validVaults, PYTH_HERMES_URL)
    await Promise.all(validVaults.map(vault => applyCollateralPythPriceInfo(vault, PYTH_HERMES_URL)))

    await Promise.all(
      validVaults.map(async (vault) => {
        if (
          !vault.liabilityPriceInfo
          || vault.liabilityPriceInfo.queryFailure
          || vault.liabilityPriceInfo.amountOutMid === 0n
        ) {
          try {
            const priceInfo = await utilsLensContract.getAssetPriceInfo(
              vault.asset.address,
              USD_ADDRESS,
            )
            const priceData = priceInfo.toObject ? priceInfo.toObject({ deep: true }) : priceInfo

            if (!priceData.queryFailure && priceData.amountOutMid && priceData.amountOutMid > 0n) {
              vault.liabilityPriceInfo = {
                amountIn:
                  priceData.amountIn || ethers.parseUnits('1', Number(vault.asset.decimals)),
                amountOutAsk: priceData.amountOutAsk || priceData.amountOutMid,
                amountOutBid: priceData.amountOutBid || priceData.amountOutMid,
                amountOutMid: priceData.amountOutMid,
                queryFailure: false,
                queryFailureReason: '',
                timestamp: priceData.timestamp,
                oracle: priceData.oracle,
                asset: vault.asset.address,
                unitOfAccount: USD_ADDRESS,
              }
            }
          }
          catch (e) {
            console.warn(`Could not fetch asset price for escrow vault ${vault.address}:`, e)
          }
        }
      }),
    )

    const isFinished = i + batchSize >= verifiedVaults.length

    yield {
      vaults: validVaults,
      isFinished,
    }
  }
}

export const getBorrowVaultsByMap = (vaultsMap: Map<string, Vault>) => {
  const arr: BorrowVaultPair[] = []
  const list = [...vaultsMap.values()]
  list.forEach((vault) => {
    vault.collateralLTVs.forEach((c) => {
      if (c.borrowLTV <= 0n) {
        return
      }
      const cVault = vaultsMap.get(c.collateral)
      arr.push({
        borrow: vault,
        collateral: cVault!,
        borrowLTV: c.borrowLTV,
        liquidationLTV: c.liquidationLTV,
        initialLiquidationLTV: c.initialLiquidationLTV,
      })
    })
  })
  return arr.filter(o => !!o && o?.collateral)
}
export const getBorrowVaultPairByMapAndAddresses = (
  vaultsMap: Map<string, Vault>,
  collateralAddress: string,
  borrowAddress: string,
): BorrowVaultPair => {
  let obj: BorrowVaultPair | undefined = undefined
  const borrowVault = vaultsMap.get(borrowAddress)
  if (!borrowVault) {
    throw '[getBorrowVaultPairByMapAndAddresses]: Borrow vault not found'
  }
  borrowVault.collateralLTVs.forEach((c) => {
    if (c.collateral !== collateralAddress) {
      return
    }
    const cVault = vaultsMap.get(c.collateral)!
    obj = {
      borrow: borrowVault,
      collateral: cVault,
      borrowLTV: c.borrowLTV,
      liquidationLTV: c.liquidationLTV,
      initialLiquidationLTV: c.initialLiquidationLTV,
    } as BorrowVaultPair
  })

  if (!obj) {
    throw '[getBorrowVaultPairByMapAndAddresses]: Vault pair not found'
  }

  return obj
}
// Common price info shape returned by price helpers
export type PriceResult = {
  amountOutAsk: bigint
  amountOutBid: bigint
  amountOutMid: bigint
}

/**
 * Get price info for a vault's own asset (standalone context).
 * Uses Pyth real-time price first, then falls back to liabilityPriceInfo.
 *
 * IMPORTANT: Does NOT fall back to collateralPrices - that would return a different asset's price.
 */
export const getVaultPriceInfo = (vault: Vault): PriceResult | undefined => {
  // 1. Try Pyth real-time price first
  if (vault.pythPriceInfo?.amountOutMid && vault.pythPriceInfo.amountOutMid > 0n) {
    const mid = vault.pythPriceInfo.amountOutMid
    return { amountOutAsk: mid, amountOutBid: mid, amountOutMid: mid }
  }

  // 2. Check liabilityPriceInfo from lens
  if (!vault.liabilityPriceInfo || vault.liabilityPriceInfo.queryFailure) {
    return undefined // No valid price available — DO NOT fall back to collateralPrices
  }

  const { amountOutAsk, amountOutBid, amountOutMid } = vault.liabilityPriceInfo
  if (!amountOutMid || amountOutMid === 0n) {
    return undefined // No valid price available
  }

  const ask = amountOutAsk && amountOutAsk > 0n ? amountOutAsk : amountOutMid
  const bid = amountOutBid && amountOutBid > 0n ? amountOutBid : amountOutMid

  return { amountOutAsk: ask, amountOutBid: bid, amountOutMid }
}

/**
 * Get collateral SHARE price from the liability vault's perspective.
 * Uses Pyth price if available, otherwise falls back to lens collateralPrices.
 *
 * Use when: you have share amounts (e.g., position.shares)
 *
 * @param liabilityVault - The borrow vault that defines the collateral relationship
 * @param collateralAddress - Address of the collateral vault
 */
export const getCollateralPriceFromLiability = (
  liabilityVault: Vault,
  collateralVault: Vault,
): VaultCollateralPrice | undefined => {
  const collateralAddress = collateralVault.address.toLowerCase()

  const priceInfo = liabilityVault.collateralPrices.find(
    p => p.asset.toLowerCase() === collateralAddress,
  )

  if (!priceInfo) {
    return undefined // Collateral not configured for this vault
  }

  const pythPrice = liabilityVault.collateralPythPrices?.get(collateralAddress)
  if (pythPrice && pythPrice.amountOutMid > 0n) {
    // Return Pyth price with lens metadata — works even if lens query failed
    return {
      ...priceInfo,
      queryFailure: false, // Override since we have fresh Pyth price
      amountOutMid: pythPrice.amountOutMid,
      amountOutAsk: pythPrice.amountOutMid,
      amountOutBid: pythPrice.amountOutMid,
    }
  }

  if (priceInfo.queryFailure || !priceInfo.amountOutMid) {
    return undefined
  }

  return priceInfo
}

export const getCollateralAssetPriceFromLiability = (
  liabilityVault: Vault,
  collateralVault: Vault,
): VaultCollateralPrice | undefined => {
  const sharePrice = getCollateralPriceFromLiability(liabilityVault, collateralVault)

  if (!sharePrice) {
    return undefined
  }

  const { totalAssets, totalShares } = collateralVault

  if (totalAssets === 0n || totalShares === 0n) {
    return undefined
  }

  // assetPrice = sharePrice × (totalShares / totalAssets)
  return {
    ...sharePrice,
    amountOutMid: (sharePrice.amountOutMid * totalShares) / totalAssets,
    amountOutAsk: (sharePrice.amountOutAsk * totalShares) / totalAssets,
    amountOutBid: (sharePrice.amountOutBid * totalShares) / totalAssets,
  }
}

export const getVaultValueUsd = (
  amount: bigint,
  vault: Vault,
  liabilityContext?: Vault,
): number => {
  let priceInfo: { amountOutMid: bigint } | undefined

  if (liabilityContext) {
    priceInfo = getCollateralAssetPriceFromLiability(liabilityContext, vault)
  }
  else {
    priceInfo = getVaultPriceInfo(vault)
  }

  if (!priceInfo) {
    return 0
  }

  const actualAmount = nanoToValue(amount, vault.decimals)
  return actualAmount * nanoToValue(priceInfo.amountOutMid, 18)
}

export const getVaultPrice = (amount: number | bigint, vault: Vault) => {
  const priceInfo = getVaultPriceInfo(vault)
  if (!priceInfo) {
    return 0
  }
  const actualAmount = typeof amount === 'bigint' ? nanoToValue(amount, vault.decimals) : amount
  return actualAmount * nanoToValue(priceInfo.amountOutMid, 18)
}

export const getEarnVaultPrice = (amount: number | bigint, vault: EarnVault) => {
  if (!vault.assetPriceInfo?.amountOutMid) {
    return 0
  }
  const actualAmount
    = typeof amount === 'bigint' ? nanoToValue(amount, vault.asset.decimals) : amount
  return actualAmount * nanoToValue(vault.assetPriceInfo.amountOutMid, 18)
}

export const getVaultPriceDisplay = (
  amount: number | bigint,
  vault: Vault,
  options: { compact?: boolean, maxDecimals?: number, minDecimals?: number } = {},
): { display: string, hasPrice: boolean, usdValue: number, assetAmount: number, assetSymbol: string } => {
  const { maxDecimals = 2, minDecimals = 2 } = options
  const actualAmount = typeof amount === 'bigint' ? nanoToValue(amount, vault.decimals) : amount
  const priceInfo = getVaultPriceInfo(vault)

  if (!priceInfo) {
    const formattedAmount = actualAmount.toLocaleString('en-US', {
      maximumFractionDigits: maxDecimals,
      minimumFractionDigits: minDecimals,
    })
    return {
      display: `${formattedAmount} ${vault.asset.symbol}`,
      hasPrice: false,
      usdValue: 0,
      assetAmount: actualAmount,
      assetSymbol: vault.asset.symbol,
    }
  }

  const usdValue = actualAmount * nanoToValue(priceInfo.amountOutMid, 18)
  return {
    display: '', // Empty - components will format USD themselves
    hasPrice: true,
    usdValue,
    assetAmount: actualAmount,
    assetSymbol: vault.asset.symbol,
  }
}

export const getEarnVaultPriceDisplay = (
  amount: number | bigint,
  vault: EarnVault,
  options: { compact?: boolean, maxDecimals?: number, minDecimals?: number } = {},
): { display: string, hasPrice: boolean, usdValue: number, assetAmount: number, assetSymbol: string } => {
  const { maxDecimals = 2, minDecimals = 2 } = options
  const actualAmount = typeof amount === 'bigint' ? nanoToValue(amount, vault.asset.decimals) : amount

  if (!vault.assetPriceInfo?.amountOutMid) {
    const formattedAmount = actualAmount.toLocaleString('en-US', {
      maximumFractionDigits: maxDecimals,
      minimumFractionDigits: minDecimals,
    })
    return {
      display: `${formattedAmount} ${vault.asset.symbol}`,
      hasPrice: false,
      usdValue: 0,
      assetAmount: actualAmount,
      assetSymbol: vault.asset.symbol,
    }
  }

  const usdValue = actualAmount * nanoToValue(vault.assetPriceInfo.amountOutMid, 18)
  return {
    display: '', // Empty - components will format USD themselves
    hasPrice: true,
    usdValue,
    assetAmount: actualAmount,
    assetSymbol: vault.asset.symbol,
  }
}
export const computeAPYs = (borrowSPY: bigint, cash: bigint, borrows: bigint, interestFee: bigint) => {
  const { EVM_PROVIDER_URL } = useEulerConfig()
  const { eulerLensAddresses } = useEulerAddresses()

  if (!eulerLensAddresses.value?.utilsLens) {
    throw new Error('Euler addresses not loaded yet')
  }

  const provider = ethers.getDefaultProvider(EVM_PROVIDER_URL)
  const utilsLensContract = new ethers.Contract(
    eulerLensAddresses.value.utilsLens,
    eulerUtilsLensABI,
    provider,
  )
  return utilsLensContract.computeAPYs(borrowSPY, cash, borrows, interestFee)
}
export const getNetAPY = (
  supplyUSD: number,
  supplyAPY: number,
  borrowUSD: number,
  borrowAPY: number,
  supplyRewardAPY?: number | null,
  borrowRewardAPY?: number | null,
) => {
  if (supplyUSD === 0) {
    return 0
  }
  const sum
    = supplyUSD * (supplyAPY + (supplyRewardAPY || 0))
      - borrowUSD * (borrowAPY - (borrowRewardAPY || 0))
  return sum / supplyUSD
}
export const convertSharesToAssets = (
  vaultAddress: string,
  sharesAmount: bigint,
): Promise<bigint> => {
  const { EVM_PROVIDER_URL } = useEulerConfig()
  const provider = new ethers.JsonRpcProvider(EVM_PROVIDER_URL)
  const contract = new ethers.Contract(vaultAddress, vaultConvertToAssetsAbi, provider)
  return contract.convertToAssets(sharesAmount).catch(_ => 0n)
}
export const convertAssetsToShares = (
  vaultAddress: string,
  assetsAmount: bigint,
): Promise<bigint> => {
  const { EVM_PROVIDER_URL } = useEulerConfig()
  const provider = new ethers.JsonRpcProvider(EVM_PROVIDER_URL)
  const contract = new ethers.Contract(vaultAddress, vaultConvertToSharesAbi, provider)
  return contract.convertToShares(assetsAmount).catch(_ => 0n)
}
export const previewWithdraw = (vaultAddress: string, assetsAmount: bigint): Promise<bigint> => {
  const { EVM_PROVIDER_URL } = useEulerConfig()
  const provider = new ethers.JsonRpcProvider(EVM_PROVIDER_URL)
  const contract = new ethers.Contract(vaultAddress, vaultPreviewWithdrawAbi, provider)
  return contract.previewWithdraw(assetsAmount).catch(_ => 0n)
}
export const getMaxWithdraw = (vaultAddress: string, account: string): Promise<bigint> => {
  const { EVM_PROVIDER_URL } = useEulerConfig()
  const provider = new ethers.JsonRpcProvider(EVM_PROVIDER_URL)
  const contract = new ethers.Contract(vaultAddress, vaultMaxWithdrawAbi, provider)
  return contract.maxWithdraw(account)
}

export const getUtilization = (totalAssets: bigint, totalBorrow: bigint): number => {
  if (!totalAssets || totalAssets <= 0n || !totalBorrow || totalBorrow <= 0n) {
    return 0
  }

  const assetsNum = Number(totalAssets)
  const borrowNum = Number(totalBorrow)

  const utilization = (borrowNum / assetsNum) * 100

  return Number(utilization.toFixed(2))
}

export const getVaultUtilization = (vault: Vault): number => {
  return getUtilization(vault.totalAssets, vault.borrow)
}

const calculateEarnVaultAPYFromExchangeRate = async (
  vaultAddress: string,
  provider: ethers.JsonRpcProvider,
  decimals: bigint,
): Promise<number> => {
  try {
    const currentBlock = await provider.getBlockNumber()

    const sampleDistance = 100
    const currentBlockData = await provider.getBlock(currentBlock)
    const sampleBlockData = await provider.getBlock(currentBlock - sampleDistance)

    if (!currentBlockData || !sampleBlockData) {
      console.warn(`Could not fetch blocks for vault ${vaultAddress}`)
      return 0
    }

    const timeDiff = Number(currentBlockData.timestamp - sampleBlockData.timestamp)
    const avgBlockTime = timeDiff / sampleDistance

    if (avgBlockTime === 0) {
      console.warn(`Invalid block time calculated for vault ${vaultAddress}`)
      return 0
    }

    // Calculate how many blocks ago represents ~1 hour
    const blocksPerHour = Math.floor(TARGET_TIME_AGO / avgBlockTime)
    const oneHourAgoBlock = Math.max(0, currentBlock - blocksPerHour)

    // Create vault contract instance
    const vaultContract = new ethers.Contract(
      vaultAddress,
      vaultConvertToAssetsAbi,
      provider,
    )

    const oneShare = ethers.parseUnits('1', Number(decimals))

    const [currentRate, oneHourAgoRate, oneHourAgoBlockData] = await Promise.all([
      vaultContract.convertToAssets(oneShare),
      vaultContract.convertToAssets(oneShare, { blockTag: oneHourAgoBlock }),
      provider.getBlock(oneHourAgoBlock),
    ])

    if (!oneHourAgoBlockData) {
      console.warn(`Could not fetch historical block data for vault ${vaultAddress}`)
      return 0
    }

    if (oneHourAgoRate === 0n) {
      return 0
    }

    const timeElapsed = Number(currentBlockData.timestamp - oneHourAgoBlockData.timestamp)

    if (timeElapsed === 0) {
      return 0
    }

    const rateChange = Number(currentRate - oneHourAgoRate) / Number(oneHourAgoRate)

    const apy = ((rateChange * SECONDS_IN_YEAR) / timeElapsed) * 100

    return Number.isFinite(apy) ? apy : 0
  }
  catch (e) {
    console.error(`Error calculating APY for vault ${vaultAddress}:`, e)
    return 0
  }
}
