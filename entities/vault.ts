import { getAddress, zeroAddress, parseUnits, encodeFunctionData, decodeFunctionResult, type Address, type Hex, type Abi } from 'viem'
import axios from 'axios'
import { labelsRepo } from './custom'
import { SECONDS_IN_YEAR, TARGET_TIME_AGO, USD_ADDRESS } from '~/entities/constants'
import {
  vaultConvertToAssetsAbi,
  vaultConvertToSharesAbi,
  vaultMaxWithdrawAbi,
  vaultPreviewWithdrawAbi,
} from '~/abis/vault'
import type { OracleDetailedInfo, PythFeed } from '~/entities/oracle'
import { collectPythFeedIds } from '~/entities/oracle'
import {
  eulerEarnVaultLensABI,
  eulerPerspectiveABI,
  eulerUtilsLensABI,
  eulerVaultLensABI,
} from '~/entities/euler/abis'
import { executeLensWithPythSimulation } from '~/utils/pyth'
import { useVaultRegistry } from '~/composables/useVaultRegistry'
import { nanoToValue } from '~/utils/crypto-utils'
import { batchLensCalls } from '~/utils/multicall'
import { getPublicClient } from '~/utils/public-client'

// Cache for vault factory lookups
const vaultFactoryCache = new Map<string, string>()
const unitOfAccountPriceCache = new Map<string, { amountOutMid: bigint } | null>()

const ONE_18 = 10n ** 18n

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
    const { eulerPeripheryAddresses } = useEulerAddresses()
    const securitizeFactory = eulerPeripheryAddresses.value?.securitizeFactory
    if (!securitizeFactory) {
      return false
    }

    const factory = await fetchVaultFactory(address)
    if (!factory) {
      return false
    }
    return factory.toLowerCase() === securitizeFactory.toLowerCase()
  }
  catch {
    return false
  }
}

