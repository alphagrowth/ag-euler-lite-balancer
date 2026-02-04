import { ethers, FixedNumber } from 'ethers'
import axios from 'axios'
import { useAccount } from '@wagmi/vue'
import { useVaultRegistry } from './useVaultRegistry'
import { eulerAccountLensABI } from '~/entities/euler/abis'
import type { EulerLensAddresses } from '~/entities/euler/addresses'
import type {
  AccountBorrowPosition, AccountDepositPosition,
  AccountEarnPosition,
} from '~/entities/account'
import {
  convertSharesToAssets,
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
const resolvePositionCollaterals = (liquidityInfo: Record<string, unknown>, fallback: string[]) => {
  const fallbackNormalized = fallback.map(addr => normalizeAddress(addr)).filter(Boolean)
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

  if (infoCollaterals.length) {
    return infoCollaterals
  }

  return fallbackNormalized
}

const totalSuppliedValue = computed(() => {
  const { getVault: registryGetVault } = useVaultRegistry()

  // Deposit positions (standalone vault context) — only vaults with price info
  const depositValue = depositPositions.value
    .filter(position => 'liabilityPriceInfo' in position.vault)
    .reduce((result, position) => result + getAssetUsdValue(position.assets, position.vault as Vault), 0)

  // Borrow position collateral (liability vault context) — use borrow vault's collateral pricing with USD conversion
  const collateralValue = borrowPositions.value.reduce((result, position) => {
    const borrowVault = registryGetVault(position.borrow.address) as Vault | undefined
    if (!borrowVault) return result

    return result + getCollateralUsdValue(position.supplied, borrowVault, position.collateral)
  }, 0)

  // Earn positions — use earn vault's asset price
  const earnValue = earnPositions.value.reduce(
    (result, position) => result + getAssetUsdValue(position.assets, position.vault),
    0,
  )

  return depositValue + collateralValue + earnValue
})

const totalSuppliedValueInfo = computed(() => {
  const { getVault: registryGetVault } = useVaultRegistry()
  let total = 0
  let hasMissingPrices = false

  depositPositions.value.forEach((position) => {
    const price = getAssetUsdValue(position.assets, position.vault)
    if (price === 0 && position.assets > 0n) {
      hasMissingPrices = true
    }
    total += price
  })

  borrowPositions.value.forEach((position) => {
    const borrowVault = registryGetVault(position.borrow.address) as Vault | undefined
    if (!borrowVault) {
      if (position.supplied > 0n) hasMissingPrices = true
      return
    }

    const value = getCollateralUsdValue(position.supplied, borrowVault, position.collateral)
    if (value === 0 && position.supplied > 0n) {
      hasMissingPrices = true
    }
    total += value
  })

  earnPositions.value.forEach((position) => {
    const price = getAssetUsdValue(position.assets, position.vault)
    if (price === 0 && position.assets > 0n) {
      hasMissingPrices = true
    }
    total += price
  })

  return { total, hasMissingPrices }
})

const totalBorrowedValue = computed(() => borrowPositions.value.reduce((result, pair) => result + getAssetUsdValue(pair.borrowed, pair.borrow), 0))

const totalBorrowedValueInfo = computed(() => {
  let total = 0
  let hasMissingPrices = false

  borrowPositions.value.forEach((pair) => {
    const price = getAssetUsdValue(pair.borrowed, pair.borrow)
    if (price === 0 && pair.borrowed > 0n) {
      hasMissingPrices = true
    }
    total += price
  })

  return { total, hasMissingPrices }
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

  const { EVM_PROVIDER_URL, SUBGRAPH_URL } = useEulerConfig()
  const { getOrFetch } = useVaultRegistry()
  const shouldShowAllPositions = options.forceAllPositions ?? isShowAllPositions.value
  const isAllPositionsAtStart = shouldShowAllPositions

  if (!eulerLensAddresses?.accountLens) {
    throw new Error('Euler addresses not loaded yet')
  }

  const provider = ethers.getDefaultProvider(EVM_PROVIDER_URL)
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
        const vault = `0x${entry.substring(42)}`
        const subAccount = entry.substring(0, 42)

        let res
        try {
          res = await accountLensContract.getAccountInfo(subAccount, vault)
        }
        catch {
          return undefined
        }

        if (!res.evcAccountInfo.enabledControllers.length || !res.evcAccountInfo.enabledCollaterals.length) {
          return undefined
        }

        const enabledCollateralsList = res.evcAccountInfo.enabledCollaterals.map(collateral => ethers.getAddress(collateral))
        const collaterals = resolvePositionCollaterals(res.vaultAccountInfo?.liquidityInfo, enabledCollateralsList)

        const borrowAddress = ethers.getAddress(res.evcAccountInfo.enabledControllers[0])
        // Use unified resolution - getOrFetch handles registry lookup + fallback fetch
        const borrow = await getOrFetch(borrowAddress) as Vault | undefined
        if (!borrow) {
          return undefined
        }

        let collateralAddress: string | undefined
        const collateralCandidates = collaterals.length ? collaterals : enabledCollateralsList
        for (const addr of collateralCandidates) {
          if (borrow.collateralLTVs.some(ltv => ethers.getAddress(ltv.collateral) === addr)) {
            collateralAddress = addr
            break
          }
        }

        if (!collateralAddress) {
          collateralAddress = collateralCandidates[0]
        }

        // Use unified resolution for collateral vault (handles EVK, escrow, and securitize)
        const collateral = await getOrFetch(collateralAddress) as Vault | undefined

        if (!collateral) {
          return undefined
        }

        // Skip positions where both vaults are unverified (unless showing all positions)
        if (!shouldShowAllPositions && !borrow.verified && !collateral.verified) {
          return undefined
        }

        const cLTV = borrow.collateralLTVs.find(ltv => ethers.getAddress(ltv.collateral) === collateral.address)

        const liquidityInfo = res.vaultAccountInfo.liquidityInfo

        const collateralValueLiquidation = liquidityInfo.collateralValueLiquidation
        let liabilityValue = liquidityInfo.liabilityValueBorrowing
        const liquidationLTV = cLTV?.liquidationLTV || 0n

        if (liabilityValue === 0n && res.vaultAccountInfo.borrowed > 0n) {
          console.warn('liabilityValue is 0 but borrowed amount exists, calculating manually')
          const borrowedInUnitOfAccount = FixedNumber.fromValue(res.vaultAccountInfo.borrowed, borrow.decimals)
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

        // Get collateral price in USD for display
        const collateralPriceUsd = getCollateralUsdPrice(borrow, collateral)

        // Guard against missing price
        if (!collateralPriceUoA || !borrowPriceUoA || !collateralPriceUsd) {
          return undefined // or handle gracefully
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
          res.vaultAccountInfo.borrowed,
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
          borrowLTV: cLTV?.borrowLTV || 0n,
          initialLiquidationLTV: cLTV?.initialLiquidationLTV || 0n,
          timeToLiquidation: liquidityInfo.timeToLiquidation,
          health: healthFixed.value,
          borrowed: res.vaultAccountInfo.borrowed,
          price,
          userLTV,
          supplied,
          liabilityValue,
          liquidationLTV,
          collateralValueLiquidation,
        } as AccountBorrowPosition
      })

    borrows = [...borrows, ...(await Promise.all(batch)).filter(o => !!o)] as AccountBorrowPosition[]
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
  balances: Map<string, bigint>,
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
  const { getOrFetch, has: registryHas, getType: registryGetType, getEvkVaults } = useVaultRegistry()
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
            const res = await accountLensContract.getAccountInfo(subAccount, vaultAddress)

      // Only include if there are shares
      if (res.vaultAccountInfo.shares === 0n) continue

            deposits.push({
              vault,
        subAccount: normalizedSubAccount,
              shares: res.vaultAccountInfo.shares,
              assets: res.vaultAccountInfo.assets,
            } as AccountDepositPosition)
          }
          catch (e) {
            console.warn(`Failed to fetch vault ${vaultAddress}:`, e)
          }
        }

  // Also include deposits from wallet balances for verified EVK vaults
  // (some deposits might not be tracked in subgraph if balance forwarding is disabled)
  const normalizedAddress = ethers.getAddress(address)
  for (const vault of getEvkVaults()) {
    const balance = balances.get(ethers.getAddress(vault.address))
    if (!balance || balance === 0n) continue

    // Skip if already in deposits from subgraph
    if (deposits.some(d => ethers.getAddress(d.vault.address) === ethers.getAddress(vault.address))) {
      continue
    }

    // Check if this is used as collateral (using main address as subAccount)
    const collateralKey = `${normalizedAddress}:${ethers.getAddress(vault.address)}`
    if (collateralUsageSet.value.has(collateralKey)) {
      continue
    }

    deposits.push({
      vault,
      subAccount: normalizedAddress,
      shares: balance,
      assets: await convertSharesToAssets(vault.address, balance),
    } as AccountDepositPosition)
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

  const { getOrFetch, getType: registryGetType, getEarnVaults } = useVaultRegistry()

  const shouldShowAllPositions = options.forceAllPositions ?? isShowAllPositions.value
  const isAllPositionsAtStart = shouldShowAllPositions
  let earns: AccountEarnPosition[] = []
  const batchSize = 5

  if (shouldShowAllPositions) {
    const { SUBGRAPH_URL, EVM_PROVIDER_URL } = useEulerConfig()

    if (!eulerLensAddresses?.accountLens) {
      throw new Error('Euler addresses not loaded yet')
    }

    const provider = ethers.getDefaultProvider(EVM_PROVIDER_URL)
    const accountLensContract = new ethers.Contract(eulerLensAddresses.accountLens, eulerAccountLensABI, provider)
    const { data } = await axios.post(SUBGRAPH_URL, {
      query: `query AccountDeposits {
      trackingActiveAccount(id: "${getAddressPrefix(address)}") {
        deposits
      }
    }`,
      operationName: 'AccountDeposits',
    })
    const depositEntries = data.data.trackingActiveAccount?.deposits || []

    for (let i = 0; i < depositEntries.length; i += batchSize) {
      const batch = depositEntries
        .slice(i, i + batchSize)
        .map(async (entry: string) => {
          const vaultAddress = `0x${entry.substring(42)}`
          const subAccount = entry.substring(0, 42)

          if (ethers.getAddress(subAccount) !== ethers.getAddress(address)) {
            return undefined
          }

          // Resolve vault from registry
          const vault = await getOrFetch(vaultAddress)
          if (!vault) {
            return undefined
          }

          // Only process earn vaults (others handled by updateDepositPositions)
          if (registryGetType(vaultAddress) !== 'earn') {
            return undefined
          }

          try {
            const res = await accountLensContract.getAccountInfo(subAccount, vaultAddress)

            return {
              vault,
              shares: res.vaultAccountInfo.shares,
              assets: res.vaultAccountInfo.assets,
            } as AccountEarnPosition
          }
          catch (e) {
            console.warn(`Failed to fetch earn vault ${vaultAddress}:`, e)
            return undefined
          }
        })
      earns = [...earns, ...(await Promise.all(batch)).filter(o => !!o)] as AccountEarnPosition[]
    }
  }
  else {
    // For non-showAll mode, only show positions in known/verified earn vaults
    // Use account lens to get share balances (wallet balances only track underlying assets)
    const { EVM_PROVIDER_URL } = useEulerConfig()

    if (!eulerLensAddresses?.accountLens) {
      throw new Error('Euler addresses not loaded yet')
    }

    const provider = ethers.getDefaultProvider(EVM_PROVIDER_URL)
    const accountLensContract = new ethers.Contract(eulerLensAddresses.accountLens, eulerAccountLensABI, provider)

    const earnVaultsList = getEarnVaults().filter(v => v.verified)
    for (let i = 0; i < earnVaultsList.length; i += batchSize) {
      const batch = earnVaultsList
        .slice(i, i + batchSize)
        .map(async (vault) => {
          try {
            const res = await accountLensContract.getAccountInfo(address, vault.address)
            return {
              vault,
              shares: res.vaultAccountInfo.shares,
              assets: res.vaultAccountInfo.assets,
            } as AccountEarnPosition
          }
          catch {
            return {
              vault,
              shares: 0n,
              assets: 0n,
            } as AccountEarnPosition
          }
        })

      earns = [...earns, ...(await Promise.all(batch)).filter(o => o.shares > 0n)] as AccountEarnPosition[]
    }
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
      balances.value,
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
