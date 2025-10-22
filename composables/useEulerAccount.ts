import { ethers, FixedNumber } from 'ethers'
import { Address } from '@ton/core'
import axios from 'axios'
import { eulerAccountLensABI } from '~/entities/euler/abis'
import { eulerCoreAddresses, type EulerLensAddresses } from '~/entities/euler/addresses'
import type {
  Account, AccountBorrowPosition, AccountDepositPosition,
} from '~/entities/account'
import { convertSharesToAssets, getVaultPrice } from '~/entities/vault'

const address: Ref<string> = ref('')
const account: Ref<Account | undefined> = ref(undefined)
const depositPositions: Ref<AccountDepositPosition[]> = ref([])
const borrowPositions: Ref<AccountBorrowPosition[]> = ref([])

const isPositionsLoaded = ref(false)
const isPositionsLoading = ref(false)
const isDepositsLoading = ref(true)

const totalSuppliedValue = computed(() =>
  depositPositions.value.reduce((result, position) => result + getVaultPrice(position.assets, position.vault), 0)
  + borrowPositions.value.reduce((result, position) => result + getVaultPrice(position.supplied, position.collateral), 0),
)
const totalBorrowedValue = computed(() => borrowPositions.value.reduce((result, pair) => result + getVaultPrice(pair.borrowed, pair.borrow), 0))

const updateCollateralPositions = async (eulerLensAddresses: EulerLensAddresses) => {
  const { EVM_PROVIDER_URL, GOLDSKY_API_URL } = useEulerConfig()
  const { isReady, map } = useVaults()
  await until(isReady).toBe(true)
  const provider = ethers.getDefaultProvider(EVM_PROVIDER_URL)
  const accountLensContract = new ethers.Contract(eulerLensAddresses?.accountLens || '', eulerAccountLensABI, provider)
  const { data } = await axios.post(GOLDSKY_API_URL, {
    query: `query AccountDeposits {
      trackingActiveAccount(id: "${address.value}") {
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
const updateBorrowPositions = async (eulerLensAddresses: EulerLensAddresses, isInitialLoading = true) => {
  if (isInitialLoading) {
    isPositionsLoading.value = true
  }

  const { EVM_PROVIDER_URL, GOLDSKY_API_URL } = useEulerConfig()
  const { isReady, map } = useVaults()
  await until(isReady).toBe(true)
  const provider = ethers.getDefaultProvider(EVM_PROVIDER_URL)
  const accountLensContract = new ethers.Contract(eulerLensAddresses?.accountLens || '', eulerAccountLensABI, provider)
  const { data } = await axios.post(GOLDSKY_API_URL, {
    query: `query AccountBorrows {
      trackingActiveAccount(id: "${address.value}") {
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

        const res = await accountLensContract.getAccountInfo(subAccount, vault)
        const collateral = map.value.get(ethers.getAddress(res.evcAccountInfo.enabledCollaterals[0]))
        const borrow = map.value.get(ethers.getAddress(res.evcAccountInfo.enabledControllers[0]))
        if (!collateral || !borrow) {
          return undefined
        }
        const cLTV = borrow?.collateralLTVs.find(ltv => ltv.collateral === collateral.address)
        const collateralValueLiquidation = res.vaultAccountInfo.liquidityInfo.collateralValueLiquidation
        const liabilityValue = res.vaultAccountInfo.liquidityInfo.liabilityValue
        const liquidationLTV = cLTV?.liquidationLTV || 0n
        const healthFixed = FixedNumber.fromValue(collateralValueLiquidation, 18).div(FixedNumber.fromValue(liabilityValue, 18))
        const userLTVFixed = healthFixed.isZero()
          ? FixedNumber.fromValue(0n, 2)
          : FixedNumber.fromValue(liquidationLTV, 2).div(healthFixed)
        const userLTV = userLTVFixed.value
        const priceFixed
          = FixedNumber.fromValue(collateral.liabilityPriceInfo.amountOutAsk || 0n, 18)
            .div(FixedNumber.fromValue(borrow.liabilityPriceInfo.amountOutBid || 1n, 18))
        const price = priceFixed.value
        const borrowedFixed = FixedNumber.fromValue(
          res.vaultAccountInfo.borrowed,
          borrow.decimals,
        )
        const supplied = borrowedFixed
          .div(userLTVFixed.div(FixedNumber.fromValue(100n)))
          .div(priceFixed).round(Number(collateral.decimals))
          .toFormat({ decimals: Number(collateral.decimals) }).value

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

    borrows = [...borrows, ...(await Promise.all(batch)).filter(o => !!o)] as AccountBorrowPosition[]
  }
  const collateralPositions = await updateCollateralPositions(eulerLensAddresses) || []
  borrowPositions.value = [...borrows, ...collateralPositions]
  isPositionsLoading.value = false
  isPositionsLoaded.value = true
}
const updateDepositPositions = async (balances: Map<string, bigint>) => {
  isDepositsLoading.value = true

  const { isReady, list } = useVaults()
  await until(isReady).toBe(true)

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
}
const updateAccount = async (tvmAddress: string | undefined, eulerLensAddresses: EulerLensAddresses) => {
  address.value = ''
  if (!tvmAddress) {
    borrowPositions.value = []
    return
  }

  try {
    const { NETWORK, TAC_FACTORY_ADDRESS, EULER_PROXY, EVM_PROVIDER_URL } = useEulerConfig()
    const provider = ethers.getDefaultProvider(EVM_PROVIDER_URL)
    const tacFactoryAbi = ['function predictSmartAccountAddress(string,address) external view returns(address)']
    const addressContract = new ethers.Contract(TAC_FACTORY_ADDRESS, tacFactoryAbi, provider)
    const accountLensContract = new ethers.Contract(eulerLensAddresses?.accountLens || '', eulerAccountLensABI, provider)
    address.value = await addressContract.predictSmartAccountAddress(Address.parse(tvmAddress).toString({ bounceable: true }), EULER_PROXY)
    account.value = (await accountLensContract.getAccountEnabledVaultsInfo(eulerCoreAddresses[NETWORK].evc, address.value)).toObject({ deep: true })
  }

  catch (e) {
    console.warn(e)
    address.value = ''
  }
}

export const useEulerAccount = () => {
  const { isLoaded: isBalancesLoaded, balances } = useWallets()
  const { friendlyAddress } = useTonConnect()
  const { eulerLensAddresses } = useEulerAddresses()

  watch(friendlyAddress, async (val) => {
    if (val) {
      await updateAccount(val, eulerLensAddresses.value)
      updateBorrowPositions(eulerLensAddresses.value)
      updateDepositPositions(balances.value)
    }
  }, { immediate: true })

  watch(isBalancesLoaded, (val) => {
    if (val) {
      updateDepositPositions(balances.value)
    }
  })
  return {
    address,
    borrowPositions,
    depositPositions,
    isPositionsLoading,
    isPositionsLoaded,
    isDepositsLoading,
    updateAccount,
    updateBorrowPositions,
    updateCollateralPositions,
    updateDepositPositions,
    totalSuppliedValue,
    totalBorrowedValue,
  }
}
