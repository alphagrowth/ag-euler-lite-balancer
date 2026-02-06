import { ethers, FixedNumber } from 'ethers'
import axios from 'axios'
import { ref, watch, watchEffect, computed, type Ref } from 'vue'
import { useAccount } from '@wagmi/vue'
import { useVaultRegistry } from './useVaultRegistry'
import { eulerAccountLensABI } from '~/entities/euler/abis'
import type { EulerLensAddresses } from '~/composables/useEulerAddresses'
import type {
  AccountBorrowPosition, AccountDepositPosition,
  AccountEarnPosition,
} from '~/entities/account'
import {
  convertSharesToAssets,
  fetchVault,
  type Vault,
  type SecuritizeVault,
} from '~/entities/vault'
import {
  getAssetUsdValue,
  getAssetOraclePrice,
  getCollateralOraclePrice,
  getCollateralUsdPrice,
  getCollateralUsdValue,
} from '~/services/pricing/priceProvider'
import { nanoToValue } from '~/utils/crypto-utils'
import { collectPythFeedIds } from '~/entities/oracle'
import { executeLensWithPythSimulation } from '~/utils/pyth'

const depositPositions: Ref<AccountDepositPosition[]> = ref([])
const earnPositions: Ref<AccountEarnPosition[]> = ref([])
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
    return ethers.getAddress(value)
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
const resolvePositionCollaterals = (liquidityInfo: Record<string, unknown>) => {
  const collaterals = (liquidityInfo?.collaterals || [])
    .map((addr: string) => normalizeAddress(addr))
    .filter(Boolean)
  const values = liquidityInfo?.collateralValuesRaw
    || liquidityInfo?.collateralValuesLiquidation
    || liquidityInfo?.collateralValuesBorrowing

  if (collaterals.length && Array.isArray(values) && values.length === collaterals.length) {
    const withValue = collaterals.filter((_, idx) => toBigInt(values[idx]) > 0n)
    if (withValue.length) {
      return withValue
    }
  }

  return collaterals
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

  // Deposit positions (standalone vault context) — only vaults with price info
  const depositValuePromises = depositPositions.value
    .filter(position => 'liabilityPriceInfo' in position.vault)
    .map(position => getAssetUsdValue(position.assets, position.vault as Vault, 'off-chain'))
  const depositValues = await Promise.all(depositValuePromises)
  const depositValue = depositValues.reduce((result, val) => result + val, 0)

  // Borrow position collateral (liability vault context) — use borrow vault's collateral pricing with USD conversion
  const collateralValuePromises = borrowPositions.value.map(async (position) => {
    const borrowVault = registryGetVault(position.borrow.address) as Vault | undefined
    if (!borrowVault) return 0
    return getCollateralUsdValue(position.supplied, borrowVault, position.collateral, 'off-chain')
  })
  const collateralValues = await Promise.all(collateralValuePromises)
  const collateralValue = collateralValues.reduce((result, val) => result + val, 0)

  // Earn positions — use earn vault's asset price
  const earnValuePromises = earnPositions.value.map(position =>
    getAssetUsdValue(position.assets, position.vault, 'off-chain'),
  )
  const earnValues = await Promise.all(earnValuePromises)
  const earnValue = earnValues.reduce((result, val) => result + val, 0)

  totalSuppliedValue.value = depositValue + collateralValue + earnValue
}