// Synchronous check using cached factory data
export const isSecuritizeVaultSync = (address: string): boolean => {
  const { eulerPeripheryAddresses } = useEulerAddresses()
  const securitizeFactory = eulerPeripheryAddresses.value?.securitizeFactory
  if (!securitizeFactory) {
    return false
  }

  const normalizedAddress = address.toLowerCase()
  const factory = vaultFactoryCache.get(normalizedAddress)
  if (!factory) {
    return false
  }
  return factory.toLowerCase() === securitizeFactory.toLowerCase()
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
  const { eulerPeripheryAddresses } = useEulerAddresses()
  const securitizeFactory = eulerPeripheryAddresses.value?.securitizeFactory
  if (!securitizeFactory) {
    return []
  }

  const factories = await fetchVaultFactories(vaultAddresses)
  const securitizeAddresses: string[] = []

  factories.forEach((factory, address) => {
    if (factory.toLowerCase() === securitizeFactory.toLowerCase()) {
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
  verified: boolean
  governorAdmin: string
  supplyCap: bigint
  // Compatibility fields with Vault type
  supply: bigint // Same as totalAssets (no borrowing)
  borrow: bigint // Always 0 (securitize vaults can't be borrowed from)
  interestRateInfo: VaultInterestRateInfo // Zero-valued
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
  liabilityPriceInfo: VaultLiabilityPriceInfo
  assetPriceInfo?: {
    amountOutMid: bigint
  }
  unitOfAccountPriceInfo?: {
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
  // Vault category: 'escrow' for escrow vaults, undefined/'standard' for regular EVK vaults
  vaultCategory?: 'standard' | 'escrow'
}
export interface BorrowVaultPair {
  borrow: Vault
  collateral: Vault
  borrowLTV: bigint
  liquidationLTV: bigint
  initialLiquidationLTV: bigint
  targetTimestamp: bigint
  rampDuration: bigint
}

export interface SecuritizeBorrowVaultPair {
  borrow: Vault
  collateral: SecuritizeVault
  borrowLTV: bigint
  liquidationLTV: bigint
  initialLiquidationLTV: bigint
  targetTimestamp: bigint
  rampDuration: bigint
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


export interface CollateralOption {
  type: string
  amount: number
  price: number
  apy?: number
  label?: string
  symbol?: string
  vaultAddress?: string
}

const resolveAssetPriceInfo = async (
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
      args: [assetAddress, USD_ADDRESS],
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

const resolveUnitOfAccountPriceInfo = async (
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

/**
 * Process raw vault lens data into a Vault object.
 * Extracted to enable reuse between direct query and simulation-based fetch.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const processRawVaultData = (
  raw: any,
  vaultAddress: string,
  verifiedVaultAddresses: string[],
): Vault => {
  return {
    verified: verifiedVaultAddresses.includes(vaultAddress),
    address: raw.vault,
    name: raw.vaultName,
    supply: raw.totalAssets,
    borrow: raw.totalBorrowed,
    symbol: raw.vaultSymbol,
    decimals: raw.vaultDecimals,
    supplyCap: raw.supplyCap,
    borrowCap: raw.borrowCap,
    totalCash: raw.totalCash,
    totalAssets: raw.totalAssets,
    totalShares: raw.totalShares,
    interestFee: raw.interestFee,
    configFlags: raw.configFlags,
    oracle: raw.oracle,
    collateralLTVs: raw.collateralLTVInfo,
    collateralPrices: raw.collateralPriceInfo,
    liabilityPriceInfo: raw.liabilityPriceInfo,
    maxLiquidationDiscount: raw.maxLiquidationDiscount,
    interestRateInfo: raw.irmInfo?.interestRateInfo?.[0] ?? {
      borrowAPY: 0n,
      borrowSPY: 0n,
      borrows: 0n,
      cash: 0n,
      supplyAPY: 0n,
    },
    asset: {
      address: raw.asset,
      name: raw.assetName,
      symbol: raw.assetSymbol,
      decimals: raw.assetDecimals,
    },
    oracleDetailedInfo: raw.oracleInfo,
    backupAssetOracleInfo: raw.backupAssetOracleInfo,
    dToken: raw.dToken,
    governorAdmin: raw.governorAdmin,
    governorFeeReceiver: raw.governorFeeReceiver,
    unitOfAccount: raw.unitOfAccount,
    unitOfAccountName: raw.unitOfAccountName,
    unitOfAccountSymbol: raw.unitOfAccountSymbol,
    unitOfAccountDecimals: raw.unitOfAccountDecimals,
    interestRateModelAddress: raw.interestRateModel,
    hookTarget: raw.hookTarget,
    irmInfo: raw.irmInfo
      ? {
          interestRateModelInfo: raw.irmInfo.interestRateModelInfo,
        }
      : undefined,
  } as Vault
}

/**
 * Fetch vault using EVC batchSimulation with Pyth updates.
 * This ensures fresh Pyth prices are available when querying vault info.
 *
 * @param vaultAddress - The vault address to fetch
 * @param feeds - Pre-collected Pyth feeds for this vault
 * @param rpcUrl - JSON-RPC provider URL
 * @param vaultLensAddress - Vault lens contract address
 * @param evcAddress - EVC contract address
 * @param hermesEndpoint - Pyth Hermes endpoint URL
 * @param verifiedVaultAddresses - List of verified vault addresses
 * @returns Vault with fresh Pyth prices, or undefined if simulation fails
 */
const fetchVaultWithPythSimulation = async (
  vaultAddress: string,
  feeds: PythFeed[],
  rpcUrl: string,
  vaultLensAddress: string,
  evcAddress: string,
  hermesEndpoint: string,
  verifiedVaultAddresses: string[],
): Promise<Vault | undefined> => {
  const result = await executeLensWithPythSimulation(
    feeds,
    vaultLensAddress,
    eulerVaultLensABI,
    'getVaultInfoFull',
    [vaultAddress],
    evcAddress,
    rpcUrl,
    hermesEndpoint,
  ) as Record<string, unknown> | undefined

  if (!result) {
    return undefined
  }

  return processRawVaultData(result, vaultAddress, verifiedVaultAddresses)
}

export const fetchVault = async (vaultAddress: string): Promise<Vault> => {
  const { EVM_PROVIDER_URL, PYTH_HERMES_URL } = useEulerConfig()
  const { loadEulerConfig, isReady } = useEulerAddresses()
  const { verifiedVaultAddresses } = useEulerLabels()

  if (!isReady.value) {
    loadEulerConfig()
    await until(computed(() => isReady.value)).toBeTruthy()
  }
  const { eulerLensAddresses, eulerCoreAddresses } = useEulerAddresses()

  const client = getPublicClient(EVM_PROVIDER_URL)

  // Standard query first (fast path for non-Pyth vaults)
  const raw = await client.readContract({
    address: eulerLensAddresses.value!.vaultLens as Address,
    abi: eulerVaultLensABI,
    functionName: 'getVaultInfoFull',
    args: [vaultAddress],
  }) as Record<string, unknown>
  let vault = processRawVaultData(raw, vaultAddress, verifiedVaultAddresses.value)

  // Check if vault uses Pyth oracles
  const feeds = collectPythFeedIds(vault.oracleDetailedInfo)

  // ALWAYS re-query with simulation if Pyth detected
  // Pyth prices are only valid for ~2 minutes after on-chain update,
  // so we need fresh prices even if current query succeeded
  if (feeds.length > 0 && eulerCoreAddresses.value?.evc && PYTH_HERMES_URL) {
    const vaultWithFreshPrice = await fetchVaultWithPythSimulation(
      vaultAddress,
      feeds,
      EVM_PROVIDER_URL,
      eulerLensAddresses.value!.vaultLens,
      eulerCoreAddresses.value.evc,
      PYTH_HERMES_URL,
      verifiedVaultAddresses.value,
    )
    if (vaultWithFreshPrice) {
      vault = vaultWithFreshPrice
    }
  }

  if (eulerLensAddresses.value?.utilsLens) {
    const [assetPriceInfo, unitOfAccountPriceInfo] = await Promise.all([
      resolveAssetPriceInfo(EVM_PROVIDER_URL, eulerLensAddresses.value.utilsLens, vault.asset.address),
      resolveUnitOfAccountPriceInfo(EVM_PROVIDER_URL, eulerLensAddresses.value.utilsLens, vault.unitOfAccount),
    ])
    vault = { ...vault, assetPriceInfo, unitOfAccountPriceInfo }
  }

  return vault
}

export const fetchSecuritizeVault = async (vaultAddress: string): Promise<SecuritizeVault> => {
  const { EVM_PROVIDER_URL } = useEulerConfig()
  const { loadEulerConfig, isReady } = useEulerAddresses()
  const { verifiedVaultAddresses } = useEulerLabels()

  if (!isReady.value) {
    loadEulerConfig()
    await until(computed(() => isReady.value)).toBeTruthy()
  }
  const { eulerLensAddresses } = useEulerAddresses()

  const client = getPublicClient(EVM_PROVIDER_URL)

  const data = await client.readContract({
    address: eulerLensAddresses.value!.utilsLens as Address,
    abi: eulerUtilsLensABI,
    functionName: 'getVaultInfoERC4626',
    args: [vaultAddress],
  }) as Record<string, unknown>

  const governorAdminAbi = [
    {
      inputs: [],
      name: 'governorAdmin',
      outputs: [{ internalType: 'address', name: '', type: 'address' }],
      stateMutability: 'view',
      type: 'function',
    },
  ] as const

  const supplyCapResolvedAbi = [
    {
      inputs: [],
      name: 'supplyCapResolved',
      outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
      stateMutability: 'view',
      type: 'function',
    },
  ] as const

  let governorAdmin: string = zeroAddress
  let supplyCap = 0n
  try {
    governorAdmin = await client.readContract({
      address: vaultAddress as Address,
      abi: governorAdminAbi,
      functionName: 'governorAdmin',
    }) as string
  }
  catch {
    // governorAdmin may not exist on all vaults
  }
  try {
    supplyCap = await client.readContract({
      address: vaultAddress as Address,
      abi: supplyCapResolvedAbi,
      functionName: 'supplyCapResolved',
    }) as bigint
  }
  catch {
    // supplyCapResolved may not exist on all vaults
  }

  return {
    type: 'securitize',
    verified: verifiedVaultAddresses.value.includes(vaultAddress),
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
    supplyCap,
    // Compatibility fields with Vault type
    supply: data.totalAssets, // Same as totalAssets
    borrow: 0n, // Securitize vaults can't be borrowed from
    interestRateInfo: {
      borrowAPY: 0n,
      borrowSPY: 0n,
      borrows: 0n,
      cash: data.totalAssets,
      supplyAPY: 0n,
    },
  } as SecuritizeVault
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

  const client = getPublicClient(EVM_PROVIDER_URL)

  const verifiedEarnVaults = await client.readContract({
    address: eulerPeripheryAddresses.value!.eulerEarnGovernedPerspective as Address,
    abi: eulerPerspectiveABI,
    functionName: 'verifiedArray',
  }) as string[]

  const data = await client.readContract({
    address: eulerLensAddresses.value!.eulerEarnVaultLens as Address,
    abi: eulerEarnVaultLensABI,
    functionName: 'getVaultInfoFull',
    args: [vaultAddress],
  }) as Record<string, unknown>

  const strategies = (data.strategies as EarnVaultStrategyInfo[]).map((strategy) => {
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
    EVM_PROVIDER_URL,
    data.vaultDecimals as bigint,
  )

  let assetPriceInfo
  try {
    const priceInfo = await client.readContract({
      address: eulerLensAddresses.value!.utilsLens as Address,
      abi: eulerUtilsLensABI,
      functionName: 'getAssetPriceInfo',
      args: [data.asset, USD_ADDRESS],
    }) as Record<string, unknown>

    // Check if price query failed (0n is valid - very small price)
    if (priceInfo.queryFailure || priceInfo.amountOutMid === undefined || priceInfo.amountOutMid === null) {
      console.warn(`No price available for asset ${data.asset} (${data.assetSymbol})`)
      assetPriceInfo = undefined
    }
    else {
      assetPriceInfo = {
        amountOutMid: priceInfo.amountOutMid as bigint,
      }
    }
  }
  catch (e) {
    console.warn(`Error fetching price for asset ${data.asset} (${data.assetSymbol}):`, e)
    assetPriceInfo = undefined
  }

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

export const fetchEscrowVault = async (vaultAddress: string): Promise<Vault> => {
  const { EVM_PROVIDER_URL } = useEulerConfig()
  const { eulerLensAddresses } = useEulerAddresses()

  const vault = await fetchVault(vaultAddress)

  try {
    const client = getPublicClient(EVM_PROVIDER_URL)
    const priceInfo = await client.readContract({
      address: eulerLensAddresses.value!.utilsLens as Address,
      abi: eulerUtilsLensABI,
      functionName: 'getAssetPriceInfo',
      args: [vault.asset.address, USD_ADDRESS],
    }) as Record<string, unknown>

    if (!priceInfo.queryFailure && priceInfo.amountOutMid && (priceInfo.amountOutMid as bigint) > 0n) {
      return {
        ...vault,
        liabilityPriceInfo: {
          amountIn: (priceInfo.amountIn as bigint) || parseUnits('1', Number(vault.asset.decimals)),
          amountOutAsk: (priceInfo.amountOutAsk as bigint) || (priceInfo.amountOutMid as bigint),
          amountOutBid: (priceInfo.amountOutBid as bigint) || (priceInfo.amountOutMid as bigint),
          amountOutMid: priceInfo.amountOutMid as bigint,
          queryFailure: false,
          queryFailureReason: '',
          timestamp: priceInfo.timestamp as bigint,
          oracle: priceInfo.oracle as string,
          asset: vault.asset.address,
          unitOfAccount: USD_ADDRESS,
        },
        vaultCategory: 'escrow' as const,
        verified: true,
      }
    }
  }
  catch (e) {
    console.warn(`Could not fetch asset price for escrow vault ${vaultAddress}:`, e)
  }

  return {
    ...vault,
    vaultCategory: 'escrow',
    verified: true,
  }
}

export const fetchVaults = async function* (
  vaultAddresses?: string[],
): AsyncGenerator<
    VaultIteratorResult<Vault>,
    void,
    unknown
  > {
  const { EVM_PROVIDER_URL, PYTH_HERMES_URL } = useEulerConfig()
  const { eulerLensAddresses, eulerCoreAddresses, chainId } = useEulerAddresses()
  const { verifiedVaultAddresses } = useEulerLabels()

  const startChainId = chainId.value

  await until(
    computed(() => eulerLensAddresses.value?.vaultLens),
  ).toBeTruthy()

  if (!eulerLensAddresses.value?.vaultLens) {
    throw new Error('Euler addresses not loaded yet')
  }

  const client = getPublicClient(EVM_PROVIDER_URL)

  // Use provided addresses if available, otherwise fall back to verifiedVaultAddresses
  // (pre-categorization by caller is preferred to eliminate per-vault RPC calls)
  const verifiedVaults = vaultAddresses || verifiedVaultAddresses.value
  const batchSize = 25
  const parallelBatches = 5 // Run 5 batches concurrently (125 vaults per round)

  const batchCount = Math.ceil(verifiedVaults.length / batchSize)
  const parallelRounds = Math.ceil(batchCount / parallelBatches)

  // Helper to process raw vault data into Vault object
  const processVaultResult = (raw: Record<string, unknown>, vaultAddress: string): Vault | undefined => {
    try {
      const defaultInterestRateInfo = {
        borrowAPY: 0n,
        borrowSPY: 0n,
        borrows: 0n,
        cash: 0n,
        supplyAPY: 0n,
      }

      return {
        verified: true,
        address: (raw as any).vault,
        name: (raw as any).vaultName,
        supply: (raw as any).totalAssets,
        borrow: (raw as any).totalBorrowed,
        symbol: (raw as any).vaultSymbol,
        decimals: (raw as any).vaultDecimals,
        supplyCap: (raw as any).supplyCap,
        borrowCap: (raw as any).borrowCap,
        totalCash: (raw as any).totalCash,
        totalAssets: (raw as any).totalAssets,
        totalShares: (raw as any).totalShares,
        interestFee: (raw as any).interestFee,
        configFlags: (raw as any).configFlags,
        oracle: (raw as any).oracle,
        collateralLTVs: (raw as any).collateralLTVInfo,
        collateralPrices: (raw as any).collateralPriceInfo,
        liabilityPriceInfo: (raw as any).liabilityPriceInfo,
        maxLiquidationDiscount: (raw as any).maxLiquidationDiscount,
        interestRateInfo: (raw as any).irmInfo?.interestRateInfo?.[0] ?? defaultInterestRateInfo,
        asset: {
          address: (raw as any).asset,
          name: (raw as any).assetName,
          symbol: (raw as any).assetSymbol,
          decimals: (raw as any).assetDecimals,
        },
        oracleDetailedInfo: (raw as any).oracleInfo,
        backupAssetOracleInfo: (raw as any).backupAssetOracleInfo,
        dToken: (raw as any).dToken,
        governorAdmin: (raw as any).governorAdmin,
        governorFeeReceiver: (raw as any).governorFeeReceiver,
        unitOfAccount: (raw as any).unitOfAccount,
        unitOfAccountName: (raw as any).unitOfAccountName,
        unitOfAccountSymbol: (raw as any).unitOfAccountSymbol,
        unitOfAccountDecimals: (raw as any).unitOfAccountDecimals,
        interestRateModelAddress: (raw as any).interestRateModel,
        hookTarget: (raw as any).hookTarget,
        irmInfo: (raw as any).irmInfo
          ? { interestRateModelInfo: (raw as any).irmInfo.interestRateModelInfo }
          : undefined,
      } as Vault
    }
    catch (e) {
      console.error(`Error processing vault ${vaultAddress}:`, e)
      return undefined
    }
  }

  // Helper to fetch vault individually (used as fallback)
  const fetchVaultIndividually = async (vaultAddress: string): Promise<Vault | undefined> => {
    try {
      const raw = await client.readContract({
        address: eulerLensAddresses.value!.vaultLens as Address,
        abi: eulerVaultLensABI,
        functionName: 'getVaultInfoFull',
        args: [vaultAddress],
      }) as Record<string, unknown>
      return processVaultResult(raw, vaultAddress)
    }
    catch (e) {
      console.error(`Error fetching vault ${vaultAddress}:`, e)
      return undefined
    }
  }

  // Helper to fetch a batch of vaults using EVC batchSimulation
  const fetchBatch = async (batchAddresses: string[]): Promise<Vault[]> => {
    // Use EVC batchSimulation if available for batched RPC calls
    if (eulerCoreAddresses.value?.evc) {
      const calls = batchAddresses.map(vaultAddress => ({
        functionName: 'getVaultInfoFull',
        args: [vaultAddress],
      }))

      const results = await batchLensCalls<Record<string, unknown>>(
        eulerCoreAddresses.value.evc,
        eulerLensAddresses.value!.vaultLens,
        eulerVaultLensABI,
        calls,
        EVM_PROVIDER_URL,
      )

      const vaults: Vault[] = []
      const failedAddresses: string[] = []

      for (let i = 0; i < results.length; i++) {
        const result = results[i]
        if (result.success && result.result) {
          // batchLensCalls returns decoded result directly (viem unwraps single outputs)
          const raw = result.result as Record<string, unknown>
          const vault = processVaultResult(raw, batchAddresses[i])
          if (vault) {
            vaults.push(vault)
          }
          else {
            failedAddresses.push(batchAddresses[i])
          }
        }
        else {
          failedAddresses.push(batchAddresses[i])
        }
      }

      // Retry failed items individually
      if (failedAddresses.length > 0) {
        console.warn(`[fetchBatch] Retrying ${failedAddresses.length} failed vaults individually`)
        const retryResults = await Promise.all(
          failedAddresses.map(addr => fetchVaultIndividually(addr)),
        )
        for (const vault of retryResults) {
          if (vault) {
            vaults.push(vault)
          }
        }
      }

      return vaults
    }

    // Fallback to individual calls if EVC not available
    const res = await Promise.all(batchAddresses.map(addr => fetchVaultIndividually(addr)))
    return res.filter(o => !!o) as Vault[]
  }

  // Process batches in parallel rounds
  for (let round = 0; round < parallelRounds; round++) {
    if (chainId.value !== startChainId) {
      return
    }

    // Get batches for this round
    const roundStart = round * parallelBatches * batchSize
    const roundBatches: string[][] = []

    for (let b = 0; b < parallelBatches; b++) {
      const batchStart = roundStart + b * batchSize
      if (batchStart >= verifiedVaults.length) break
      roundBatches.push(verifiedVaults.slice(batchStart, batchStart + batchSize))
    }

    // Fetch all batches in this round in parallel
    const roundResults = await Promise.all(roundBatches.map(batch => fetchBatch(batch)))
    let validVaults = roundResults.flat()

    // Re-fetch Pyth-powered vaults with simulation to get fresh prices
    // Pyth prices are only valid for ~2 minutes after on-chain update
    if (eulerCoreAddresses.value?.evc && PYTH_HERMES_URL) {
      const pythVaultsToRefresh = validVaults.filter((vault) => {
        const feeds = collectPythFeedIds(vault.oracleDetailedInfo)
        return feeds.length > 0
      })

      if (pythVaultsToRefresh.length > 0) {
        const refreshedVaults = await Promise.all(
          pythVaultsToRefresh.map(async (vault) => {
            const feeds = collectPythFeedIds(vault.oracleDetailedInfo)
            const refreshed = await fetchVaultWithPythSimulation(
              vault.address,
              feeds,
              EVM_PROVIDER_URL,
              eulerLensAddresses.value!.vaultLens,
              eulerCoreAddresses.value!.evc,
              PYTH_HERMES_URL,
              verifiedVaultAddresses.value,
            )
            return refreshed || vault // Fall back to original if simulation fails
          }),
        )

        // Replace original vaults with refreshed versions
        const refreshedMap = new Map(refreshedVaults.map(v => [v.address, v]))
        validVaults = validVaults.map(v => refreshedMap.get(v.address) || v)
      }
    }

    // Populate assetPriceInfo and unitOfAccountPriceInfo for USD conversion
    if (eulerLensAddresses.value?.utilsLens) {
      const utilsLensAddress = eulerLensAddresses.value.utilsLens
      validVaults = await Promise.all(
        validVaults.map(async (vault) => {
          const [assetPriceInfo, unitOfAccountPriceInfo] = await Promise.all([
            resolveAssetPriceInfo(EVM_PROVIDER_URL, utilsLensAddress, vault.asset.address),
            resolveUnitOfAccountPriceInfo(EVM_PROVIDER_URL, utilsLensAddress, vault.unitOfAccount),
          ])
          return { ...vault, assetPriceInfo, unitOfAccountPriceInfo }
        }),
      )
    }

    const isFinished = (round + 1) * parallelBatches * batchSize >= verifiedVaults.length

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

  const client = getPublicClient(_EVM_PROVIDER_URL)

  const verifiedVaults = labelsRepo !== 'euler-xyz/euler-labels'
    ? earnVaults.value
    : await client.readContract({
        address: eulerPeripheryAddresses.value.eulerEarnGovernedPerspective as Address,
        abi: eulerPerspectiveABI,
        functionName: 'verifiedArray',
      }) as string[]

  // Start block prefetch in parallel - will be awaited when needed for APY calculation
  const blockCachePromise = fetchBlockDataForAPY(_EVM_PROVIDER_URL)

  // Helper to fetch a single vault (lens + price only, APY calculated after)
  type PartialEarnVault = Omit<EarnVault, 'supplyAPY'> & { decimals: bigint }

  const fetchVaultData = async (vaultAddress: string): Promise<PartialEarnVault | undefined> => {
    try {
      const data = await client.readContract({
        address: eulerLensAddresses.value!.eulerEarnVaultLens as Address,
        abi: eulerEarnVaultLensABI,
        functionName: 'getVaultInfoFull',
        args: [vaultAddress],
      }) as Record<string, unknown>

      const strategies = (data.strategies as EarnVaultStrategyInfo[]).map((strategy) => {
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

      let assetPriceInfo
      try {
        const priceInfo = await client.readContract({
          address: eulerLensAddresses.value!.utilsLens as Address,
          abi: eulerUtilsLensABI,
          functionName: 'getAssetPriceInfo',
          args: [data.asset, USD_ADDRESS],
        }) as Record<string, unknown>

        // Note: 0n is a valid price (very small value)
        if (priceInfo.queryFailure || priceInfo.amountOutMid === undefined || priceInfo.amountOutMid === null) {
          assetPriceInfo = undefined
        }
        else {
          assetPriceInfo = { amountOutMid: priceInfo.amountOutMid as bigint }
        }
      }
      catch {
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
        assetPriceInfo,
      } as PartialEarnVault
    }
    catch (e) {
      console.error(`Error fetching Earn vault ${vaultAddress}:`, e)
      return undefined
    }
  }

  // Fetch all vault data in parallel with block prefetch
  const allVaultDataPromises = verifiedVaults.map(addr => fetchVaultData(addr))

  // Wait for both block cache and vault data
  const [blockCache, allVaultData] = await Promise.all([
    blockCachePromise,
    Promise.all(allVaultDataPromises),
  ])

  // Calculate APY for all vaults (using cached block data)
  const vaultsWithAPY = await Promise.all(
    allVaultData
      .filter((v): v is PartialEarnVault => v !== undefined)
      .map(async (vaultData) => {
        const supplyAPY = blockCache
          ? await calculateEarnVaultAPYWithCache(vaultData.address, _EVM_PROVIDER_URL, vaultData.decimals, blockCache)
          : 0
        return { ...vaultData, supplyAPY } as EarnVault
      }),
  )

  yield {
    vaults: vaultsWithAPY,
    isFinished: true,
  }
}


/**
 * Fetch escrow vault addresses only (no vault info).
 * Single RPC call to get the list of addresses from escrowedCollateralPerspective.
 * Used for lazy loading optimization - vault info is fetched on-demand.
 */
export const fetchEscrowAddresses = async (): Promise<string[]> => {
  const { EVM_PROVIDER_URL } = useEulerConfig()
  const { eulerPeripheryAddresses } = useEulerAddresses()

  await until(
    computed(() => eulerPeripheryAddresses.value?.escrowedCollateralPerspective),
  ).toBeTruthy()

  if (!eulerPeripheryAddresses.value?.escrowedCollateralPerspective) {
    return []
  }

  const client = getPublicClient(EVM_PROVIDER_URL)

  try {
    const addresses = await client.readContract({
      address: eulerPeripheryAddresses.value.escrowedCollateralPerspective as Address,
      abi: eulerPerspectiveABI,
      functionName: 'verifiedArray',
    }) as string[]
    return addresses.map(addr => getAddress(addr))
  }
  catch (e) {
    console.error('Error fetching escrow addresses from perspective:', e)
    return []
  }
}

export const fetchEscrowVaults = async function* (): AsyncGenerator<
  VaultIteratorResult<Vault>,
  void,
  unknown
> {
  const { EVM_PROVIDER_URL } = useEulerConfig()
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

  const client = getPublicClient(EVM_PROVIDER_URL)

  let verifiedVaults: string[]
  try {
    verifiedVaults = await client.readContract({
      address: eulerPeripheryAddresses.value.escrowedCollateralPerspective as Address,
      abi: eulerPerspectiveABI,
      functionName: 'verifiedArray',
    }) as string[]
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
        const raw = await client.readContract({
          address: eulerLensAddresses.value!.vaultLens as Address,
          abi: eulerVaultLensABI,
          functionName: 'getVaultInfoFull',
          args: [vaultAddress],
        }) as Record<string, unknown>

        const defaultInterestRateInfo = {
          borrowAPY: 0n,
          borrowSPY: 0n,
          borrows: 0n,
          cash: 0n,
          supplyAPY: 0n,
        }

        return {
          verified: true,
          vaultCategory: 'escrow',
          address: (raw as any).vault,
          name: (raw as any).vaultName,
          supply: (raw as any).totalAssets,
          borrow: (raw as any).totalBorrowed,
          symbol: (raw as any).vaultSymbol,
          decimals: (raw as any).vaultDecimals,
          supplyCap: (raw as any).supplyCap,
          borrowCap: (raw as any).borrowCap,
          totalCash: (raw as any).totalCash,
          totalAssets: (raw as any).totalAssets,
          totalShares: (raw as any).totalShares,
          interestFee: (raw as any).interestFee,
          configFlags: (raw as any).configFlags,
          oracle: (raw as any).oracle,
          collateralLTVs: (raw as any).collateralLTVInfo,
          collateralPrices: (raw as any).collateralPriceInfo,
          liabilityPriceInfo: (raw as any).liabilityPriceInfo,
          maxLiquidationDiscount: (raw as any).maxLiquidationDiscount,
          interestRateInfo: (raw as any).irmInfo?.interestRateInfo?.[0] ?? defaultInterestRateInfo,
          asset: {
            address: (raw as any).asset,
            name: (raw as any).assetName,
            symbol: (raw as any).assetSymbol,
            decimals: (raw as any).assetDecimals,
          },
          oracleDetailedInfo: (raw as any).oracleInfo,
          backupAssetOracleInfo: (raw as any).backupAssetOracleInfo,
          dToken: (raw as any).dToken,
          governorAdmin: (raw as any).governorAdmin,
          governorFeeReceiver: (raw as any).governorFeeReceiver,
          unitOfAccount: (raw as any).unitOfAccount,
          unitOfAccountName: (raw as any).unitOfAccountName,
          unitOfAccountSymbol: (raw as any).unitOfAccountSymbol,
          unitOfAccountDecimals: (raw as any).unitOfAccountDecimals,
          interestRateModelAddress: (raw as any).interestRateModel,
          hookTarget: (raw as any).hookTarget,
          irmInfo: (raw as any).irmInfo
            ? {
                interestRateModelInfo: (raw as any).irmInfo.interestRateModelInfo,
              }
            : undefined,
        } as Vault
      }
      catch (e) {
        console.error(`Error fetching escrow vault ${vaultAddress}:`, e)
        return undefined
      }
    })

    const res = await Promise.all(batchPromises)
    let validVaults = res.filter(o => !!o) as Vault[]

    const utilsLensAddress = eulerLensAddresses.value!.utilsLens
    validVaults = await Promise.all(
      validVaults.map(async (vault) => {
        const [assetPriceInfo, unitOfAccountPriceInfo] = await Promise.all([
          resolveAssetPriceInfo(EVM_PROVIDER_URL, utilsLensAddress, vault.asset.address),
          resolveUnitOfAccountPriceInfo(EVM_PROVIDER_URL, utilsLensAddress, vault.unitOfAccount),
        ])
        return { ...vault, assetPriceInfo, unitOfAccountPriceInfo }
      }),
    )

    validVaults = await Promise.all(
      validVaults.map(async (vault) => {
        // Refetch price if missing or query failed (0n is valid - very small price)
        if (
          !vault.liabilityPriceInfo
          || vault.liabilityPriceInfo.queryFailure
        ) {
          try {
            const priceInfo = await client.readContract({
              address: utilsLensAddress as Address,
              abi: eulerUtilsLensABI,
              functionName: 'getAssetPriceInfo',
              args: [vault.asset.address, USD_ADDRESS],
            }) as Record<string, unknown>

            if (!priceInfo.queryFailure && priceInfo.amountOutMid && (priceInfo.amountOutMid as bigint) > 0n) {
              return {
                ...vault,
                liabilityPriceInfo: {
                  amountIn:
                    (priceInfo.amountIn as bigint) || parseUnits('1', Number(vault.asset.decimals)),
                  amountOutAsk: (priceInfo.amountOutAsk as bigint) || (priceInfo.amountOutMid as bigint),
                  amountOutBid: (priceInfo.amountOutBid as bigint) || (priceInfo.amountOutMid as bigint),
                  amountOutMid: priceInfo.amountOutMid as bigint,
                  queryFailure: false,
                  queryFailureReason: '',
                  timestamp: priceInfo.timestamp as bigint,
                  oracle: priceInfo.oracle as string,
                  asset: vault.asset.address,
                  unitOfAccount: USD_ADDRESS,
                },
              }
            }
          }
          catch (e) {
            console.warn(`Could not fetch asset price for escrow vault ${vault.address}:`, e)
          }
        }
        return vault
      }),
    )

    const isFinished = i + batchSize >= verifiedVaults.length

    yield {
      vaults: validVaults,
      isFinished,
    }
  }
}

/** Shared LTV ramp config fields used by both VaultCollateralLTV and BorrowVaultPair */
type LTVRampConfig = Pick<VaultCollateralLTV, 'liquidationLTV' | 'initialLiquidationLTV' | 'targetTimestamp' | 'rampDuration'>

/**
 * Calculate the current liquidation LTV, taking into account ramping.
 * When liquidation LTV is lowered, it ramps down linearly from initialLiquidationLTV
 * to liquidationLTV (target) over rampDuration, reaching target at targetTimestamp.
 */
export const getCurrentLiquidationLTV = (ltv: LTVRampConfig): bigint => {
  const now = BigInt(Math.floor(Date.now() / 1000))

  // If ramping is complete or LTV is ramping UP (not down), return target
  if (now >= ltv.targetTimestamp || ltv.liquidationLTV >= ltv.initialLiquidationLTV) {
    return ltv.liquidationLTV
  }

  // Calculate interpolated value during ramp down
  const timeRemaining = ltv.targetTimestamp - now
  const currentLTV = ltv.liquidationLTV
    + ((ltv.initialLiquidationLTV - ltv.liquidationLTV) * timeRemaining) / ltv.rampDuration

  return currentLTV
}

/**
 * Check if the liquidation LTV is currently ramping down
 */
export const isLiquidationLTVRamping = (ltv: LTVRampConfig): boolean => {
  const now = BigInt(Math.floor(Date.now() / 1000))

  // Ramping down if: not yet at target timestamp AND target is less than initial (ramping DOWN)
  return now < ltv.targetTimestamp && ltv.liquidationLTV < ltv.initialLiquidationLTV
}

/**
 * Get the time remaining until ramping completes (in seconds)
 */
export const getRampTimeRemaining = (ltv: LTVRampConfig): bigint => {
  const now = BigInt(Math.floor(Date.now() / 1000))
  if (now >= ltv.targetTimestamp) {
    return 0n
  }
  return ltv.targetTimestamp - now
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
        targetTimestamp: c.targetTimestamp,
        rampDuration: c.rampDuration,
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
      targetTimestamp: c.targetTimestamp,
      rampDuration: c.rampDuration,
    } as BorrowVaultPair
  })

  if (!obj) {
    throw '[getBorrowVaultPairByMapAndAddresses]: Vault pair not found'
  }

  return obj
}
// ============================================
// Pricing functions have been moved to:
// ~/services/pricing/priceProvider.ts
// ============================================

export const computeAPYs = (borrowSPY: bigint, cash: bigint, borrows: bigint, interestFee: bigint) => {
  const { EVM_PROVIDER_URL } = useEulerConfig()
  const { eulerLensAddresses } = useEulerAddresses()

  if (!eulerLensAddresses.value?.utilsLens) {
    throw new Error('Euler addresses not loaded yet')
  }

  const client = getPublicClient(EVM_PROVIDER_URL)
  return client.readContract({
    address: eulerLensAddresses.value.utilsLens as Address,
    abi: eulerUtilsLensABI,
    functionName: 'computeAPYs',
    args: [borrowSPY, cash, borrows, interestFee],
  })
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
  const client = getPublicClient(EVM_PROVIDER_URL)
  return client.readContract({
    address: vaultAddress as Address,
    abi: vaultConvertToAssetsAbi,
    functionName: 'convertToAssets',
    args: [sharesAmount],
  }).catch(() => 0n) as Promise<bigint>
}
export const convertAssetsToShares = (
  vaultAddress: string,
  assetsAmount: bigint,
): Promise<bigint> => {
  const { EVM_PROVIDER_URL } = useEulerConfig()
  const client = getPublicClient(EVM_PROVIDER_URL)
  return client.readContract({
    address: vaultAddress as Address,
    abi: vaultConvertToSharesAbi,
    functionName: 'convertToShares',
    args: [assetsAmount],
  }).catch(() => 0n) as Promise<bigint>
}
export const previewWithdraw = (vaultAddress: string, assetsAmount: bigint): Promise<bigint> => {
  const { EVM_PROVIDER_URL } = useEulerConfig()
  const client = getPublicClient(EVM_PROVIDER_URL)
  return client.readContract({
    address: vaultAddress as Address,
    abi: vaultPreviewWithdrawAbi,
    functionName: 'previewWithdraw',
    args: [assetsAmount],
  }).catch(() => 0n) as Promise<bigint>
}
export const getMaxWithdraw = (vaultAddress: string, account: string): Promise<bigint> => {
  const { EVM_PROVIDER_URL } = useEulerConfig()
  const client = getPublicClient(EVM_PROVIDER_URL)
  return client.readContract({
    address: vaultAddress as Address,
    abi: vaultMaxWithdrawAbi,
    functionName: 'maxWithdraw',
    args: [account],
  }) as Promise<bigint>
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

// Cached block data for APY calculations (shared across all vaults)
interface BlockDataCache {
  currentBlock: number
  currentBlockData: { number: bigint; timestamp: bigint }
  oneHourAgoBlock: number
  oneHourAgoBlockData: { number: bigint; timestamp: bigint }
}

// Pre-fetch block data once for all APY calculations
const fetchBlockDataForAPY = async (rpcUrl: string): Promise<BlockDataCache | null> => {
  try {
    const client = getPublicClient(rpcUrl)
    const currentBlockBigInt = await client.getBlockNumber()
    const currentBlock = Number(currentBlockBigInt)
    const sampleDistance = 100

    // Estimate oneHourAgoBlock upfront using typical block times
    // This allows all 3 getBlock calls to run in parallel
    // We'll refine the estimate after getting actual block data
    const estimatedBlockTime = 12 // Conservative estimate (Ethereum mainnet)
    const estimatedBlocksPerHour = Math.floor(TARGET_TIME_AGO / estimatedBlockTime)
    const estimatedOneHourAgoBlock = Math.max(0, currentBlock - estimatedBlocksPerHour)

    // Fetch all 3 blocks in parallel
    const [currentBlockData, sampleBlockData, estimatedOneHourAgoBlockData] = await Promise.all([
      client.getBlock({ blockNumber: BigInt(currentBlock) }),
      client.getBlock({ blockNumber: BigInt(currentBlock - sampleDistance) }),
      client.getBlock({ blockNumber: BigInt(estimatedOneHourAgoBlock) }),
    ])

    if (!currentBlockData || !sampleBlockData) {
      return null
    }

    // Calculate actual block time and refine if needed
    const timeDiff = Number(currentBlockData.timestamp - sampleBlockData.timestamp)
    const avgBlockTime = timeDiff / sampleDistance

    if (avgBlockTime === 0) {
      return null
    }

    const blocksPerHour = Math.floor(TARGET_TIME_AGO / avgBlockTime)
    const actualOneHourAgoBlock = Math.max(0, currentBlock - blocksPerHour)

    // If estimate was close enough, use the already-fetched block data
    // Otherwise fetch the correct block (rare case)
    let oneHourAgoBlockData = estimatedOneHourAgoBlockData
    if (actualOneHourAgoBlock !== estimatedOneHourAgoBlock) {
      oneHourAgoBlockData = await client.getBlock({ blockNumber: BigInt(actualOneHourAgoBlock) })
    }

    if (!oneHourAgoBlockData) {
      return null
    }

    return {
      currentBlock,
      currentBlockData,
      oneHourAgoBlock: actualOneHourAgoBlock,
      oneHourAgoBlockData,
    }
  }
  catch (e) {
    console.error('Error fetching block data for APY:', e)
    return null
  }
}

// Calculate APY using cached block data (only 2 RPC calls per vault instead of 6)
const calculateEarnVaultAPYWithCache = async (
  vaultAddress: string,
  rpcUrl: string,
  decimals: bigint,
  blockCache: BlockDataCache,
): Promise<number> => {
  try {
    const client = getPublicClient(rpcUrl)

    const oneShare = parseUnits('1', Number(decimals))

    const [currentRate, oneHourAgoRate] = await Promise.all([
      client.readContract({
        address: vaultAddress as Address,
        abi: vaultConvertToAssetsAbi,
        functionName: 'convertToAssets',
        args: [oneShare],
      }) as Promise<bigint>,
      client.readContract({
        address: vaultAddress as Address,
        abi: vaultConvertToAssetsAbi,
        functionName: 'convertToAssets',
        args: [oneShare],
        blockNumber: BigInt(blockCache.oneHourAgoBlock),
      }) as Promise<bigint>,
    ])

    if (oneHourAgoRate === 0n) {
      return 0
    }

    const timeElapsed = Number(blockCache.currentBlockData.timestamp - blockCache.oneHourAgoBlockData.timestamp)

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

// Legacy function for single vault fetch (kept for backward compatibility)
const calculateEarnVaultAPYFromExchangeRate = async (
  vaultAddress: string,
  rpcUrl: string,
  decimals: bigint,
): Promise<number> => {
  const blockCache = await fetchBlockDataForAPY(rpcUrl)
  if (!blockCache) {
    return 0
  }
  return calculateEarnVaultAPYWithCache(vaultAddress, rpcUrl, decimals, blockCache)
}
