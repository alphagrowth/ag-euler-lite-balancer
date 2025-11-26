import { ethers, FixedNumber } from 'ethers'
import axios from 'axios'
import { useAccount } from '@wagmi/vue'
import type { Address } from 'viem'
import { eulerAccountLensABI } from '~/entities/euler/abis'
import type { EulerLensAddresses } from '~/entities/euler/addresses'
import type {
  AccountBorrowPosition, AccountDepositPosition,
} from '~/entities/account'
import { convertSharesToAssets, getVaultPrice } from '~/entities/vault'
import { EVC_ABI } from '~/utils/evc-converter'

const depositPositions: Ref<AccountDepositPosition[]> = ref([])
const borrowPositions: Ref<AccountBorrowPosition[]> = ref([])

const isPositionsLoading = ref(true)
const isPositionsLoaded = ref(false)
const isDepositsLoading = ref(true)
const isDepositsLoaded = ref(false)

const operatorsBySubAccount: Ref<Map<string, Address | null>> = ref(new Map())

const KNOWN_OPERATORS: Address[] = [
  '0x56b1E83Ee4031F44Ef4a74ec499260b1136c34C8', // EulerSwap operator (Base)
] as const

const totalSuppliedValue = computed(() =>
  depositPositions.value.reduce((result, position) => result + getVaultPrice(position.assets, position.vault), 0)
  + borrowPositions.value.reduce((result, position) => result + getVaultPrice(position.supplied, position.collateral), 0),
)
const totalBorrowedValue = computed(() => borrowPositions.value.reduce((result, pair) => result + getVaultPrice(pair.borrowed, pair.borrow), 0))

