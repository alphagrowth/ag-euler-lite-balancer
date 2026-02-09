import { getAddress, type Address, type Abi } from 'viem'
import { FixedPoint } from '~/utils/fixed-point'
import { getPublicClient } from '~/utils/public-client'
import axios from 'axios'
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
  getAssetOraclePrice,
  getCollateralOraclePrice,
  getCollateralUsdPrice,
  getCollateralUsdValue,
  getCollateralUsdValueOrZero,
} from '~/services/pricing/priceProvider'
import { nanoToValue } from '~/utils/crypto-utils'
import { collectPythFeedIds } from '~/entities/oracle'
import { executeLensWithPythSimulation } from '~/utils/pyth'

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

// Helper to get address prefix for simple subgraph queries (first 19 bytes = 0x + 38 hex chars)
const getAddressPrefix = (address: string) => address.toLowerCase().slice(0, 40)

const toBigInt = (value: unknown) => {
  try {
    return BigInt(value as bigint)
  }
  catch {
    return 0n
  }
}
const resolvePositionCollaterals = (liquidityInfo: Record<string, unknown>, fallback: string[]) => {
  const infoCollaterals = (liquidityInfo?.collaterals || [])
    .map((addr: string) => normalizeAddress(addr))
    .filter(Boolean)
  const values = liquidityInfo?.collateralValuesRaw
    || liquidityInfo?.collateralValuesLiquidation
    || liquidityInfo?.collateralValuesBorrowing

  if (infoCollaterals.length && Array.isArray(values) && values.length === infoCollaterals.length) {
    const withValue = infoCollaterals.filter((_, idx) => toBigInt(values[idx]) > 0n)
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
const hasPythOracles = (vault: Vault): boolean => {
  const feeds = collectPythFeedIds(vault.oracleDetailedInfo)
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
    if (position.liquidityQueryFailure) return 0
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
    if (position.liquidityQueryFailure) {
      hasMissingPrices = true
      continue
    }

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
    .filter(pair => !pair.liquidityQueryFailure)
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
    if (pair.liquidityQueryFailure) {
      hasMissingPrices = true
      continue
    }
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
  isInitialLoading = false,
  options: { forceAllPositions?: boolean } = {},
) => {
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

  const { EVM_PROVIDER_URL, SUBGRAPH_URL, PYTH_HERMES_URL } = useEulerConfig()
  const { getOrFetch } = useVaultRegistry()
  const { eulerCoreAddresses } = useEulerAddresses()
  const shouldShowAllPositions = options.forceAllPositions ?? isShowAllPositions.value
  const isAllPositionsAtStart = shouldShowAllPositions

  if (!eulerLensAddresses?.accountLens) {
    throw new Error('Euler addresses not loaded yet')
  }

  const client = getPublicClient(EVM_PROVIDER_URL)

  const { data } = await axios.post(SUBGRAPH_URL, {
    query: `query AccountBorrows {
      trackingActiveAccount(id: "${getAddressPrefix(address)}") {
        borrows
      }
    }`,
    operationName: 'AccountBorrows',
  })
  const borrowEntries = data.data.trackingActiveAccount?.borrows || []

  let borrows: AccountBorrowPosition[] = []
  const batchSize = 5

  for (let i = 0; i < borrowEntries.length; i += batchSize) {
    const batch = borrowEntries
      .slice(i, i + batchSize)
      .map(async (entry: string) => {
        const vaultAddress = `0x${entry.substring(42)}`
        const subAccount = entry.substring(0, 42)

        // Pre-fetch borrow vault to check for Pyth oracles
        const borrowVault = await getOrFetch(vaultAddress) as Vault | undefined

        let res
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
            ) as Record<string, unknown> | undefined
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
            }) as Record<string, unknown>
          }
        }
        catch (err) {
          console.warn('[updateBorrowPositions] Error fetching account info:', err)
          return undefined
        }

        if (!res.evcAccountInfo.enabledControllers.length || !res.evcAccountInfo.enabledCollaterals.length || res.vaultAccountInfo.borrowed === 0n) {
          return undefined
        }

        const enabledCollateralsList = res.evcAccountInfo.enabledCollaterals.map((collateral: string) => getAddress(collateral))
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
        const collateral = await getOrFetch(collateralAddress) as Vault | undefined

        if (!collateral) {
          return undefined
        }

        // Skip positions where both vaults are unverified (unless showing all positions)
        if (!shouldShowAllPositions && !borrow.verified && !collateral.verified) {
          return undefined
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
            // Collateral amount will be fetched by UI via loadCollaterals
            supplied: 0n,
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
          ? FixedPoint.fromValue(0n, 2)
          : FixedPoint.fromValue(liquidationLTV, 2).div(healthFixed)
        const userLTV = userLTVFixed.value

        // Get collateral price in UoA for ratio calculation (UoA cancels in ratio)
        const collateralPriceUoA = getCollateralOraclePrice(borrow, collateral)
        const borrowPriceUoA = getAssetOraclePrice(borrow)

        // Get collateral price in USD for display (off-chain for display purposes)
        const collateralPriceUsd = await getCollateralUsdPrice(borrow, collateral, 'off-chain')

        // Guard against missing price
        if (!collateralPriceUoA || !borrowPriceUoA || !collateralPriceUsd) {
          return undefined
        }

        // Price ratio calculation uses UoA prices (UoA cancels)
        const priceFixed = FixedPoint.fromValue(collateralPriceUoA.amountOutAsk, 18)
          .div(FixedPoint.fromValue(borrowPriceUoA.amountOutBid || 1n, 18))

        const supplyLiquidationPriceRatio = collateralValueLiquidation === 0n
          ? FixedPoint.fromValue(0n, 18)
          : FixedPoint.fromValue(liabilityValueBorrowing, 18)
              .sub(FixedPoint.fromValue(collateralValueLiquidation, 18))
              .div(FixedPoint.fromValue(collateralValueLiquidation, 18))
              .add(FixedPoint.fromValue(1n, 0))

        // Use USD price for display (already converted from UoA)
        const currentCollateralPriceUsd = FixedPoint.fromValue(collateralPriceUsd.amountOutMid, 18)

        const price = currentCollateralPriceUsd.mul(supplyLiquidationPriceRatio).value

        const borrowedFixed = FixedPoint.fromValue(
          res.vaultAccountInfo.borrowed,
          borrow.decimals,
        )
        const userLTVPercent = userLTVFixed.div(FixedPoint.fromValue(100n, 0))
        const supplied = userLTVPercent.isZero()
          ? 0n
          : borrowedFixed
            .div(userLTVPercent)
            .div(priceFixed).round(Number(collateral.decimals))
            .toFormat({ decimals: Number(collateral.decimals) }).value

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
          supplied,
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
  isInitialLoading = false,
  options: { forceAllPositions?: boolean } = {},
) => {
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
  const { SUBGRAPH_URL, EVM_PROVIDER_URL } = useEulerConfig()

  const shouldShowAllPositions = options.forceAllPositions ?? isShowAllPositions.value
  const isAllPositionsAtStart = shouldShowAllPositions

  if (!eulerLensAddresses?.accountLens) {
    throw new Error('Euler addresses not loaded yet')
  }

  const client = getPublicClient(EVM_PROVIDER_URL)

  // Single subgraph query for ALL deposits
  const { data } = await axios.post(SUBGRAPH_URL, {
    query: `query AccountDeposits {
      trackingActiveAccount(id: "${getAddressPrefix(address)}") {
        deposits
      }
    }`,
    operationName: 'AccountDeposits',
  })
  const depositEntries: string[] = data.data.trackingActiveAccount?.deposits || []

  let deposits: AccountDepositPosition[] = []

  // Process entries in batches of 5
  const batchSize = 5
  for (let i = 0; i < depositEntries.length; i += batchSize) {
    const batch = depositEntries
      .slice(i, i + batchSize)
      .map(async (entry: string) => {
        const vaultAddress = getAddress(`0x${entry.substring(42)}`)
        const subAccount = getAddress(entry.substring(0, 42))

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
          }) as Record<string, unknown>

          // Only include if there are shares
          if ((res as any).vaultAccountInfo.shares === 0n) {
            return undefined
          }

          return {
            vault,
            subAccount,
            shares: (res as any).vaultAccountInfo.shares,
            assets: (res as any).vaultAccountInfo.assets,
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
  const normalizedDebugAddress = computed(() => normalizeAddress(debugPortfolioAddress))
  const portfolioAddress = computed(() => normalizedDebugAddress.value || normalizeAddress(address.value))
  const isDebugPortfolio = computed(() => Boolean(normalizedDebugAddress.value))

  const updatePositions = async () => {
    const targetAddress = portfolioAddress.value
    const shouldShowAll = isShowAllPositions.value || isDebugPortfolio.value
    // Borrow positions must be loaded first so deposits can filter against them
    await updateBorrowPositions(
      eulerLensAddresses.value,
      targetAddress,
      false,
      { forceAllPositions: shouldShowAll },
    )
    updateSavingsPositions(
      eulerLensAddresses.value,
      targetAddress,
      false,
      { forceAllPositions: shouldShowAll },
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
  const { getOpportunityOfBorrowVault, getOpportunityOfLendVault } = useMerkl()
  const { withIntrinsicBorrowApy, withIntrinsicSupplyApy } = useIntrinsicApy()

  const computePortfolioRoe = async () => {
    const { getVault: registryGetVault } = useVaultRegistry()

    let totalNetYield = 0
    let totalEquity = 0
    let totalSupplyUSD = 0

    for (const position of borrowPositions.value) {
      if (position.liquidityQueryFailure) continue

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

      const supplyRewardAPY = getOpportunityOfLendVault(position.collateral.address)?.apr || 0
      const borrowRewardAPY = getOpportunityOfBorrowVault(position.borrow.asset.address)?.apr || 0

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
    if (borrowPositions.value.length) {
      computePortfolioRoe()
    }
    else {
      portfolioRoe.value = 0
      portfolioNetApy.value = 0
    }
  })

  // Clear stale positions immediately on chain change
  watch(chainId, () => {
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
    updateBorrowPositions,
    updateSavingsPositions,
    getPositionBySubAccountIndex,
    totalSuppliedValue,
    totalSuppliedValueInfo,
    totalBorrowedValue,
    totalBorrowedValueInfo,
    portfolioRoe,
    portfolioNetApy,
  }
}
