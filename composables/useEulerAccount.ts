import { ethers, FixedNumber } from 'ethers'
import axios from 'axios'
import { useAccount } from '@wagmi/vue'
import type { Address } from 'viem'
import { eulerAccountLensABI } from '~/entities/euler/abis'
import type { EulerLensAddresses } from '~/entities/euler/addresses'
import type {
  AccountBorrowPosition, AccountDepositPosition,
  AccountEarnPosition,
} from '~/entities/account'
import { convertSharesToAssets, getVaultPrice, getEarnVaultPrice, getVaultPriceInfo } from '~/entities/vault'

const depositPositions: Ref<AccountDepositPosition[]> = ref([])
const earnPositions: Ref<AccountEarnPosition[]> = ref([])
const borrowPositions: Ref<AccountBorrowPosition[]> = ref([])

const isPositionsLoading = ref(true)
const isPositionsLoaded = ref(false)
const isDepositsLoading = ref(true)
const isDepositsLoaded = ref(false)
const isShowAllPositions = ref(false)

const operatorsBySubAccount: Ref<Map<string, Address | null>> = ref(new Map())

const totalSuppliedValue = computed(() =>
  depositPositions.value.reduce((result, position) => result + getVaultPrice(position.assets, position.vault), 0)
  + borrowPositions.value.reduce((result, position) => result + getVaultPrice(position.supplied, position.collateral), 0),
)
const totalBorrowedValue = computed(() => borrowPositions.value.reduce((result, pair) => result + getVaultPrice(pair.borrowed, pair.borrow), 0))

