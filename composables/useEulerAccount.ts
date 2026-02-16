import { getAddress, type Address, type Abi } from 'viem'
import { FixedPoint } from '~/utils/fixed-point'
import { getPublicClient } from '~/utils/public-client'
import { fetchAccountPositions, type SubgraphPositionEntry } from '~/utils/subgraph'
import { ref, watch, watchEffect, computed, type Ref } from 'vue'
import { useAccount } from '@wagmi/vue'
import { useVaultRegistry } from './useVaultRegistry'
import { eulerAccountLensABI } from '~/entities/euler/abis'
import type { EulerLensAddresses } from '~/composables/useEulerAddresses'
import type {
  AccountBorrowPosition, AccountDepositPosition,
} from '~/entities/account'
import {
  fetchVault,
  type Vault,
  type SecuritizeVault,
  type EarnVault,
} from '~/entities/vault'
import {
  getAssetUsdValue,
  getCollateralUsdPrice,
  getCollateralUsdValue,
  getCollateralUsdValueOrZero,
} from '~/services/pricing/priceProvider'
import { nanoToValue } from '~/utils/crypto-utils'
import { collectPythFeedIds } from '~/entities/oracle'
import { executeLensWithPythSimulation } from '~/utils/pyth'

/** Decoded shape of the AccountLiquidityInfo struct from the Euler lens */
interface LensLiquidityInfo {
  queryFailure: boolean
  queryFailureReason: string
  account: Address
  vault: Address
  unitOfAccount: Address
  timeToLiquidation: bigint
  liabilityValueBorrowing: bigint
  liabilityValueLiquidation: bigint
  collateralValueBorrowing: bigint
  collateralValueLiquidation: bigint
  collateralValueRaw: bigint
  collaterals: Address[]
  collateralValuesBorrowing: bigint[]
  collateralValuesLiquidation: bigint[]
  collateralValuesRaw: bigint[]
}

/** Decoded shape of the VaultAccountInfo struct from the Euler lens */
interface LensVaultAccountInfo {
  timestamp: bigint
  account: Address
  vault: Address
  asset: Address
  assetsAccount: bigint
  shares: bigint
  assets: bigint
  borrowed: bigint
  assetAllowanceVault: bigint
  assetAllowanceVaultPermit2: bigint
  assetAllowanceExpirationVaultPermit2: bigint
  assetAllowancePermit2: bigint
  balanceForwarderEnabled: boolean
  isController: boolean
  isCollateral: boolean
  liquidityInfo: LensLiquidityInfo
}

/** Decoded shape of the EVCAccountInfo struct from the Euler lens */
interface LensEvcAccountInfo {
  timestamp: bigint
  evc: Address
  account: Address
  addressPrefix: string
  owner: Address
  isLockdownMode: boolean
  isPermitDisabledMode: boolean
  lastAccountStatusCheckTimestamp: bigint
  enabledControllers: Address[]
  enabledCollaterals: Address[]
}

/** Decoded shape of the AccountInfo struct (getAccountInfo return value) */
interface LensAccountInfo {
  evcAccountInfo: LensEvcAccountInfo
  vaultAccountInfo: LensVaultAccountInfo
}

const depositPositions: Ref<AccountDepositPosition[]> = ref([])
const borrowPositions: Ref<AccountBorrowPosition[]> = ref([])

// Track which (subAccount, vaultAddress) pairs are used as collateral
// Format: "subAccount:vaultAddress" (both checksummed)
const collateralUsageSet: Ref<Set<string>> = ref(new Set())

const isPositionsLoading = ref(true)
const isPositionsLoaded = ref(false)
const isDepositsLoading = ref(true)
const isDepositsLoaded = ref(false)
const isShowAllPositions = ref(false)

// Generation counter to invalidate stale in-flight position fetches after chain switch.
// Incremented on chain change; async operations capturing an older generation discard results.
const positionGeneration = ref(0)
const normalizeAddress = (value?: string | null) => {
  if (!value) {
    return ''
  }
  try {
    return getAddress(value)
  }
  catch {
    return ''
  }
}