watchEffect(() => {
  // Re-run when positions change
  if (depositPositions.value.length || borrowPositions.value.length || earnPositions.value.length) {
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
    if (price === 0 && position.assets > 0n) {
      hasMissingPrices = true
    }
    total += price
  }

  for (const position of borrowPositions.value) {
    const borrowVault = registryGetVault(position.borrow.address) as Vault | undefined
    if (!borrowVault) {
      if (position.supplied > 0n) hasMissingPrices = true
      continue
    }

    const value = await getCollateralUsdValue(position.supplied, borrowVault, position.collateral, 'off-chain')
    if (value === 0 && position.supplied > 0n) {
      hasMissingPrices = true
    }
    total += value
  }

  for (const position of earnPositions.value) {
    const price = await getAssetUsdValue(position.assets, position.vault, 'off-chain')
    if (price === 0 && position.assets > 0n) {
      hasMissingPrices = true
    }
    total += price
  }

  totalSuppliedValueInfo.value = { total, hasMissingPrices }
}

watchEffect(() => {
  // Re-run when positions change
  if (depositPositions.value.length || borrowPositions.value.length || earnPositions.value.length) {
    updateTotalSuppliedValueInfo()
  }
  else {
    totalSuppliedValueInfo.value = { total: 0, hasMissingPrices: false }
  }
})

const totalBorrowedValue = ref(0)

const updateTotalBorrowedValue = async () => {
  const promises = borrowPositions.value.map(pair =>
    getAssetUsdValue(pair.borrowed, pair.borrow, 'off-chain'),
  )
  const values = await Promise.all(promises)
  totalBorrowedValue.value = values.reduce((result, val) => result + val, 0)
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
    if (price === 0 && pair.borrowed > 0n) {
      hasMissingPrices = true
    }
    total += price
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

  const provider = new ethers.JsonRpcProvider(EVM_PROVIDER_URL)
  const accountLensContract = new ethers.Contract(eulerLensAddresses.accountLens, eulerAccountLensABI, provider)

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
              accountLensContract,
              'getVaultAccountInfo',
              [subAccount, vaultAddress],
              eulerCoreAddresses.value!.evc,
              provider,
              EVM_PROVIDER_URL,
              PYTH_HERMES_URL!,
            ) as Record<string, unknown>[] | undefined
            // Result is decoded tuple - first element is the account info struct
            if (!result || !result[0]) {
              return undefined
            }
            res = result[0] as Record<string, unknown>
          }
          else {
            // Direct call for non-Pyth vaults
            res = await accountLensContract.getVaultAccountInfo(subAccount, vaultAddress)
          }
        }
        catch (err) {
          console.warn('[updateBorrowPositions] Error fetching account info:', err)
          return undefined
        }

        if (!res.isController || res.borrowed === 0n) {
          return undefined
        }

        const collaterals = resolvePositionCollaterals(res.liquidityInfo)

        const borrowAddress = ethers.getAddress(vaultAddress)
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
        const collateralCandidates = collaterals
        for (const addr of collateralCandidates) {
          if (borrow.collateralLTVs.some(ltv => ethers.getAddress(ltv.collateral) === addr)) {
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

        const liquidityInfo = res.liquidityInfo

        const collateralValueLiquidation = liquidityInfo.collateralValueLiquidation
        const collateralValueRaw = liquidityInfo.collateralValueRaw
        let liabilityValue = liquidityInfo.liabilityValueBorrowing

        // Compute effective LTVs from aggregates (handles multi-collateral correctly)
        const liquidationLTV = collateralValueRaw > 0n
          ? collateralValueLiquidation * 10000n / collateralValueRaw
          : 0n
        const effectiveBorrowLTV = collateralValueRaw > 0n
          ? liquidityInfo.collateralValueBorrowing * 10000n / collateralValueRaw
          : 0n

        if (liabilityValue === 0n && res.borrowed > 0n) {
          console.warn('liabilityValue is 0 but borrowed amount exists, calculating manually')
          const borrowedInUnitOfAccount = FixedNumber.fromValue(res.borrowed, borrow.decimals)
            .mul(FixedNumber.fromValue(borrow.liabilityPriceInfo.amountOutMid, 18))
            .div(FixedNumber.fromValue(borrow.liabilityPriceInfo.amountIn, 0))
          liabilityValue = borrowedInUnitOfAccount.value
        }
        const healthFixed = liabilityValue === 0n
          ? FixedNumber.fromValue(0n, 18)
          : FixedNumber.fromValue(collateralValueLiquidation, 18).div(FixedNumber.fromValue(liabilityValue, 18))

        const userLTVFixed = healthFixed.isZero()
          ? FixedNumber.fromValue(0n, 2)
          : FixedNumber.fromValue(liquidationLTV, 2).div(healthFixed)
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
        const priceFixed = FixedNumber.fromValue(collateralPriceUoA.amountOutAsk, 18)
          .div(FixedNumber.fromValue(borrowPriceUoA.amountOutBid || 1n, 18))

        const supplyLiquidationPriceRatio = collateralValueLiquidation === 0n
          ? FixedNumber.fromValue(0n, 18)
          : FixedNumber.fromValue(liabilityValue, 18)
              .sub(FixedNumber.fromValue(collateralValueLiquidation, 18))
              .div(FixedNumber.fromValue(collateralValueLiquidation, 18))
              .add(FixedNumber.fromValue(1n, 0))

        // Use USD price for display (already converted from UoA)
        const currentCollateralPriceUsd = FixedNumber.fromValue(collateralPriceUsd.amountOutMid, 18)

        const price = currentCollateralPriceUsd.mul(supplyLiquidationPriceRatio).value

        const borrowedFixed = FixedNumber.fromValue(
          res.borrowed,
          borrow.decimals,
        )
        const userLTVPercent = userLTVFixed.div(FixedNumber.fromValue(100n))
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
          liabilityLTV: 0n,
          borrowLTV: effectiveBorrowLTV,
          initialLiquidationLTV: liquidationLTV,
          timeToLiquidation: liquidityInfo.timeToLiquidation,
          health: healthFixed.value,
          borrowed: res.borrowed,
          price,
          userLTV,
          supplied,
          liabilityValue,
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
      const subAccount = ethers.getAddress(pos.subAccount)
      const collateralAddress = ethers.getAddress(pos.collateral.address)
      usageSet.add(`${subAccount}:${collateralAddress}`)
    }
    collateralUsageSet.value = usageSet

    isPositionsLoading.value = false
    isPositionsLoaded.value = true
  }
}
const updateDepositPositions = async (
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

  const { earnVaults } = useEulerLabels()
  const { getOrFetch, has: registryHas, getType: registryGetType } = useVaultRegistry()
  const { SUBGRAPH_URL, EVM_PROVIDER_URL } = useEulerConfig()

  const shouldShowAllPositions = options.forceAllPositions ?? isShowAllPositions.value
  const isAllPositionsAtStart = shouldShowAllPositions
  let deposits: AccountDepositPosition[] = []

    if (!eulerLensAddresses?.accountLens) {
      throw new Error('Euler addresses not loaded yet')
    }

    const provider = ethers.getDefaultProvider(EVM_PROVIDER_URL)
    const accountLensContract = new ethers.Contract(eulerLensAddresses.accountLens, eulerAccountLensABI, provider)

  // Fetch ALL deposits from subgraph for this address prefix
    const { data } = await axios.post(SUBGRAPH_URL, {
      query: `query AccountDeposits {
      trackingActiveAccount(id: "${getAddressPrefix(address)}") {
        deposits
      }
    }`,
      operationName: 'AccountDeposits',
    })
    const depositEntries = data.data.trackingActiveAccount?.deposits || []

  for (const entry of depositEntries) {
          const vaultAddress = `0x${entry.substring(42)}`
          const subAccount = entry.substring(0, 42)

    // Normalize addresses for comparison
    const normalizedSubAccount = ethers.getAddress(subAccount)
    const normalizedVaultAddress = ethers.getAddress(vaultAddress)

    // Check if this deposit is being used as collateral (built during borrow position loading)
    const collateralKey = `${normalizedSubAccount}:${normalizedVaultAddress}`
    if (collateralUsageSet.value.has(collateralKey)) {
      // This deposit is collateral, not savings - skip
      continue
          }

          // Skip earn vaults (handled by updateEarnPositions)
    if (earnVaults.value.includes(normalizedVaultAddress) || registryGetType(normalizedVaultAddress) === 'earn') {
      continue
    }

          // Resolve vault from registry
          const vault = await getOrFetch(vaultAddress)
          if (!vault) continue

          // Skip earn vaults (getOrFetch caches in registry, so getType works)
          const vaultType = registryGetType(vaultAddress)
          if (vaultType === 'earn') continue

    const isVerifiedVault = vaultType === 'evk'
      ? (vault as Vault).verified
      : vaultType === 'securitize'
        ? (vault as SecuritizeVault).verified
        : false

    // Skip unverified vaults unless showing all positions
    if (!shouldShowAllPositions && !isVerifiedVault) {
      continue
          }

          try {
            const res = await accountLensContract.getVaultAccountInfo(subAccount, vaultAddress)

      // Only include if there are shares
      if (res.shares === 0n) continue

            deposits.push({
              vault,
        subAccount: normalizedSubAccount,
              shares: res.shares,
              assets: res.assets,
            } as AccountDepositPosition)
          }
          catch (e) {
            console.warn(`Failed to fetch vault ${vaultAddress}:`, e)
          }
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
const updateEarnPositions = async (
  balances: Map<string, bigint>,
  eulerLensAddresses: EulerLensAddresses,
  address: string,
  isInitialLoading = false,
  options: { forceAllPositions?: boolean } = {},
) => {
  if (isInitialLoading) {
    isDepositsLoaded.value = false
    isDepositsLoading.value = true
    earnPositions.value = []
  }

  if (!address) {
    isDepositsLoaded.value = false
    isDepositsLoading.value = true
    earnPositions.value = []
    return
  }

  const { getOrFetch, getType: registryGetType } = useVaultRegistry()
  const { SUBGRAPH_URL, EVM_PROVIDER_URL } = useEulerConfig()

  const shouldShowAllPositions = options.forceAllPositions ?? isShowAllPositions.value
  const isAllPositionsAtStart = shouldShowAllPositions
  let earns: AccountEarnPosition[] = []

  if (!eulerLensAddresses?.accountLens) {
    throw new Error('Euler addresses not loaded yet')
  }

  const provider = ethers.getDefaultProvider(EVM_PROVIDER_URL)
  const accountLensContract = new ethers.Contract(eulerLensAddresses.accountLens, eulerAccountLensABI, provider)

  // Always use subgraph for position discovery (same pattern as updateDepositPositions)
  const { data } = await axios.post(SUBGRAPH_URL, {
    query: `query AccountDeposits {
      trackingActiveAccount(id: "${getAddressPrefix(address)}") {
        deposits
      }
    }`,
    operationName: 'AccountDeposits',
  })
  const depositEntries = data.data.trackingActiveAccount?.deposits || []

  const batchSize = 5
  for (let i = 0; i < depositEntries.length; i += batchSize) {
    const batch = depositEntries
      .slice(i, i + batchSize)
      .map(async (entry: string) => {
        const vaultAddress = ethers.getAddress(`0x${entry.substring(42)}`)
        const subAccount = ethers.getAddress(entry.substring(0, 42))

        // Early skip non-earn types before resolving (avoids unnecessary getOrFetch)
        const knownType = registryGetType(vaultAddress)
        if (knownType === 'evk' || knownType === 'securitize') {
          return undefined
        }

        // Resolve vault from registry (populates registry for unknowns)
        const vault = await getOrFetch(vaultAddress)
        if (!vault) {
          return undefined
        }

        // Only process earn vaults (others handled by updateDepositPositions)
        if (registryGetType(vaultAddress) !== 'earn') {
          return undefined
        }

        // Skip unverified earn vaults unless showing all positions
        if (!shouldShowAllPositions && !vault.verified) {
          return undefined
        }

        try {
          const res = await accountLensContract.getVaultAccountInfo(subAccount, vaultAddress)

          if (res.shares === 0n) {
            return undefined
          }

          return {
            vault,
            shares: res.shares,
            assets: res.assets,
          } as AccountEarnPosition
        }
        catch (e) {
          console.warn(`Failed to fetch earn vault ${vaultAddress}:`, e)
          return undefined
        }
      })
    earns = [...earns, ...(await Promise.all(batch)).filter(o => !!o)] as AccountEarnPosition[]
  }

  const shouldUpdate = options.forceAllPositions !== undefined
    ? true
    : isShowAllPositions.value === isAllPositionsAtStart
  if (shouldUpdate) {
    earnPositions.value = earns
    isDepositsLoading.value = false
    isDepositsLoaded.value = true
  }
}

export const useEulerAccount = () => {
  const { isLoaded: isBalancesLoaded, balances } = useWallets()
  const { eulerLensAddresses, isReady: isEulerLensAddressesReady } = useEulerAddresses()
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
    updateDepositPositions(
      eulerLensAddresses.value,
      targetAddress,
      false,
      { forceAllPositions: shouldShowAll },
    )
    updateEarnPositions(
      balances.value,
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

  /**
   * Find a borrow position by its subaccount index.
   * The subaccount index is derived from: ownerAddress XOR subAccountAddress
   */
  const getPositionBySubAccountIndex = (subAccountIndex: number): AccountBorrowPosition | undefined => {
    const owner = portfolioAddress.value || address.value
    if (!owner) return undefined
    
    return borrowPositions.value.find((position) => {
      try {
        const ownerBigInt = BigInt(ethers.getAddress(owner))
        const subAccountBigInt = BigInt(ethers.getAddress(position.subAccount))
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
    earnPositions,
    isPositionsLoading,
    isPositionsLoaded,
    isDepositsLoading,
    isDepositsLoaded,
    isShowAllPositions,
    portfolioAddress,
    isDebugPortfolio,
    updateBorrowPositions,
    updateDepositPositions,
    updateEarnPositions,
    getPositionBySubAccountIndex,
    totalSuppliedValue,
    totalSuppliedValueInfo,
    totalBorrowedValue,
    totalBorrowedValueInfo,
  }
}