const updateCollateralPositions = async (eulerLensAddresses: EulerLensAddresses, address: string) => {
  const { EVM_PROVIDER_URL, SUBGRAPH_URL } = useEulerConfig()
  const { map } = useVaults()

  if (!eulerLensAddresses?.accountLens) {
    throw new Error('Euler addresses not loaded yet')
  }

  const provider = ethers.getDefaultProvider(EVM_PROVIDER_URL)
  const accountLensContract = new ethers.Contract(eulerLensAddresses.accountLens, eulerAccountLensABI, provider)
  const { data } = await axios.post(SUBGRAPH_URL, {
    query: `query AccountDeposits {
      trackingActiveAccount(id: "${address}") {
        deposits
      }
    }`,
    operationName: 'AccountBorrows',
  })

  const depositEntries = data.data.trackingActiveAccount?.deposits || []

  let deposits: AccountBorrowPosition[] = []
  const borrows: any[] = []
  const batchSize = 5

  for (let i = 0; i < depositEntries.length; i += batchSize) {
    const batch = depositEntries
      .slice(i, i + batchSize)
      .map(async (entry: string) => {
        const vault = `0x${entry.substring(42)}`
        const subAccount = entry.substring(0, 42)

        const res = await accountLensContract.getAccountInfo(subAccount, vault)
        let enabledCollaterals = ''
        let enabledControllers = ''
        if (res.evcAccountInfo.enabledCollaterals.length > 0 && res.evcAccountInfo.enabledControllers.length > 0) {
          enabledCollaterals = res.evcAccountInfo.enabledCollaterals[0]
          enabledControllers = res.evcAccountInfo.enabledControllers[0]
        }
        if (!enabledCollaterals || !enabledControllers) {
          return undefined
        }
        const collateral = map.value.get(ethers.getAddress(res.evcAccountInfo.enabledCollaterals[0]))
        const borrow = map.value.get(ethers.getAddress(res.evcAccountInfo.enabledControllers[0]))
        if (!collateral || !borrow) {
          return undefined
        }
        const cLTV = borrow?.collateralLTVs.find(ltv => ltv.collateral === collateral.address)
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
        const res = await accountLensContract.getAccountInfo(deposit.subAccount, deposit.borrow.address)
        const borrowed = res.vaultAccountInfo.borrowed

        return {
          borrowed,
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
const updateBorrowPositions = async (eulerLensAddresses: EulerLensAddresses, address: string, isInitialLoading = false) => {
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
  const { map, getVault } = useVaults()
  const isAllPositionsAtStart = isShowAllPositions.value

  if (!eulerLensAddresses?.accountLens) {
    throw new Error('Euler addresses not loaded yet')
  }

  const provider = ethers.getDefaultProvider(EVM_PROVIDER_URL)
  const accountLensContract = new ethers.Contract(eulerLensAddresses.accountLens, eulerAccountLensABI, provider)
  const { data } = await axios.post(SUBGRAPH_URL, {
    query: `query AccountBorrows {
      trackingActiveAccount(id: "${address}") {
        borrows
      }
    }`,
    operationName: 'AccountBorrows',
  })
  const borrowEntries = data.data.trackingActiveAccount?.borrows || []

  let borrows: AccountBorrowPosition[] = []
  const batchSize = 5

  // Indexer fallback data (fetched only once if needed)
  let indexerData: Record<string, {
    debt?: {
      vault: string
      borrowed: string
      liquidityInfo: {
        queryFailure: boolean
        collateralValueLiquidation: string
        liabilityValue: string
        timeToLiquidation: string
      }
    }
    collaterals?: Record<string, { vault: string }>
  }> | null = null

  for (let i = 0; i < borrowEntries.length; i += batchSize) {
    const batch = borrowEntries
      .slice(i, i + batchSize)
      .map(async (entry: string) => {
        const vault = `0x${entry.substring(42)}`
        const subAccount = entry.substring(0, 42)
        const { chainId } = useEulerAddresses()

        const res = await accountLensContract.getAccountInfo(subAccount, vault)
        const collateral = isShowAllPositions.value ? await getVault(ethers.getAddress(res.evcAccountInfo.enabledCollaterals[0])) : map.value.get(ethers.getAddress(res.evcAccountInfo.enabledCollaterals[0]))
        const borrow = isShowAllPositions.value ? await getVault(ethers.getAddress(res.evcAccountInfo.enabledControllers[0])) : map.value.get(ethers.getAddress(res.evcAccountInfo.enabledControllers[0]))
        if (!collateral || !borrow) {
          return undefined
        }

        const cLTV = borrow?.collateralLTVs.find(ltv => ltv.collateral === collateral.address)

        let liquidityInfo
        try {
          liquidityInfo = res.vaultAccountInfo.liquidityInfo
          if (liquidityInfo.queryFailure || liquidityInfo.collateralValueLiquidation === 0n) {
            throw new Error('Query failure flag set or collateralValueLiquidation is 0')
          }
        }
        catch {
          if (!indexerData) {
            try {
              const response = await fetch(
                `https://indexer-main.euler.finance/v2/account/positions?chainId=${chainId.value}&address=${address}&timestamp=${Date.now()}`,
              )
              indexerData = await response.json()
            }
            catch (e) {
              console.error('Failed to fetch indexer data:', e)
            }
          }

          if (!indexerData) {
            console.warn('No indexer data available, skipping position')
            return undefined
          }

          const checksummedSubAccount = ethers.getAddress(subAccount)
          const indexerPosition = indexerData[checksummedSubAccount]

          if (!indexerPosition?.debt?.liquidityInfo || indexerPosition.debt.liquidityInfo.queryFailure) {
            console.warn('Indexer position has no liquidityInfo or query failed')
            return undefined
          }

          liquidityInfo = {
            collateralValueLiquidation: BigInt(indexerPosition.debt.liquidityInfo.collateralValueLiquidation),
            // Use liabilityValueLiquidation (not liabilityValue which doesn't exist in indexer response)
            liabilityValue: BigInt(indexerPosition.debt.liquidityInfo.liabilityValueLiquidation || indexerPosition.debt.liquidityInfo.liabilityValueBorrowing || 0),
            timeToLiquidation: BigInt(indexerPosition.debt.liquidityInfo.timeToLiquidation),
          }
        }

        const collateralValueLiquidation = liquidityInfo.collateralValueLiquidation
        let liabilityValue = liquidityInfo.liabilityValue
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
  if (isShowAllPositions.value === isAllPositionsAtStart) {
    borrowPositions.value = [...borrows, ...collateralPositions]
    isPositionsLoading.value = false
    isPositionsLoaded.value = true
  }
}
const updateDepositPositions = async (balances: Map<string, bigint>, eulerLensAddresses: EulerLensAddresses, address: string, isInitialLoading = false) => {
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

  const isAllPositionsAtStart = isShowAllPositions.value
  let deposits: AccountDepositPosition[] = []
  const batchSize = 5

  if (isAllPositionsAtStart) {
    const { SUBGRAPH_URL, EVM_PROVIDER_URL } = useEulerConfig()

    if (!eulerLensAddresses?.accountLens) {
      throw new Error('Euler addresses not loaded yet')
    }

    const provider = ethers.getDefaultProvider(EVM_PROVIDER_URL)
    const accountLensContract = new ethers.Contract(eulerLensAddresses.accountLens, eulerAccountLensABI, provider)
    const { data } = await axios.post(SUBGRAPH_URL, {
      query: `query AccountDeposits {
      trackingActiveAccount(id: "${address}") {
        deposits
      }
    }`,
      operationName: 'AccountBorrows',
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

  if (isShowAllPositions.value === isAllPositionsAtStart) {
    depositPositions.value = deposits
    isDepositsLoading.value = false
    isDepositsLoaded.value = true
  }
}
const updateEarnPositions = async (balances: Map<string, bigint>, eulerLensAddresses: EulerLensAddresses, address: string, isInitialLoading = false) => {
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
  const { vaults } = useEulerLabels()

  const isAllPositionsAtStart = isShowAllPositions.value
  let earns: AccountEarnPosition[] = []
  const batchSize = 5

  if (isAllPositionsAtStart) {
    const { SUBGRAPH_URL, EVM_PROVIDER_URL } = useEulerConfig()

    if (!eulerLensAddresses?.accountLens) {
      throw new Error('Euler addresses not loaded yet')
    }

    const provider = ethers.getDefaultProvider(EVM_PROVIDER_URL)
    const accountLensContract = new ethers.Contract(eulerLensAddresses.accountLens, eulerAccountLensABI, provider)
    const { data } = await axios.post(SUBGRAPH_URL, {
      query: `query AccountDeposits {
      trackingActiveAccount(id: "${address}") {
        deposits
      }
    }`,
      operationName: 'AccountBorrows',
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
          if (Object.keys(vaults).includes(normalizedVault) || map.value.has(normalizedVault)) {
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

  if (isShowAllPositions.value === isAllPositionsAtStart) {
    earnPositions.value = earns
    isDepositsLoading.value = false
    isDepositsLoaded.value = true
  }
}

const updateOperatorsForPositions = async (address: string) => {
  try {
    const { fetchSwapPools } = useSwapPools()
    const pools = await fetchSwapPools(address)

    const newOperatorsMap = new Map<string, Address | null>()

    for (const pool of pools) {
      const subAccount = ethers.getAddress(pool.account)
      newOperatorsMap.set(subAccount, pool.pool)
    }

    const primaryPool = pools.find(
      p => ethers.getAddress(p.account) === ethers.getAddress(address),
    )
    if (primaryPool) {
      newOperatorsMap.set(ethers.getAddress(address), primaryPool.pool)
    }

    operatorsBySubAccount.value = newOperatorsMap
  }
  catch (error) {
    console.warn('Failed to update operators:', error)
  }
}

export const useEulerAccount = () => {
  const { isLoaded: isBalancesLoaded, balances } = useWallets()
  const { eulerLensAddresses, isReady: isEulerLensAddressesReady } = useEulerAddresses()
  const { address } = useAccount()

  const updatePositions = () => {
    if (address.value) {
      updateBorrowPositions(eulerLensAddresses.value, address.value)
      updateDepositPositions(balances.value, eulerLensAddresses.value, address.value)
      updateEarnPositions(balances.value, eulerLensAddresses.value, address.value)
      updateOperatorsForPositions(address.value)
    }
  }

  watch([isBalancesLoaded, isEulerLensAddressesReady], async () => {
    if (isBalancesLoaded.value && isEulerLensAddressesReady.value) {
      updatePositions()
    }
  }, { immediate: true })

  watch(isShowAllPositions, () => {
    if (address.value) {
      updatePositions()
    }
  })

  const getOperatorForSubAccount = (subAccount: string | undefined): Address | null => {
    if (!subAccount) return null
    const checksummed = ethers.getAddress(subAccount)
    return operatorsBySubAccount.value.get(checksummed) || null
  }

  const hasOperator = (subAccount: string | undefined): boolean => {
    return getOperatorForSubAccount(subAccount) !== null
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
    updateBorrowPositions,
    updateCollateralPositions,
    updateDepositPositions,
    updateEarnPositions,
    totalSuppliedValue,
    totalBorrowedValue,
    operatorsBySubAccount: computed(() => operatorsBySubAccount.value),
    getOperatorForSubAccount,
    hasOperator,
  }
}