const toBigInt = (value: unknown) => {
  try {
    return BigInt(value as bigint)
  }
  catch {
    return 0n
  }
}
const resolvePositionCollaterals = (liquidityInfo: LensLiquidityInfo, fallback: string[]) => {
  const infoCollaterals = (liquidityInfo?.collaterals || [])
    .map(addr => normalizeAddress(addr))
    .filter(Boolean)
  const values = liquidityInfo?.collateralValuesRaw
    || liquidityInfo?.collateralValuesLiquidation
    || liquidityInfo?.collateralValuesBorrowing

  if (infoCollaterals.length && Array.isArray(values) && values.length === infoCollaterals.length) {
    const withValue = infoCollaterals.filter((_: string, idx: number) => toBigInt(values[idx]) > 0n)
    if (withValue.length) {
      return withValue
    }
  }

  // Lens populated collaterals but all values are 0 (e.g. LTV ramped to 0)
  if (infoCollaterals.length) {
    return infoCollaterals
  }

  // queryFailure: lens didn't populate collaterals at all, fall back to EVC enabled list
  return fallback.map(addr => normalizeAddress(addr)).filter(Boolean)
}

/**
 * Check if a vault uses Pyth oracles and needs fresh prices.
 * Always returns true if Pyth oracles are detected, because Pyth prices
 * are only valid for ~2 minutes and require continuous updates.
 */
const hasPythOracles = (vault: Vault | SecuritizeVault): boolean => {
  if ('type' in vault && vault.type === 'securitize') return false
  const feeds = collectPythFeedIds((vault as Vault).oracleDetailedInfo)
  return feeds.length > 0
}

const totalSuppliedValue = ref(0)

const updateTotalSuppliedValue = async () => {
  const { getVault: registryGetVault } = useVaultRegistry()

  // Deposit positions (includes both standard and earn vaults)
  const depositValuePromises = depositPositions.value.map(position =>
    getAssetUsdValue(position.assets, position.vault, 'off-chain'),
  )
  const depositValues = await Promise.all(depositValuePromises)
  const depositValue = depositValues.reduce<number>((result, val) => result + (val ?? 0), 0)

  // Borrow position collateral (liability vault context) — use borrow vault's collateral pricing with USD conversion
  const collateralValuePromises = borrowPositions.value.map(async (position) => {
    const borrowVault = registryGetVault(position.borrow.address) as Vault | undefined
    if (!borrowVault) return 0
    return getCollateralUsdValueOrZero(position.supplied, borrowVault, position.collateral, 'off-chain')
  })
  const collateralValues = await Promise.all(collateralValuePromises)
  const collateralValue = collateralValues.reduce((result, val) => result + val, 0)

  totalSuppliedValue.value = depositValue + collateralValue
}

watchEffect(() => {
  // Re-run when positions change
  if (depositPositions.value.length || borrowPositions.value.length) {
    updateTotalSuppliedValue()
  }
  else {
    totalSuppliedValue.value = 0
  }
})

const totalSuppliedValueInfo = ref<{ total: number; hasMissingPrices: boolean }>({ total: 0, hasMissingPrices: false })

const updateTotalSuppliedValueInfo = async () => {
  const { getVault: registryGetVault } = useVaultRegistry()
  let total = 0
  let hasMissingPrices = false

  for (const position of depositPositions.value) {
    const price = await getAssetUsdValue(position.assets, position.vault, 'off-chain')
    if (price === undefined) {
      hasMissingPrices = true
    }
    total += price ?? 0
  }

  for (const position of borrowPositions.value) {
    const borrowVault = registryGetVault(position.borrow.address) as Vault | undefined
    if (!borrowVault) {
      if (position.supplied > 0n) hasMissingPrices = true
      continue
    }

    const value = await getCollateralUsdValue(position.supplied, borrowVault, position.collateral, 'off-chain')
    if (value === undefined) {
      hasMissingPrices = true
    }
    total += value ?? 0
  }

  totalSuppliedValueInfo.value = { total, hasMissingPrices }
}

