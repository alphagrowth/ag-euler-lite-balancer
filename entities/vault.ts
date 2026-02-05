import { ethers } from 'ethers'
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

// Securitize factory address - vaults created by this factory are treated as securitize vaults
export const SECURITIZE_FACTORY_ADDRESS = '0x5f51d980f15fe6075ae30394dc35de57a4f76cbb'

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
  utilsLensContract: ethers.Contract,
  assetAddress: string,
): Promise<{ amountOutMid: bigint } | undefined> => {
  try {
    const priceInfo = await utilsLensContract.getAssetPriceInfo(assetAddress, USD_ADDRESS)
    const priceData = priceInfo.toObject ? priceInfo.toObject({ deep: true }) : priceInfo

    // Note: 0n is a valid price (very small value), only reject null/undefined or explicit failure
    if (priceData.queryFailure || priceData.amountOutMid === undefined || priceData.amountOutMid === null) {
      return undefined
    }

    return { amountOutMid: priceData.amountOutMid }
  }
  catch (e) {
    console.warn(`Error fetching price for asset ${assetAddress}:`, e)
    return undefined
  }
}

const resolveUnitOfAccountPriceInfo = async (
  utilsLensContract: ethers.Contract,
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

  const priceInfo = await resolveAssetPriceInfo(utilsLensContract, unitOfAccount)
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
  const data = raw.toObject({ deep: true })

  return {
    verified: verifiedVaultAddresses.includes(vaultAddress),
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
}

/**
 * Fetch vault using EVC batchSimulation with Pyth updates.
 * This ensures fresh Pyth prices are available when querying vault info.
 *
 * @param vaultAddress - The vault address to fetch
 * @param feeds - Pre-collected Pyth feeds for this vault
 * @param provider - JSON-RPC provider
 * @param vaultLensContract - Vault lens contract instance
 * @param evcAddress - EVC contract address
 * @param hermesEndpoint - Pyth Hermes endpoint URL
 * @param providerUrl - JSON-RPC provider URL for Pyth batch building
 * @param verifiedVaultAddresses - List of verified vault addresses
 * @returns Vault with fresh Pyth prices, or undefined if simulation fails
 */
const fetchVaultWithPythSimulation = async (
  vaultAddress: string,
  feeds: PythFeed[],
  provider: ethers.JsonRpcProvider,
  vaultLensContract: ethers.Contract,
  evcAddress: string,
  hermesEndpoint: string,
  providerUrl: string,
  verifiedVaultAddresses: string[],
): Promise<Vault | undefined> => {
  const result = await executeLensWithPythSimulation(
    feeds,
    vaultLensContract,
    'getVaultInfoFull',
    [vaultAddress],
    evcAddress,
    provider,
    providerUrl,
    hermesEndpoint,
  ) as Record<string, unknown>[] | undefined

  if (!result || !result[0]) {
    return undefined
  }

  return processRawVaultData(result[0] as Record<string, unknown>, vaultAddress, verifiedVaultAddresses)
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

  const provider = new ethers.JsonRpcProvider(EVM_PROVIDER_URL)
  const vaultLensContract = new ethers.Contract(
    eulerLensAddresses.value!.vaultLens,
    eulerVaultLensABI,
    provider,
  )
  const utilsLensContract = eulerLensAddresses.value?.utilsLens
    ? new ethers.Contract(
        eulerLensAddresses.value.utilsLens,
        eulerUtilsLensABI,
        provider,
      )
    : undefined

  // Standard query first (fast path for non-Pyth vaults)
  const raw = await vaultLensContract.getVaultInfoFull(vaultAddress)
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
      provider,
      vaultLensContract,
      eulerCoreAddresses.value.evc,
      PYTH_HERMES_URL,
      EVM_PROVIDER_URL,
      verifiedVaultAddresses.value,
    )
    if (vaultWithFreshPrice) {
      vault = vaultWithFreshPrice
    }
  }

  if (utilsLensContract) {
    const [assetPriceInfo, unitOfAccountPriceInfo] = await Promise.all([
      resolveAssetPriceInfo(utilsLensContract, vault.asset.address),
      resolveUnitOfAccountPriceInfo(utilsLensContract, vault.unitOfAccount),
    ])
    vault.assetPriceInfo = assetPriceInfo
    vault.unitOfAccountPriceInfo = unitOfAccountPriceInfo
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

  const provider = new ethers.JsonRpcProvider(EVM_PROVIDER_URL)
  const utilsLensContract = new ethers.Contract(
    eulerLensAddresses.value!.utilsLens,
    eulerUtilsLensABI,
    provider,
  )

  const raw = await utilsLensContract.getVaultInfoERC4626(vaultAddress)
  const data = raw.toObject({ deep: true })

  // Fetch governor admin and supply cap from the vault contract
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
      {
        inputs: [],
        name: 'supplyCapResolved',
        outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
        stateMutability: 'view',
        type: 'function',
      },
    ],
    provider,
  )

  let governorAdmin = ethers.ZeroAddress
  let supplyCap = 0n
  try {
    governorAdmin = await vaultContract.governorAdmin()
  }
  catch {
    // governorAdmin may not exist on all vaults
  }
  try {
    supplyCap = await vaultContract.supplyCapResolved()
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

    // Check if price query failed (0n is valid - very small price)
    if (priceData.queryFailure || priceData.amountOutMid === undefined || priceData.amountOutMid === null) {
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

export const fetchEscrowVault = async (vaultAddress: string): Promise<Vault> => {
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

  const provider = new ethers.JsonRpcProvider(EVM_PROVIDER_URL)
  const vaultLensContract = new ethers.Contract(
    eulerLensAddresses.value.vaultLens,
    eulerVaultLensABI,
    provider,
  )
  const utilsLensContract = eulerLensAddresses.value.utilsLens
    ? new ethers.Contract(
        eulerLensAddresses.value.utilsLens,
        eulerUtilsLensABI,
        provider,
      )
    : undefined

  // Use provided addresses if available, otherwise fall back to verifiedVaultAddresses
  // (pre-categorization by caller is preferred to eliminate per-vault RPC calls)
  const verifiedVaults = vaultAddresses || verifiedVaultAddresses.value
  const batchSize = 25
  const parallelBatches = 5 // Run 5 batches concurrently (125 vaults per round)

  const batchCount = Math.ceil(verifiedVaults.length / batchSize)
  const parallelRounds = Math.ceil(batchCount / parallelBatches)

  // Helper to fetch a single batch
  const fetchBatch = async (batchAddresses: string[]): Promise<Vault[]> => {
    const batchPromises = batchAddresses.map(async (vaultAddress) => {
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
            ? { interestRateModelInfo: data.irmInfo.interestRateModelInfo }
            : undefined,
        } as Vault
      }
      catch (e) {
        console.error(`Error fetching vault ${vaultAddress}:`, e)
        return undefined
      }
    })

    const res = await Promise.all(batchPromises)
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
              provider,
              vaultLensContract,
              eulerCoreAddresses.value!.evc,
              PYTH_HERMES_URL,
              EVM_PROVIDER_URL,
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
    if (utilsLensContract) {
      await Promise.all(
        validVaults.map(async (vault) => {
          const [assetPriceInfo, unitOfAccountPriceInfo] = await Promise.all([
            resolveAssetPriceInfo(utilsLensContract, vault.asset.address),
            resolveUnitOfAccountPriceInfo(utilsLensContract, vault.unitOfAccount),
          ])
          vault.assetPriceInfo = assetPriceInfo
          vault.unitOfAccountPriceInfo = unitOfAccountPriceInfo
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

  const verifiedVaults = labelsRepo !== 'euler-xyz/euler-labels'
    ? earnVaults.value
    : await governedPerspectiveContract.verifiedArray() as string[]

  // Start block prefetch in parallel - will be awaited when needed for APY calculation
  const blockCachePromise = fetchBlockDataForAPY(provider)

  // Helper to fetch a single vault (lens + price only, APY calculated after)
  type PartialEarnVault = Omit<EarnVault, 'supplyAPY'> & { decimals: bigint }

  const fetchVaultData = async (vaultAddress: string): Promise<PartialEarnVault | undefined> => {
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

      let assetPriceInfo
      try {
        const priceInfo = await utilsLensContract.getAssetPriceInfo(data.asset, USD_ADDRESS)
        const priceData = priceInfo.toObject ? priceInfo.toObject({ deep: true }) : priceInfo

        // Note: 0n is a valid price (very small value)
        if (priceData.queryFailure || priceData.amountOutMid === undefined || priceData.amountOutMid === null) {
          assetPriceInfo = undefined
        }
        else {
          assetPriceInfo = { amountOutMid: priceData.amountOutMid }
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
          ? await calculateEarnVaultAPYWithCache(vaultData.address, provider, vaultData.decimals, blockCache)
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

  const provider = new ethers.JsonRpcProvider(EVM_PROVIDER_URL)
  const perspectiveContract = new ethers.Contract(
    eulerPeripheryAddresses.value.escrowedCollateralPerspective,
    eulerPerspectiveABI,
    provider,
  )

  try {
    const addresses = (await perspectiveContract.verifiedArray()) as string[]
    return addresses.map(addr => ethers.getAddress(addr))
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
          vaultCategory: 'escrow',
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
        } as Vault
      }
      catch (e) {
        console.error(`Error fetching escrow vault ${vaultAddress}:`, e)
        return undefined
      }
    })

    const res = await Promise.all(batchPromises)
    const validVaults = res.filter(o => !!o) as Vault[]

    await Promise.all(
      validVaults.map(async (vault) => {
        const [assetPriceInfo, unitOfAccountPriceInfo] = await Promise.all([
          resolveAssetPriceInfo(utilsLensContract, vault.asset.address),
          resolveUnitOfAccountPriceInfo(utilsLensContract, vault.unitOfAccount),
        ])
        vault.assetPriceInfo = assetPriceInfo
        vault.unitOfAccountPriceInfo = unitOfAccountPriceInfo
      }),
    )

    await Promise.all(
      validVaults.map(async (vault) => {
        // Refetch price if missing or query failed (0n is valid - very small price)
        if (
          !vault.liabilityPriceInfo
          || vault.liabilityPriceInfo.queryFailure
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

// Cached block data for APY calculations (shared across all vaults)
interface BlockDataCache {
  currentBlock: number
  currentBlockData: ethers.Block
  oneHourAgoBlock: number
  oneHourAgoBlockData: ethers.Block
}

// Pre-fetch block data once for all APY calculations
const fetchBlockDataForAPY = async (provider: ethers.JsonRpcProvider): Promise<BlockDataCache | null> => {
  try {
    const currentBlock = await provider.getBlockNumber()
    const sampleDistance = 100

    // Estimate oneHourAgoBlock upfront using typical block times
    // This allows all 3 getBlock calls to run in parallel
    // We'll refine the estimate after getting actual block data
    const estimatedBlockTime = 12 // Conservative estimate (Ethereum mainnet)
    const estimatedBlocksPerHour = Math.floor(TARGET_TIME_AGO / estimatedBlockTime)
    const estimatedOneHourAgoBlock = Math.max(0, currentBlock - estimatedBlocksPerHour)

    // Fetch all 3 blocks in parallel
    const [currentBlockData, sampleBlockData, estimatedOneHourAgoBlockData] = await Promise.all([
      provider.getBlock(currentBlock),
      provider.getBlock(currentBlock - sampleDistance),
      provider.getBlock(estimatedOneHourAgoBlock),
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
      oneHourAgoBlockData = await provider.getBlock(actualOneHourAgoBlock)
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
  provider: ethers.JsonRpcProvider,
  decimals: bigint,
  blockCache: BlockDataCache,
): Promise<number> => {
  try {
    const vaultContract = new ethers.Contract(
      vaultAddress,
      vaultConvertToAssetsAbi,
      provider,
    )

    const oneShare = ethers.parseUnits('1', Number(decimals))

    const [currentRate, oneHourAgoRate] = await Promise.all([
      vaultContract.convertToAssets(oneShare),
      vaultContract.convertToAssets(oneShare, { blockTag: blockCache.oneHourAgoBlock }),
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
  provider: ethers.JsonRpcProvider,
  decimals: bigint,
): Promise<number> => {
  const blockCache = await fetchBlockDataForAPY(provider)
  if (!blockCache) {
    return 0
  }
  return calculateEarnVaultAPYWithCache(vaultAddress, provider, decimals, blockCache)
}