const updateCollateralPositions = async (eulerLensAddresses: EulerLensAddresses, address: string) => {
  const { EVM_PROVIDER_URL } = useEulerConfig()
  const { eulerGoldskyUrl } = useEulerAddresses()
  const { map } = useVaults()

  if (!eulerLensAddresses?.accountLens) {
    throw new Error('Euler addresses not loaded yet')
  }

  const provider = ethers.getDefaultProvider(EVM_PROVIDER_URL)
  const accountLensContract = new ethers.Contract(eulerLensAddresses.accountLens, eulerAccountLensABI, provider)
  const { data } = await axios.post(eulerGoldskyUrl.value, {
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
const updateBorrowPositions = async (eulerLensAddresses: EulerLensAddresses, address: string, isInitialLoading = true) => {
  if (isInitialLoading) {
    isPositionsLoading.value = true
  }

  if (!address) {
    borrowPositions.value = []
    isPositionsLoading.value = false
    isPositionsLoaded.value = true
    return
  }

  const { EVM_PROVIDER_URL } = useEulerConfig()
  const { eulerGoldskyUrl } = useEulerAddresses()
  const { map } = useVaults()

  if (!eulerLensAddresses?.accountLens) {
    throw new Error('Euler addresses not loaded yet')
  }

  const provider = ethers.getDefaultProvider(EVM_PROVIDER_URL)
  const accountLensContract = new ethers.Contract(eulerLensAddresses.accountLens, eulerAccountLensABI, provider)
  const { data } = await axios.post(eulerGoldskyUrl.value as string, {
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

        const res = await accountLensContract.getAccountInfo(subAccount, vault)
        const collateral = map.value.get(ethers.getAddress(res.evcAccountInfo.enabledCollaterals[0]))
        const borrow = map.value.get(ethers.getAddress(res.evcAccountInfo.enabledControllers[0]))
        if (!collateral || !borrow) {
          return undefined
        }

        const cLTV = borrow?.collateralLTVs.find(ltv => ltv.collateral === collateral.address)

        let liquidityInfo
        let usedIndexer = false
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
                `https://indexer-main.euler.finance/v2/account/positions?chainId=1&address=${address}&timestamp=${Date.now()}`,
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
          usedIndexer = true
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

        const priceFixed = FixedNumber.fromValue(collateral.liabilityPriceInfo.amountOutAsk || 0n, 18)
          .div(FixedNumber.fromValue(borrow.liabilityPriceInfo.amountOutBid || 1n, 18))

        const supplyLiquidationPriceRatio = collateralValueLiquidation === 0n
          ? FixedNumber.fromValue(0n, 18)
          : FixedNumber.fromValue(liabilityValue, 18)
              .sub(FixedNumber.fromValue(collateralValueLiquidation, 18))
              .div(FixedNumber.fromValue(collateralValueLiquidation, 18))
              .add(FixedNumber.fromValue(1n, 0))

        const currentCollateralPrice = FixedNumber.fromValue(collateral.liabilityPriceInfo.amountOutMid || 0n, 18)

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
  borrowPositions.value = [...borrows, ...collateralPositions]
  isPositionsLoading.value = false
  isPositionsLoaded.value = true
}
const updateDepositPositions = async (balances: Map<string, bigint>) => {
  isDepositsLoading.value = true

  const { list } = useVaults()

  let deposits: AccountDepositPosition[] = []
  const batchSize = 5

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

  depositPositions.value = deposits
  isDepositsLoading.value = false
  isDepositsLoaded.value = true
}

const checkOperatorForSubAccount = async (
  subAccount: string,
  evcAddress: Address,
  provider: ethers.Provider,
): Promise<Address | null> => {
  try {
    const evcContract = new ethers.Contract(evcAddress, EVC_ABI, provider)

    for (const operator of KNOWN_OPERATORS) {
      try {
        const isAuthorized = await evcContract.isAccountOperatorAuthorized(
          subAccount,
          operator,
        ) as boolean

        if (isAuthorized) {
          return operator
        }
      }
      catch (error) {
        console.warn(`Failed to check operator ${operator} for account ${subAccount}:`, error)
      }
    }

    return null
  }
  catch (error) {
    console.error(`Failed to check operators for account ${subAccount}:`, error)
    return null
  }
}

const updateOperatorsForPositions = async (
  evcAddress: Address,
  address: string,
) => {
  const { EVM_PROVIDER_URL } = useEulerConfig()
  const provider = ethers.getDefaultProvider(EVM_PROVIDER_URL)

  const allSubAccounts = new Set<string>()

  borrowPositions.value.forEach((position) => {
    if (position.subAccount) {
      allSubAccounts.add(ethers.getAddress(position.subAccount))
    }
  })

  allSubAccounts.add(ethers.getAddress(address))

  const operatorChecks = Array.from(allSubAccounts).map(async (subAccount) => {
    const operator = await checkOperatorForSubAccount(subAccount, evcAddress, provider)
    return { subAccount, operator }
  })

  const results = await Promise.all(operatorChecks)

  const newOperatorsMap = new Map<string, Address | null>()
  results.forEach(({ subAccount, operator }) => {
    newOperatorsMap.set(subAccount, operator)
  })

  operatorsBySubAccount.value = newOperatorsMap
}

export const useEulerAccount = () => {
  const { isLoaded: isBalancesLoaded, balances } = useWallets()
  const { eulerLensAddresses, eulerCoreAddresses, isReady: isEulerLensAddressesReady } = useEulerAddresses()
  const { address } = useAccount()

  watch([isBalancesLoaded, isEulerLensAddressesReady, borrowPositions], async () => {
    if (isBalancesLoaded.value && isEulerLensAddressesReady.value) {
      updateBorrowPositions(eulerLensAddresses.value, address.value as string)
      updateDepositPositions(balances.value)

      if (eulerCoreAddresses.value?.evc && address.value) {
        await updateOperatorsForPositions(
          eulerCoreAddresses.value.evc as Address,
          address.value,
        )
      }
    }
  }, { immediate: true })

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
    isPositionsLoading,
    isPositionsLoaded,
    isDepositsLoading,
    isDepositsLoaded,
    updateBorrowPositions,
    updateCollateralPositions,
    updateDepositPositions,
    totalSuppliedValue,
    totalBorrowedValue,
    operatorsBySubAccount: computed(() => operatorsBySubAccount.value),
    getOperatorForSubAccount,
    hasOperator,
  }
}