watchEffect(() => {
  // Re-run when positions change
  if (depositPositions.value.length || borrowPositions.value.length) {
    updateTotalSuppliedValueInfo()
  }
  else {
    totalSuppliedValueInfo.value = { total: 0, hasMissingPrices: false }
  }
})

const totalBorrowedValue = ref(0)

const updateTotalBorrowedValue = async () => {
  const promises = borrowPositions.value
    .map(pair => getAssetUsdValue(pair.borrowed, pair.borrow, 'off-chain'))
  const values = await Promise.all(promises)
  totalBorrowedValue.value = values.reduce<number>((result, val) => result + (val ?? 0), 0)
}

watchEffect(() => {
  if (borrowPositions.value.length) {
    updateTotalBorrowedValue()
  }
  else {
    totalBorrowedValue.value = 0
  }
})

const totalBorrowedValueInfo = ref<{ total: number; hasMissingPrices: boolean }>({ total: 0, hasMissingPrices: false })

const updateTotalBorrowedValueInfo = async () => {
  let total = 0
  let hasMissingPrices = false

  for (const pair of borrowPositions.value) {
    const price = await getAssetUsdValue(pair.borrowed, pair.borrow, 'off-chain')
    if (price === undefined) {
      hasMissingPrices = true
    }
    total += price ?? 0
  }

  totalBorrowedValueInfo.value = { total, hasMissingPrices }
}

watchEffect(() => {
  if (borrowPositions.value.length) {
    updateTotalBorrowedValueInfo()
  }
  else {
    totalBorrowedValueInfo.value = { total: 0, hasMissingPrices: false }
  }
})

const portfolioRoe = ref(0)
const portfolioNetApy = ref(0)

