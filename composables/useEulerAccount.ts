import { ethers, FixedNumber } from 'ethers'
import axios from 'axios'
import { useAccount } from '@wagmi/vue'
import { eulerAccountLensABI } from '~/entities/euler/abis'
import type { EulerLensAddresses } from '~/entities/euler/addresses'
import type {
  AccountBorrowPosition, AccountDepositPosition,
  AccountEarnPosition, AccountSecuritizePosition,
} from '~/entities/account'
import { convertSharesToAssets, getVaultPrice, getVaultPriceInfo } from '~/entities/vault'

const depositPositions: Ref<AccountDepositPosition[]> = ref([])
const earnPositions: Ref<AccountEarnPosition[]> = ref([])
const borrowPositions: Ref<AccountBorrowPosition[]> = ref([])
const securitizePositions: Ref<AccountSecuritizePosition[]> = ref([])

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

// Hardcoded Securitize vault address for testing
const SECURITIZE_VAULT_ADDRESS = '0xdB6856e8478DB159c383a0c4b274E259AF83cB15'
const toBigInt = (value: unknown) => {
  try {
    return BigInt(value as bigint)
  }
  catch {
    return 0n
  }
}
const resolvePositionCollaterals = (liquidityInfo: any, fallback: string[]) => {
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

const totalSuppliedValue = computed(() =>
  depositPositions.value.reduce((result, position) => result + getVaultPrice(position.assets, position.vault), 0)
  + borrowPositions.value.reduce((result, position) => result + getVaultPrice(position.supplied, position.collateral), 0),
)
const totalBorrowedValue = computed(() => borrowPositions.value.reduce((result, pair) => result + getVaultPrice(pair.borrowed, pair.borrow), 0))

const updateCollateralPositions = async (eulerLensAddresses: EulerLensAddresses, address: string) => {
  const { EVM_PROVIDER_URL, SUBGRAPH_SIMPLE_URL } = useEulerConfig()
  const { map } = useVaults()

  if (!eulerLensAddresses?.accountLens) {
    throw new Error('Euler addresses not loaded yet')
  }

  const provider = ethers.getDefaultProvider(EVM_PROVIDER_URL)
  const accountLensContract = new ethers.Contract(eulerLensAddresses.accountLens, eulerAccountLensABI, provider)
  const { data } = await axios.post(SUBGRAPH_SIMPLE_URL, {
    query: `query AccountDeposits {
      trackingActiveAccount(id: "${getAddressPrefix(address)}") {
        deposits
      }
    }`,
    operationName: 'AccountDeposits',
  })

  const depositEntries = data.data.trackingActiveAccount?.deposits || []

  let deposits: AccountBorrowPosition[] = []
  const borrows: { borrowed: bigint }[] = []
  const batchSize = 5

  for (let i = 0; i < depositEntries.length; i += batchSize) {
    const batch = depositEntries
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

        let enabledCollaterals = ''
        let enabledControllers = ''
        if (res.evcAccountInfo.enabledCollaterals.length > 0 && res.evcAccountInfo.enabledControllers.length > 0) {
          enabledCollaterals = res.evcAccountInfo.enabledCollaterals[0]
          enabledControllers = res.evcAccountInfo.enabledControllers[0]
        }
        if (!enabledCollaterals || !enabledControllers) {
          return undefined
        }

        const enabledCollateralsList = res.evcAccountInfo.enabledCollaterals.map(collateral => ethers.getAddress(collateral))
        const collaterals = resolvePositionCollaterals(res.vaultAccountInfo?.liquidityInfo, enabledCollateralsList)

        const borrowAddress = ethers.getAddress(res.evcAccountInfo.enabledControllers[0])
        const borrow = map.value.get(borrowAddress)
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

        const collateral = map.value.get(collateralAddress)
        if (!collateral) {
          return undefined
        }

        const cLTV = borrow.collateralLTVs.find(ltv => ethers.getAddress(ltv.collateral) === collateral.address)
        const collateralValueLiquidation = res.vaultAccountInfo.liquidityInfo.collateralValueLiquidation
        const liabilityValue = res.vaultAccountInfo.liquidityInfo.liabilityValue
        const liquidationLTV = cLTV?.liquidationLTV || 0n
        const healthFixed = FixedNumber.fromValue(1, 18)
        const userLTVFixed = healthFixed.isZero()
          ? FixedNumber.fromValue(0n, 2)
          : FixedNumber.fromValue(liquidationLTV, 2).div(healthFixed)
        const userLTV = userLTVFixed.value
        const priceFixed = FixedNumber.fromValue(1n, 18)
        const price = priceFixed.value
        const supplied = res.vaultAccountInfo.assets

        return {
          borrow,
          collateral,
          collaterals,
          subAccount,
          liabilityLTV: 0n,
          borrowLTV: cLTV?.borrowLTV || 0n,
          initialLiquidationLTV: cLTV?.initialLiquidationLTV || 0n,
          timeToLiquidation: res.vaultAccountInfo.liquidityInfo.timeToLiquidation,
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
    deposits = [...deposits, ...(await Promise.all(batch)).filter(o => !!o)] as AccountBorrowPosition[]
  }

  for (let i = 0; i < deposits.length; i += batchSize) {
    const batch = deposits
      .slice(i, i + batchSize)
      .map(async (deposit: AccountBorrowPosition) => {
        try {
          const res = await accountLensContract.getAccountInfo(deposit.subAccount, deposit.borrow.address)
          const borrowed = res.vaultAccountInfo.borrowed

          return {
            borrowed,
          }
        }
        catch {
          return {
            borrowed: 0n,
          }
        }
      })

    borrows.push(...(await Promise.all(batch)).filter(o => !!o))
  }
  return deposits
    .filter((deposit, idx) => borrows[idx].borrowed === 0n)
    .map((deposit) => {
      return {
        ...deposit,
        borrow: {
          ...deposit.borrow,
          borrow: 0n,
        },
      }
    })
}
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

  const { EVM_PROVIDER_URL, SUBGRAPH_SIMPLE_URL } = useEulerConfig()
  const { map, getVault } = useVaults()
  const shouldShowAllPositions = options.forceAllPositions ?? isShowAllPositions.value
  const isAllPositionsAtStart = shouldShowAllPositions

  if (!eulerLensAddresses?.accountLens) {
    throw new Error('Euler addresses not loaded yet')
  }

  const provider = ethers.getDefaultProvider(EVM_PROVIDER_URL)
  const accountLensContract = new ethers.Contract(eulerLensAddresses.accountLens, eulerAccountLensABI, provider)

  const { data } = await axios.post(SUBGRAPH_SIMPLE_URL, {
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
        const borrow = shouldShowAllPositions ? await getVault(borrowAddress) : map.value.get(borrowAddress)
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

        const collateral = shouldShowAllPositions ? await getVault(collateralAddress) : map.value.get(collateralAddress)
        if (!collateral) {
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
        const collateralPrice = getVaultPriceInfo(collateral)
        const borrowPrice = getVaultPriceInfo(borrow)
        const priceFixed = FixedNumber.fromValue(collateralPrice?.amountOutAsk || 0n, 18)
          .div(FixedNumber.fromValue(borrowPrice?.amountOutBid || 1n, 18))

        const supplyLiquidationPriceRatio = collateralValueLiquidation === 0n
          ? FixedNumber.fromValue(0n, 18)
          : FixedNumber.fromValue(liabilityValue, 18)
              .sub(FixedNumber.fromValue(collateralValueLiquidation, 18))
              .div(FixedNumber.fromValue(collateralValueLiquidation, 18))
              .add(FixedNumber.fromValue(1n, 0))

        const currentCollateralPrice = FixedNumber.fromValue(collateralPrice?.amountOutMid || 0n, 18)

        const price = currentCollateralPrice.mul(supplyLiquidationPriceRatio).value

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
  const collateralPositions = await updateCollateralPositions(eulerLensAddresses, address) || []
  const shouldUpdate = options.forceAllPositions !== undefined
    ? true
    : isShowAllPositions.value === isAllPositionsAtStart
  if (shouldUpdate) {
    borrowPositions.value = [...borrows, ...collateralPositions]
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

  const { list, getVault, earnMap } = useVaults()
  const { earnVaults } = useEulerLabels()

  const shouldShowAllPositions = options.forceAllPositions ?? isShowAllPositions.value
  const isAllPositionsAtStart = shouldShowAllPositions
  let deposits: AccountDepositPosition[] = []
  const batchSize = 5

  if (shouldShowAllPositions) {
    const { SUBGRAPH_SIMPLE_URL, EVM_PROVIDER_URL } = useEulerConfig()

    if (!eulerLensAddresses?.accountLens) {
      throw new Error('Euler addresses not loaded yet')
    }

    const provider = ethers.getDefaultProvider(EVM_PROVIDER_URL)
    const accountLensContract = new ethers.Contract(eulerLensAddresses.accountLens, eulerAccountLensABI, provider)
    const { data } = await axios.post(SUBGRAPH_SIMPLE_URL, {
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
          const vault = `0x${entry.substring(42)}`
          const subAccount = entry.substring(0, 42)

          if (ethers.getAddress(subAccount) !== ethers.getAddress(address)) {
            return undefined
          }

          // Check if this is an earn vault, skip if it is (handled by updateEarnPositions)
          const normalizedVault = ethers.getAddress(vault)
          if (earnVaults.value.includes(normalizedVault) || earnMap.value.has(normalizedVault)) {
            return undefined
          }

          // Check if this is a Securitize vault - skip for now (handled separately)
          if (normalizedVault.toLowerCase() === SECURITIZE_VAULT_ADDRESS.toLowerCase()) {
            return undefined
          }

          try {
            const res = await accountLensContract.getAccountInfo(subAccount, vault)

            return {
              vault: await getVault(vault),
              shares: res.vaultAccountInfo.shares,
              assets: res.vaultAccountInfo.assets,
            } as AccountDepositPosition
          }
          catch (e) {
            console.warn(`Failed to fetch regular vault ${vault}:`, e)
            return undefined
          }
        })
      deposits = [...deposits, ...(await Promise.all(batch)).filter(o => !!o)] as AccountDepositPosition[]
    }
  }
  else {
    for (let i = 0; i < list.value.length; i += batchSize) {
      const batch = list.value
        .slice(i, i + batchSize)
        .map(async (vault) => {
          const balance = balances.get(ethers.getAddress(vault.address))
          return {
            vault,
            shares: balance,
            assets: balance ? await convertSharesToAssets(vault.address, balance) : 0n,
          } as AccountDepositPosition
        })

      deposits = [...deposits, ...(await Promise.all(batch)).filter(o => o.shares > 0n)] as AccountDepositPosition[]
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

  const { earnList, getEarnVault, map } = useVaults()
  const { verifiedVaultAddresses } = useEulerLabels()

  const shouldShowAllPositions = options.forceAllPositions ?? isShowAllPositions.value
  const isAllPositionsAtStart = shouldShowAllPositions
  let earns: AccountEarnPosition[] = []
  const batchSize = 5

  if (shouldShowAllPositions) {
    const { SUBGRAPH_SIMPLE_URL, EVM_PROVIDER_URL } = useEulerConfig()

    if (!eulerLensAddresses?.accountLens) {
      throw new Error('Euler addresses not loaded yet')
    }

    const provider = ethers.getDefaultProvider(EVM_PROVIDER_URL)
    const accountLensContract = new ethers.Contract(eulerLensAddresses.accountLens, eulerAccountLensABI, provider)
    const { data } = await axios.post(SUBGRAPH_SIMPLE_URL, {
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
          const vault = `0x${entry.substring(42)}`
          const subAccount = entry.substring(0, 42)

          if (ethers.getAddress(subAccount) !== ethers.getAddress(address)) {
            return undefined
          }

          // Check if this is a regular vault, skip if it is (handled by updateDepositPositions)
          const normalizedVault = ethers.getAddress(vault)
          if (verifiedVaultAddresses.value.includes(normalizedVault) || map.value.has(normalizedVault)) {
            return undefined
          }

          // Check if this is a Securitize vault - skip (handled by updateDepositPositions)
          if (normalizedVault.toLowerCase() === SECURITIZE_VAULT_ADDRESS.toLowerCase()) {
            return undefined
          }

          try {
            const res = await accountLensContract.getAccountInfo(subAccount, vault)

            return {
              vault: await getEarnVault(vault),
              shares: res.vaultAccountInfo.shares,
              assets: res.vaultAccountInfo.assets,
            } as AccountEarnPosition
          }
          catch (e) {
            console.warn(`Failed to fetch earn vault ${vault}:`, e)
            return undefined
          }
        })
      earns = [...earns, ...(await Promise.all(batch)).filter(o => !!o)] as AccountEarnPosition[]
    }
  }
  else {
    for (let i = 0; i < earnList.value.length; i += batchSize) {
      const batch = earnList.value
        .slice(i, i + batchSize)
        .map(async (vault) => {
          const balance = balances.get(ethers.getAddress(vault.address))
          return {
            vault,
            shares: balance,
            assets: balance ? await convertSharesToAssets(vault.address, balance) : 0n,
          } as AccountEarnPosition
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

const updateSecuritizePositions = async (
  balances: Map<string, bigint>,
  eulerLensAddresses: EulerLensAddresses,
  address: string,
  isInitialLoading = false,
  options: { forceAllPositions?: boolean } = {},
) => {
  if (isInitialLoading) {
    securitizePositions.value = []
  }

  if (!address) {
    securitizePositions.value = []
    return
  }

  const { getSecuritizeVault } = useVaults()
  const { SUBGRAPH_SIMPLE_URL, EVM_PROVIDER_URL } = useEulerConfig()

  const _shouldShowAllPositions = options.forceAllPositions ?? isShowAllPositions.value
  const securitize: AccountSecuritizePosition[] = []

  if (!eulerLensAddresses?.accountLens) {
    return
  }

  const provider = ethers.getDefaultProvider(EVM_PROVIDER_URL)
  const accountLensContract = new ethers.Contract(eulerLensAddresses.accountLens, eulerAccountLensABI, provider)

  // Query the simple subgraph for deposits
  const { data } = await axios.post(SUBGRAPH_SIMPLE_URL, {
    query: `query AccountDeposits {
      trackingActiveAccount(id: "${getAddressPrefix(address)}") {
        deposits
      }
    }`,
    operationName: 'AccountDeposits',
  })

  const depositEntries = data.data.trackingActiveAccount?.deposits || []

  // Filter for the hardcoded Securitize vault
  // Note: subaccounts share the same prefix as the main account, so we match on prefix
  const securitizeEntries = depositEntries.filter((entry: string) => {
    const vault = `0x${entry.substring(42)}`
    const subAccount = entry.substring(0, 42)
    try {
      const normalizedVault = ethers.getAddress(vault)
      const isSecuritizeVault = normalizedVault.toLowerCase() === SECURITIZE_VAULT_ADDRESS.toLowerCase()
      // Match on address prefix (first 19 bytes) since subaccounts derive from main account
      const subAccountPrefix = subAccount.toLowerCase().slice(0, 40)
      const addrPrefix = address.toLowerCase().slice(0, 40)
      const isMatchingAccount = subAccountPrefix === addrPrefix

      return isSecuritizeVault && isMatchingAccount
    }
    catch {
      return false
    }
  })

  for (const entry of securitizeEntries) {
    const vault = `0x${entry.substring(42)}`
    const subAccount = entry.substring(0, 42)

    try {
      const res = await accountLensContract.getAccountInfo(subAccount, vault)
      const securitizeVault = await getSecuritizeVault(vault)

      securitize.push({
        vault: securitizeVault,
        shares: res.vaultAccountInfo.shares,
        assets: res.vaultAccountInfo.assets,
      } as AccountSecuritizePosition)
    }
    catch (e) {
      console.warn(`Failed to fetch securitize vault ${vault}:`, e)
    }
  }

  securitizePositions.value = securitize
}

export const useEulerAccount = () => {
  const { isLoaded: isBalancesLoaded, balances } = useWallets()
  const { eulerLensAddresses, isReady: isEulerLensAddressesReady } = useEulerAddresses()
  const { address } = useAccount()
  const { public: { debugPortfolioAddress } } = useRuntimeConfig()
  const normalizedDebugAddress = computed(() => normalizeAddress(debugPortfolioAddress))
  const portfolioAddress = computed(() => normalizedDebugAddress.value || normalizeAddress(address.value))
  const isDebugPortfolio = computed(() => Boolean(normalizedDebugAddress.value))

  const updatePositions = () => {
    const targetAddress = portfolioAddress.value
    updateBorrowPositions(
      eulerLensAddresses.value,
      targetAddress,
      false,
      { forceAllPositions: isDebugPortfolio.value },
    )
    updateDepositPositions(
      balances.value,
      eulerLensAddresses.value,
      targetAddress,
      false,
      { forceAllPositions: isDebugPortfolio.value },
    )
    updateEarnPositions(
      balances.value,
      eulerLensAddresses.value,
      targetAddress,
      false,
      { forceAllPositions: isDebugPortfolio.value },
    )
    updateSecuritizePositions(
      balances.value,
      eulerLensAddresses.value,
      targetAddress,
      false,
      { forceAllPositions: isDebugPortfolio.value },
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

  return {
    borrowPositions,
    depositPositions,
    earnPositions,
    securitizePositions,
    isPositionsLoading,
    isPositionsLoaded,
    isDepositsLoading,
    isDepositsLoaded,
    isShowAllPositions,
    portfolioAddress,
    isDebugPortfolio,
    updateBorrowPositions,
    updateCollateralPositions,
    updateDepositPositions,
    updateEarnPositions,
    updateSecuritizePositions,
    totalSuppliedValue,
    totalBorrowedValue,
  }
}