const updateBorrowPositions = async (
  eulerLensAddresses: EulerLensAddresses,
  address: string,
  borrowEntries: SubgraphPositionEntry[],
  isInitialLoading = false,
  options: { forceAllPositions?: boolean } = {},
) => {
  const gen = positionGeneration.value

  if (isInitialLoading) {
    isPositionsLoaded.value = false
    isPositionsLoading.value = true
    borrowPositions.value = []
  }

  if (!address) {
    borrowPositions.value = []
    isPositionsLoading.value = false
    isPositionsLoaded.value = true
    return
  }

  const { EVM_PROVIDER_URL, PYTH_HERMES_URL } = useEulerConfig()
  const { getOrFetch } = useVaultRegistry()
  const { eulerCoreAddresses } = useEulerAddresses()
  const shouldShowAllPositions = options.forceAllPositions ?? isShowAllPositions.value
  const isAllPositionsAtStart = shouldShowAllPositions

  if (!eulerLensAddresses?.accountLens) {
    throw new Error('Euler addresses not loaded yet')
  }

  const client = getPublicClient(EVM_PROVIDER_URL)

  let borrows: AccountBorrowPosition[] = []
  const batchSize = 5

  for (let i = 0; i < borrowEntries.length; i += batchSize) {
    if (positionGeneration.value !== gen) return

    const batch = borrowEntries
      .slice(i, i + batchSize)
      .map(async (entry) => {
        const vaultAddress = entry.vault
        const subAccount = entry.subAccount

        // Pre-fetch borrow vault to check for Pyth oracles
        const borrowVault = await getOrFetch(vaultAddress) as Vault | undefined

        let res: LensAccountInfo | undefined
        try {
          // Check if vault uses Pyth oracles and we can use simulation
          const pythFeeds = borrowVault ? collectPythFeedIds(borrowVault.oracleDetailedInfo) : []
          const canUsePythSimulation = pythFeeds.length > 0
            && PYTH_HERMES_URL
            && eulerCoreAddresses.value?.evc

          if (canUsePythSimulation) {
            // Use batchSimulation with Pyth updates for fresh oracle prices
            const result = await executeLensWithPythSimulation(
              pythFeeds,
              eulerLensAddresses.accountLens as Address,
              eulerAccountLensABI as Abi,
              'getAccountInfo',
              [subAccount, vaultAddress],
              eulerCoreAddresses.value!.evc,
              EVM_PROVIDER_URL,
              PYTH_HERMES_URL!,
            ) as LensAccountInfo | undefined
            if (result) {
              res = result
            }
          }

          // Direct call: either non-Pyth vault, or Pyth simulation failed/returned nothing
          if (!res) {
            res = await client.readContract({
              address: eulerLensAddresses.accountLens as Address,
              abi: eulerAccountLensABI as Abi,
              functionName: 'getAccountInfo',
              args: [subAccount, vaultAddress],
            }) as LensAccountInfo
          }
        }
        catch (err) {
          console.warn('[updateBorrowPositions] Error fetching account info:', err)
          return undefined
        }

        if (!res || !res.evcAccountInfo.enabledControllers.length || !res.evcAccountInfo.enabledCollaterals.length || res.vaultAccountInfo.borrowed === 0n) {
          return undefined
        }

        const enabledCollateralsList = res.evcAccountInfo.enabledCollaterals.map(collateral => getAddress(collateral))
        const collaterals = resolvePositionCollaterals(res.vaultAccountInfo?.liquidityInfo, enabledCollateralsList)

        const borrowAddress = getAddress(res.evcAccountInfo.enabledControllers[0])
        // Use pre-fetched vault if it matches, otherwise fetch
        let borrow = borrowVault && borrowVault.address.toLowerCase() === borrowAddress.toLowerCase()
          ? borrowVault
          : await getOrFetch(borrowAddress) as Vault | undefined
        if (!borrow) {
          return undefined
        }

        // If borrow vault uses Pyth oracles, always fetch fresh prices
        // (Pyth prices are only valid for ~2 minutes and require continuous updates)
        if (hasPythOracles(borrow)) {
          const freshBorrow = await fetchVault(borrowAddress)
          if (freshBorrow) {
            borrow = freshBorrow
          }
        }

        let collateralAddress: string | undefined
        const collateralCandidates = collaterals.length ? collaterals : enabledCollateralsList
        for (const addr of collateralCandidates) {
          if (borrow.collateralLTVs.some(ltv => getAddress(ltv.collateral) === addr)) {
            collateralAddress = addr
            break
          }
        }

        if (!collateralAddress) {
          collateralAddress = collateralCandidates[0]
        }

        if (!collateralAddress) {
          return undefined
        }

        // Use unified resolution for collateral vault (handles EVK, escrow, and securitize)
        // Note: Collateral PRICES come from borrow.collateralPrices[], which are already
        // refreshed when we fetch the borrow vault with Pyth simulation above.
        // The collateral vault only provides totalAssets/totalShares for share→asset conversion.
        const collateral = await getOrFetch(collateralAddress) as Vault | SecuritizeVault | undefined

        if (!collateral) {
          return undefined
        }

        // Skip positions where both vaults are unverified (unless showing all positions)
        if (!shouldShowAllPositions && !borrow.verified && !collateral.verified) {
          return undefined
        }

        // Fetch actual collateral balance — doesn't depend on the oracle
        let suppliedAssets = 0n
        try {
          const collateralRes = await client.readContract({
            address: eulerLensAddresses.accountLens as Address,
            abi: eulerAccountLensABI as Abi,
            functionName: 'getVaultAccountInfo',
            args: [subAccount, collateralAddress],
          }) as LensVaultAccountInfo
          suppliedAssets = toBigInt(collateralRes.assets)
        }
        catch {
          // Collateral amount unavailable
        }

        const liquidityInfo = res.vaultAccountInfo.liquidityInfo
        const hasQueryFailure = Boolean(liquidityInfo.queryFailure)

        if (hasQueryFailure) {
          // LTV config comes from vault governance, not oracle
          const ltvConfig = borrow.collateralLTVs.find(ltv =>
            getAddress(ltv.collateral) === getAddress(collateral.address),
          )

          return {
            borrow,
            collateral,
            collaterals,
            subAccount,
            borrowed: res.vaultAccountInfo.borrowed,
            supplied: suppliedAssets,
            borrowLTV: ltvConfig?.borrowLTV ?? 0n,
            liquidationLTV: ltvConfig?.liquidationLTV ?? 0n,
            // Oracle-dependent fields — genuinely unavailable
            health: 0n,
            userLTV: 0n,
            price: 0n,
            liabilityValueBorrowing: 0n,
            liabilityValueLiquidation: 0n,
            timeToLiquidation: 0n,
            collateralValueLiquidation: 0n,
            liquidityQueryFailure: true,
          } as AccountBorrowPosition
        }

        const collateralValueLiquidation = liquidityInfo.collateralValueLiquidation
        const collateralValueRaw = liquidityInfo.collateralValueRaw
        let liabilityValueBorrowing = liquidityInfo.liabilityValueBorrowing

        // Compute effective LTVs from aggregates (handles multi-collateral correctly)
        const liquidationLTV = collateralValueRaw > 0n
          ? collateralValueLiquidation * 10000n / collateralValueRaw
          : 0n
        const effectiveBorrowLTV = collateralValueRaw > 0n
          ? liquidityInfo.collateralValueBorrowing * 10000n / collateralValueRaw
          : 0n

        if (liabilityValueBorrowing === 0n && res.vaultAccountInfo.borrowed > 0n) {
          console.warn('liabilityValueBorrowing is 0 but borrowed amount exists, calculating manually')
          const borrowedInUnitOfAccount = FixedPoint.fromValue(res.vaultAccountInfo.borrowed, borrow.decimals)
            .mul(FixedPoint.fromValue(borrow.liabilityPriceInfo.amountOutMid, 18))
            .div(FixedPoint.fromValue(borrow.liabilityPriceInfo.amountIn, 0))
          liabilityValueBorrowing = borrowedInUnitOfAccount.value
        }
        const healthFixed = liabilityValueBorrowing === 0n
          ? FixedPoint.fromValue(0n, 18)
          : FixedPoint.fromValue(collateralValueLiquidation, 18).div(FixedPoint.fromValue(liabilityValueBorrowing, 18))

        const userLTVFixed = healthFixed.isZero()
          ? FixedPoint.fromValue(0n, 18)
          : FixedPoint.fromValue(liquidationLTV * (10n ** 16n), 18).div(healthFixed)
        const userLTV = userLTVFixed.value

        // Get collateral price in USD for liquidation price calculation
        const collateralPriceUsd = await getCollateralUsdPrice(borrow, collateral, 'off-chain')

        // Guard against missing price
        if (!collateralPriceUsd) {
          return undefined
        }

        const supplyLiquidationPriceRatio = collateralValueLiquidation === 0n
          ? FixedPoint.fromValue(0n, 18)
          : FixedPoint.fromValue(liabilityValueBorrowing, 18)
              .div(FixedPoint.fromValue(collateralValueLiquidation, 18))

        // Use USD price for display (already converted from UoA)
        const currentCollateralPriceUsd = FixedPoint.fromValue(collateralPriceUsd.amountOutMid, 18)

        const price = currentCollateralPriceUsd.mul(supplyLiquidationPriceRatio).value

        return {
          borrow,
          collateral,
          collaterals,
          subAccount,
          borrowLTV: effectiveBorrowLTV,
          timeToLiquidation: liquidityInfo.timeToLiquidation,
          health: healthFixed.value,
          borrowed: res.vaultAccountInfo.borrowed,
          price,
          userLTV,
          supplied: suppliedAssets,
          liabilityValueBorrowing,
          liabilityValueLiquidation: liquidityInfo.liabilityValueLiquidation,
          liquidationLTV,
          collateralValueLiquidation,
        } as AccountBorrowPosition
      })

    const batchResults = await Promise.all(batch)
    const validResults = batchResults.filter(o => !!o) as AccountBorrowPosition[]
    borrows = [...borrows, ...validResults]
  }
  // Discard results if chain switched during fetch
  if (positionGeneration.value !== gen) return

  const collateralPositions: AccountBorrowPosition[] = []
  const shouldUpdate = options.forceAllPositions !== undefined
    ? true
    : isShowAllPositions.value === isAllPositionsAtStart
  if (shouldUpdate) {
    const allPositions = [...borrows, ...collateralPositions]
    borrowPositions.value = allPositions

    // Build set of (subAccount, collateralVault) pairs used as collateral
    const usageSet = new Set<string>()
    for (const pos of allPositions) {
      const subAccount = getAddress(pos.subAccount)
      const collateralAddress = getAddress(pos.collateral.address)
      usageSet.add(`${subAccount}:${collateralAddress}`)
    }
    collateralUsageSet.value = usageSet

    isPositionsLoading.value = false
    isPositionsLoaded.value = true
  }
}
const updateSavingsPositions = async (
  eulerLensAddresses: EulerLensAddresses,
  address: string,
  depositEntries: SubgraphPositionEntry[],
  isInitialLoading = false,
  options: { forceAllPositions?: boolean } = {},
  generation?: number,
) => {
  const gen = generation ?? positionGeneration.value

  if (isInitialLoading) {
    isDepositsLoaded.value = false
    isDepositsLoading.value = true
    depositPositions.value = []
  }

  if (!address) {
    isDepositsLoaded.value = false
    isDepositsLoading.value = true
    depositPositions.value = []
    return
  }

  const { getOrFetch, getType: registryGetType } = useVaultRegistry()
  const { EVM_PROVIDER_URL } = useEulerConfig()

  const shouldShowAllPositions = options.forceAllPositions ?? isShowAllPositions.value
  const isAllPositionsAtStart = shouldShowAllPositions

  if (!eulerLensAddresses?.accountLens) {
    throw new Error('Euler addresses not loaded yet')
  }

  const client = getPublicClient(EVM_PROVIDER_URL)

  let deposits: AccountDepositPosition[] = []

  // Process entries in batches of 5
  const batchSize = 5
  for (let i = 0; i < depositEntries.length; i += batchSize) {
    if (positionGeneration.value !== gen) return

    const batch = depositEntries
      .slice(i, i + batchSize)
      .map(async (entry) => {
        const vaultAddress = entry.vault
        const subAccount = entry.subAccount

        // Check if this deposit is being used as collateral
        const collateralKey = `${subAccount}:${vaultAddress}`
        if (collateralUsageSet.value.has(collateralKey)) {
          return undefined
        }

        // Resolve vault from registry
        const vault = await getOrFetch(vaultAddress)
        if (!vault) return undefined

        // Skip unverified vaults unless showing all positions
        if (!shouldShowAllPositions && !vault.verified) {
          return undefined
        }

        try {
          const res = await client.readContract({
            address: eulerLensAddresses.accountLens as Address,
            abi: eulerAccountLensABI as Abi,
            functionName: 'getAccountInfo',
            args: [subAccount, vaultAddress],
          }) as LensAccountInfo

          // Only include if there are shares
          if (res.vaultAccountInfo.shares === 0n) {
            return undefined
          }

          return {
            vault,
            subAccount,
            shares: res.vaultAccountInfo.shares,
            assets: res.vaultAccountInfo.assets,
          } as AccountDepositPosition
        }
        catch (e) {
          console.warn(`Failed to fetch vault ${vaultAddress}:`, e)
          return undefined
        }
      })
    const results = (await Promise.all(batch)).filter((o): o is AccountDepositPosition => !!o)
    deposits = [...deposits, ...results]
  }

  // Discard results if chain switched during fetch
  if (positionGeneration.value !== gen) return

  const shouldUpdate = options.forceAllPositions !== undefined
    ? true
    : isShowAllPositions.value === isAllPositionsAtStart
  if (shouldUpdate) {
    depositPositions.value = deposits
    isDepositsLoading.value = false
    isDepositsLoaded.value = true
  }
}

export const useEulerAccount = () => {
  const { isLoaded: isBalancesLoaded } = useWallets()
  const { eulerLensAddresses, isReady: isEulerLensAddressesReady, chainId } = useEulerAddresses()
  const { address } = useAccount()
  const { public: { debugPortfolioAddress } } = useRuntimeConfig()
  const normalizedDebugAddress = computed(() => normalizeAddress(debugPortfolioAddress as string | undefined))
  const portfolioAddress = computed(() => normalizedDebugAddress.value || normalizeAddress(address.value))
  const isDebugPortfolio = computed(() => Boolean(normalizedDebugAddress.value))

  const updatePositions = async () => {
    const gen = positionGeneration.value
    const targetAddress = portfolioAddress.value
    const shouldShowAll = isShowAllPositions.value || isDebugPortfolio.value
    const { SUBGRAPH_URL } = useEulerConfig()

    // Fetch both borrow and deposit entries in a single subgraph query
    const { borrows: borrowEntries, deposits: depositEntries } = targetAddress
      ? await fetchAccountPositions(SUBGRAPH_URL, targetAddress)
      : { borrows: [] as SubgraphPositionEntry[], deposits: [] as SubgraphPositionEntry[] }

    // Discard if chain switched during subgraph fetch
    if (positionGeneration.value !== gen) return

    // Borrow positions must be loaded first so deposits can filter against them
    await updateBorrowPositions(
      eulerLensAddresses.value,
      targetAddress,
      borrowEntries,
      false,
      { forceAllPositions: shouldShowAll },
    )
    await updateSavingsPositions(
      eulerLensAddresses.value,
      targetAddress,
      depositEntries,
      false,
      { forceAllPositions: shouldShowAll },
      gen,
    )
  }

  watch([isBalancesLoaded, isEulerLensAddressesReady], async () => {
    if (isBalancesLoaded.value && isEulerLensAddressesReady.value) {
      updatePositions()
    }
  }, { immediate: true })

  watch(isShowAllPositions, () => {
    updatePositions()
  })

  // Refresh positions when wallet address changes
  watch(portfolioAddress, (newAddress, oldAddress) => {
    if (newAddress !== oldAddress && isBalancesLoaded.value && isEulerLensAddressesReady.value) {
      updatePositions()
    }
  })

  // Portfolio ROE calculation — composables must be called in setup context
  const { withIntrinsicBorrowApy, withIntrinsicSupplyApy, version: intrinsicVersion } = useIntrinsicApy()
  const { getSupplyRewardApy, getBorrowRewardApy, version: rewardsVersion } = useRewardsApy()

  const computePortfolioRoe = async () => {
    const { getVault: registryGetVault } = useVaultRegistry()

    let totalNetYield = 0
    let totalEquity = 0
    let totalSupplyUSD = 0

    for (const position of borrowPositions.value) {
      const registryVault = registryGetVault(position.borrow.address) as Vault | undefined
      const borrowVault = registryVault || position.borrow

      const supplyUSD = await getCollateralUsdValueOrZero(position.supplied, borrowVault, position.collateral, 'off-chain')
      const borrowUSD = (await getAssetUsdValue(position.borrowed, borrowVault, 'off-chain')) ?? 0

      const supplyApy = withIntrinsicSupplyApy(
        nanoToValue(position.collateral.interestRateInfo?.supplyAPY || 0n, 25),
        position.collateral.asset.symbol,
      )
      const borrowApy = withIntrinsicBorrowApy(
        nanoToValue(position.borrow.interestRateInfo.borrowAPY, 25),
        position.borrow.asset.symbol,
      )

      const supplyRewardAPY = getSupplyRewardApy(position.collateral.address)
      const borrowRewardAPY = getBorrowRewardApy(position.borrow.address, position.collateral.address)

      const netYield
        = supplyUSD * (supplyApy + supplyRewardAPY)
          - borrowUSD * (borrowApy - borrowRewardAPY)
      const equity = supplyUSD - borrowUSD

      totalNetYield += netYield
      totalEquity += equity
      totalSupplyUSD += supplyUSD
    }

    portfolioRoe.value = totalEquity > 0 ? totalNetYield / totalEquity : 0
    portfolioNetApy.value = totalSupplyUSD > 0 ? totalNetYield / totalSupplyUSD : 0
  }

  watchEffect(() => {
    const _supplyTotal = totalSuppliedValueInfo.value.total
    const _borrowTotal = totalBorrowedValueInfo.value.total
    void rewardsVersion.value
    void intrinsicVersion.value
    if (borrowPositions.value.length) {
      computePortfolioRoe()
    }
    else {
      portfolioRoe.value = 0
      portfolioNetApy.value = 0
    }
  })

  // Clear stale positions and invalidate in-flight fetches on chain change
  watch(chainId, () => {
    positionGeneration.value++
    borrowPositions.value = []
    depositPositions.value = []
    collateralUsageSet.value = new Set()
    isPositionsLoaded.value = false
    isPositionsLoading.value = true
    isDepositsLoaded.value = false
    isDepositsLoading.value = true
    totalSuppliedValue.value = 0
    totalBorrowedValue.value = 0
  })

  /**
   * Find a borrow position by its subaccount index.
   * The subaccount index is derived from: ownerAddress XOR subAccountAddress
   */
  const getPositionBySubAccountIndex = (subAccountIndex: number): AccountBorrowPosition | undefined => {
    const owner = portfolioAddress.value || address.value
    if (!owner) return undefined
    
    return borrowPositions.value.find((position) => {
      try {
        const ownerBigInt = BigInt(getAddress(owner))
        const subAccountBigInt = BigInt(getAddress(position.subAccount))
        const index = Number(ownerBigInt ^ subAccountBigInt)
        return index === subAccountIndex
      }
      catch {
        return false
      }
    })
  }

  /**
   * Refresh all positions (borrows + savings) by fetching entries from subgraph.
   * Used by portfolio page for periodic refresh.
   */
  const refreshAllPositions = async (
    lensAddresses: EulerLensAddresses,
    walletAddress: string,
  ) => {
    const gen = positionGeneration.value
    const { SUBGRAPH_URL } = useEulerConfig()
    const { borrows: borrowEntries, deposits: depositEntries } = walletAddress
      ? await fetchAccountPositions(SUBGRAPH_URL, walletAddress)
      : { borrows: [] as SubgraphPositionEntry[], deposits: [] as SubgraphPositionEntry[] }

    if (positionGeneration.value !== gen) return

    await updateBorrowPositions(lensAddresses, walletAddress, borrowEntries)
    await updateSavingsPositions(lensAddresses, walletAddress, depositEntries, false, {}, gen)
  }

  return {
    borrowPositions,
    depositPositions,
    isPositionsLoading,
    isPositionsLoaded,
    isDepositsLoading,
    isDepositsLoaded,
    isShowAllPositions,
    portfolioAddress,
    isDebugPortfolio,
    refreshAllPositions,
    getPositionBySubAccountIndex,
    totalSuppliedValue,
    totalSuppliedValueInfo,
    totalBorrowedValue,
    totalBorrowedValueInfo,
    portfolioRoe,
    portfolioNetApy,
  }
}
