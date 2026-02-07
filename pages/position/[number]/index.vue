<script setup lang="ts">
import { useAccount } from '@wagmi/vue'
import { ethers } from 'ethers'
import { eulerAccountLensABI } from '~/entities/euler/abis'
import {
  getNetAPY,
  type Vault,
  type SecuritizeVault,
} from '~/entities/vault'
import {
  getAssetUsdValue,
  getAssetUsdValueOrZero,
  getAssetUsdPrice,
  getCollateralUsdPrice,
  getCollateralUsdValue,
  getUnitOfAccountUsdRate,
  getAssetOraclePrice,
  toUsdAmount,
  type UsdAmount,
} from '~/services/pricing/priceProvider'
import type { AccountBorrowPosition } from '~/entities/account'
import type { TxPlan } from '~/entities/txPlan'
import { formatTtl } from '~/utils/crypto-utils'
import { VaultOverviewModal, OperationReviewModal, VaultNetApyModal } from '#components'
import { useModal } from '~/components/ui/composables/useModal'
import { useToast } from '~/components/ui/composables/useToast'
import { useVaultRegistry } from '~/composables/useVaultRegistry'

const route = useRoute()
const router = useRouter()
const modal = useModal()
const { error } = useToast()
const { isConnected } = useAccount()
const { isPositionsLoaded, isPositionsLoading, getPositionBySubAccountIndex } = useEulerAccount()
const { getOpportunityOfBorrowVault, getOpportunityOfLendVault } = useMerkl()
const { withIntrinsicBorrowApy, withIntrinsicSupplyApy, getIntrinsicApy } = useIntrinsicApy()
const { buildDisableCollateralPlan, executeTxPlan } = useEulerOperations()
const {
  runSimulation: runDisableCollateralSimulation,
  simulationError: disableCollateralSimulationError,
  clearSimulationError: clearDisableCollateralSimulationError,
} = useTxPlanSimulation()

const positionIndex = route.params.number as string

type PositionCollateral = {
  vault: Vault | SecuritizeVault
  assets: bigint
}

const position: Ref<AccountBorrowPosition | undefined> = ref()
const isSubmitting = ref(false)
const collateralItems = ref<PositionCollateral[]>([])
const isCollateralsLoading = ref(false)
const disableCollateralErrorVault = ref<string | null>(null)

const { isReady: isVaultsReady } = useVaults()
const { getOrFetch } = useVaultRegistry()
const { eulerLensAddresses, isReady: isEulerAddressesReady, loadEulerConfig } = useEulerAddresses()
const { EVM_PROVIDER_URL } = useEulerConfig()

const borrowVault = computed(() => position.value?.borrow)
const collateralVault = computed(() => position.value?.collateral)
const primaryCollateralAddress = computed(() => position.value ? ethers.getAddress(position.value.collateral.address) : '')
const collateralCount = computed(() => position.value?.collaterals?.length ?? collateralItems.value.length)
const collateralSymbolLabel = computed(() => {
  if (!position.value) {
    return ''
  }
  const symbol = position.value.collateral.asset.symbol
  return collateralCount.value > 1 ? `${symbol} & others` : symbol
})
const pairAssetsLabel = computed(() => {
  if (!position.value) {
    return ''
  }
  return `${collateralSymbolLabel.value}/${position.value.borrow.asset.symbol}`
})
const pairAssets = computed(() => {
  if (!collateralVault.value || !borrowVault.value) return []
  return [collateralVault.value.asset, borrowVault.value.asset]
})
const hasNoBorrow = computed(() => position.value?.borrow.borrow === 0n)
const isEligibleForLiquidation = computed(() => {
  if (!position.value || position.value.liabilityValueLiquidation === 0n) return false
  return position.value.liabilityValueLiquidation > position.value.collateralValueLiquidation
})

const opportunityInfoForBorrow = computed(() => getOpportunityOfBorrowVault(borrowVault.value?.asset.address || ''))
const opportunityInfoForCollateral = computed(() => getOpportunityOfLendVault(collateralVault.value?.address || ''))
const baseSupplyAPY = computed(() => {
  return nanoToValue(collateralVault.value?.interestRateInfo.supplyAPY || 0n, 25)
})
const baseBorrowAPY = computed(() => nanoToValue(borrowVault.value?.interestRateInfo.borrowAPY || 0n, 25))
const intrinsicSupplyAPY = computed(() => getIntrinsicApy(collateralVault.value?.asset.symbol))
const intrinsicBorrowAPY = computed(() => getIntrinsicApy(borrowVault.value?.asset.symbol))
const collateralSupplyApy = computed(() => withIntrinsicSupplyApy(
  baseSupplyAPY.value,
  collateralVault.value?.asset.symbol,
))
const borrowApy = computed(() => withIntrinsicBorrowApy(
  baseBorrowAPY.value,
  borrowVault.value?.asset.symbol,
))
const borrowApyWithRewards = computed(() => borrowApy.value - (opportunityInfoForBorrow.value?.apr || 0))

// Pre-computed collateral row data (USD values computed asynchronously)
const collateralRowsData = ref<{
  value: UsdAmount
  unitPriceUsd: number
  oraclePriceUsd: number
  supplyApy: number
  supplyApyWithRewards: number
}[]>([])

const collateralRows = computed(() => {
  return collateralItems.value.map((item, index) => {
    const data = collateralRowsData.value[index] || {
      value: { usd: 0, hasPrice: false },
      unitPriceUsd: 0,
      oraclePriceUsd: 0,
      supplyApy: 0,
      supplyApyWithRewards: 0,
    }
    return {
      ...item,
      ...data,
    }
  })
})

// Update collateral rows data when collateral items change
watchEffect(async () => {
  if (!position.value || !collateralItems.value.length) {
    collateralRowsData.value = []
    return
  }

  const results = await Promise.all(
    collateralItems.value.map(async (item) => {
      const opportunity = getOpportunityOfLendVault(item.vault.address || '')
      const supplyApy = withIntrinsicSupplyApy(
        nanoToValue(item.vault.interestRateInfo.supplyAPY || 0n, 25),
        item.vault.asset.symbol,
      )

      // Collateral price ALWAYS comes from liability vault's oracle, converted to USD
      let unitPriceUsd = 0
      let oraclePriceUsd = 0

      const valueRaw = await getCollateralUsdValue(item.assets, position.value!.borrow, item.vault as Vault, 'off-chain')
      const priceInfo = await getCollateralUsdPrice(position.value!.borrow, item.vault as Vault, 'off-chain')
      if (priceInfo) {
        unitPriceUsd = nanoToValue(priceInfo.amountOutMid, 18)
      }

      const oraclePriceInfo = await getCollateralUsdPrice(position.value!.borrow, item.vault as Vault, 'on-chain')
      if (oraclePriceInfo) {
        oraclePriceUsd = nanoToValue(oraclePriceInfo.amountOutMid, 18)
      }

      return {
        value: toUsdAmount(valueRaw),
        unitPriceUsd,
        oraclePriceUsd,
        supplyApy,
        supplyApyWithRewards: supplyApy + (opportunity?.apr || 0),
      }
    }),
  )

  collateralRowsData.value = results
})

// Pre-computed collateral USD value (async)
const collateralValue = ref<UsdAmount>({ usd: 0, hasPrice: false })

watchEffect(async () => {
  if (!position.value) {
    collateralValue.value = { usd: 0, hasPrice: false }
    return
  }

  // Collateral price ALWAYS comes from liability vault's oracle, converted to USD
  if (!collateralItems.value.length) {
    collateralValue.value = toUsdAmount(await getCollateralUsdValue(position.value.supplied, position.value.borrow, position.value.collateral as Vault, 'off-chain'))
    return
  }

  // For multiple collaterals, sum up using liability vault's oracle for each
  const totals = await Promise.all(
    collateralItems.value.map(item =>
      getCollateralUsdValue(item.assets, position.value!.borrow, item.vault as Vault, 'off-chain'),
    ),
  )
  const allHavePrice = totals.every(v => v !== undefined)
  collateralValue.value = {
    usd: totals.reduce<number>((sum, val) => sum + (val ?? 0), 0),
    hasPrice: allHavePrice,
  }
})

// Pre-computed borrow market value in USD (async)
const borrowMarketValue = ref<UsdAmount>({ usd: 0, hasPrice: false })

watchEffect(async () => {
  if (!position.value || !borrowVault.value) {
    borrowMarketValue.value = { usd: 0, hasPrice: false }
    return
  }

  borrowMarketValue.value = toUsdAmount(await getAssetUsdValue(position.value.borrowed, borrowVault.value, 'off-chain'))
})

// Net asset value in USD: sync computed so it tracks both collateralValue and borrowMarketValue
const netAssetValue = computed<UsdAmount>(() => {
  if (!position.value) return { usd: 0, hasPrice: false }
  if (!collateralValue.value.hasPrice || !borrowMarketValue.value.hasPrice) {
    return { usd: 0, hasPrice: false }
  }
  return {
    usd: collateralValue.value.usd - borrowMarketValue.value.usd,
    hasPrice: true,
  }
})

// Pre-computed unit of account USD price (async)
const unitOfAccountUsdPrice = ref<number>(0)
watchEffect(async () => {
  if (!position.value) {
    unitOfAccountUsdPrice.value = 0
    return
  }
  const rate = await getUnitOfAccountUsdRate(borrowVault.value)
  unitOfAccountUsdPrice.value = rate ? nanoToValue(rate, 18) : 0
})

// Pre-computed liquidation price (depends on async unitOfAccountUsdPrice)
const liquidationPrice = computed(() => {
  if (!position.value) return undefined

  const price = position.value.price || 0n

  if (price <= 0n) {
    return undefined
  }

  const unitPrice = unitOfAccountUsdPrice.value
  if (!unitPrice) {
    return undefined
  }

  return nanoToValue(price, 18) * unitPrice
})
// Pre-computed borrow liquidation price (async)
const borrowLiquidationPrice = ref<number | undefined>(undefined)

watchEffect(async () => {
  if (!position.value) {
    borrowLiquidationPrice.value = undefined
    return
  }

  const collateralValueLiquidation = position.value.collateralValueLiquidation
  const liabilityValueBorrowing = position.value.liabilityValueBorrowing

  if (liabilityValueBorrowing === 0n || collateralValueLiquidation === 0n) {
    borrowLiquidationPrice.value = undefined
    return
  }

  const multiplier = nanoToValue(collateralValueLiquidation, 18) / nanoToValue(liabilityValueBorrowing, 18)
  const borrowPriceInfo = await getAssetUsdPrice(borrowVault.value, 'off-chain')
  const currentBorrowPrice = borrowPriceInfo ? nanoToValue(borrowPriceInfo.amountOutMid, 18) : 0

  if (!currentBorrowPrice) {
    borrowLiquidationPrice.value = undefined
    return
  }

  borrowLiquidationPrice.value = currentBorrowPrice * multiplier
})
const timeToLiquidationDisplay = computed(() => {
  if (!position.value) {
    return '-'
  }

  const result = formatTtl(position.value.timeToLiquidation)
  return result?.display || '-'
})
// Net APY: sync computed so it tracks collateralValue, borrowMarketValue, and APY values
const netAPY = computed(() => {
  if (!position.value || !borrowVault.value) return 0
  return getNetAPY(
    collateralValue.value.usd,
    collateralSupplyApy.value,
    borrowMarketValue.value.usd,
    borrowApy.value,
    opportunityInfoForCollateral.value?.apr || null,
    opportunityInfoForBorrow.value?.apr || null,
  )
})

const isPrimaryCollateral = (vault: Vault | SecuritizeVault) => {
  if (!primaryCollateralAddress.value) {
    return false
  }

  return ethers.getAddress(vault.address) === primaryCollateralAddress.value
}

// Pre-computed borrow oracle price for display (always on-chain)
const borrowOraclePrice = ref(0)
const hasBorrowPrice = ref(false)

watchEffect(async () => {
  if (!borrowVault.value) {
    borrowOraclePrice.value = 0
    hasBorrowPrice.value = false
    return
  }

  // Oracle price MUST always use on-chain source
  const priceInfo = await getAssetUsdPrice(borrowVault.value, 'on-chain')
  if (priceInfo) {
    borrowOraclePrice.value = nanoToValue(priceInfo.amountOutMid, 18)
    hasBorrowPrice.value = true
  }
  else {
    borrowOraclePrice.value = 0
    hasBorrowPrice.value = false
  }
})

// Pre-computed borrow unit price (1 unit in USD) for display
const borrowUnitPrice = ref<UsdAmount>({ usd: 0, hasPrice: false })

watchEffect(async () => {
  if (!position.value?.borrow) {
    borrowUnitPrice.value = { usd: 0, hasPrice: false }
    return
  }

  const priceInfo = await getAssetUsdPrice(position.value.borrow, 'off-chain')
  borrowUnitPrice.value = priceInfo
    ? { usd: nanoToValue(priceInfo.amountOutMid, 18), hasPrice: true }
    : { usd: 0, hasPrice: false }
})

const isDisableCollateralError = (vault: Vault | SecuritizeVault) => {
  if (!disableCollateralErrorVault.value) {
    return false
  }
  try {
    return ethers.getAddress(vault.address) === disableCollateralErrorVault.value
  }
  catch {
    return false
  }
}

const loadCollaterals = async () => {
  if (!position.value) {
    collateralItems.value = []
    return
  }

  const collateralAddresses = position.value.collaterals?.length
    ? position.value.collaterals
    : [position.value.collateral.address]

  const normalized = collateralAddresses.reduce<string[]>((acc, address) => {
    try {
      acc.push(ethers.getAddress(address))
    }
    catch {
      return acc
    }
    return acc
  }, [])

  const primaryAddress = ethers.getAddress(position.value.collateral.address)
  const unique = Array.from(new Set(normalized))
  const orderedAddresses = [primaryAddress, ...unique.filter(address => address !== primaryAddress)]

  isCollateralsLoading.value = true

  try {
    if (!isEulerAddressesReady.value) {
      await loadEulerConfig()
    }

    await until(isVaultsReady).toBe(true)

    const lensAddress = eulerLensAddresses.value?.accountLens
    if (!lensAddress) {
      throw new Error('Account lens address is not available')
    }

    const provider = ethers.getDefaultProvider(EVM_PROVIDER_URL)
    const accountLensContract = new ethers.Contract(lensAddress, eulerAccountLensABI, provider)

    const items = await Promise.all(
      orderedAddresses.map(async (address) => {
        try {
          const vault = await getOrFetch(address) as Vault | SecuritizeVault | undefined
          let assets = 0n

          try {
            const res = await accountLensContract.getAccountInfo(position.value!.subAccount, address)
            assets = res.vaultAccountInfo.assets
          }
          catch {
            if (address === primaryAddress) {
              assets = position.value!.supplied
            }
          }

          return { vault, assets }
        }
        catch (e) {
          console.warn('[Position] failed to load collateral vault', address, e)
          return null
        }
      }),
    )

    collateralItems.value = items.filter((item): item is PositionCollateral => !!item)
  }
  catch (e) {
    console.warn('[Position] failed to load collaterals', e)
  }
  finally {
    isCollateralsLoading.value = false
  }
}

const disableCollateral = async (vault: Vault) => {
  clearDisableCollateralSimulationError()
  disableCollateralErrorVault.value = null
  let plan: TxPlan | null = null
  try {
    plan = await buildDisableCollateralPlan(
      position.value!.subAccount,
      vault.address,
      position.value!.borrow.address,
    )
  }
  catch (e) {
    console.warn('[OperationReviewModal] failed to build plan', e)
  }

  if (plan) {
    const ok = await runDisableCollateralSimulation(plan)
    if (!ok) {
      disableCollateralErrorVault.value = ethers.getAddress(vault.address)
      return
    }
  }

  modal.open(OperationReviewModal, {
    props: {
      type: 'disableCollateral',
      asset: position.value!.borrow.asset,
      amount: '0',
      plan: plan || undefined,
      subAccount: position.value?.subAccount,
      hasBorrows: (position.value?.borrowed || 0n) > 0n,
      onConfirm: () => {
        setTimeout(() => {
          send(vault.address)
        }, 400)
      },
    },
  })
}
const send = async (collateralAddress: string) => {
  try {
    isSubmitting.value = true
    const txPlan = await buildDisableCollateralPlan(
      position.value!.subAccount,
      collateralAddress,
      position.value!.borrow.address,
    )
    await executeTxPlan(txPlan)

    modal.close()
    setTimeout(() => {
      router.replace('/portfolio')
    }, 400)
  }
  catch (e) {
    error('Transaction failed')
    console.warn(e)
  }
  finally {
    isSubmitting.value = false
  }
}
const load = async () => {
  // Redirect to portfolio if not connected
  if (!isConnected.value) {
    router.replace('/portfolio')
    return
  }

  try {
    await until(isPositionsLoaded).toBe(true)
    position.value = getPositionBySubAccountIndex(+positionIndex)
    if (position.value) {
      collateralItems.value = [{
        vault: position.value.collateral as Vault,
        assets: position.value.supplied,
      }]
      // Only load additional collaterals if position has multiple
      if (position.value.collaterals?.length && position.value.collaterals.length > 1) {
        await loadCollaterals()
      }
    }
    else {
      collateralItems.value = []
    }
  }
  catch (e) {
    showError('Unable to load Position')
    console.warn(e)
  }
}
const openCollateralInfoModal = (vault: Vault | SecuritizeVault) => {
  const isSecuritize = 'type' in vault && vault.type === 'securitize'
  modal.open(VaultOverviewModal, {
    props: isSecuritize
      ? { securitizeVault: vault as SecuritizeVault }
      : { vault: vault as Vault },
  })
}
const openPairInfoModal = () => {
  const allCollateralVaults = collateralItems.value.map(item => item.vault)
  modal.open(VaultOverviewModal, {
    props: {
      pair: position.value,
      collateralVaults: allCollateralVaults,
    },
  })
}
const onNetApyInfoIconClick = async () => {
  if (!position.value) return

  const supplyUSD = await getAssetUsdValueOrZero(position.value.supplied || 0n, collateralVault.value!, 'off-chain')
  const borrowUSD = await getAssetUsdValueOrZero(position.value.borrowed || 0n, borrowVault.value!, 'off-chain')

  modal.open(VaultNetApyModal, {
    props: {
      supplyUSD,
      borrowUSD,
      baseSupplyAPY: baseSupplyAPY.value,
      baseBorrowAPY: baseBorrowAPY.value,
      intrinsicSupplyAPY: intrinsicSupplyAPY.value,
      intrinsicBorrowAPY: intrinsicBorrowAPY.value,
      supplyRewardAPY: opportunityInfoForCollateral.value?.apr || null,
      borrowRewardAPY: opportunityInfoForBorrow.value?.apr || null,
      netAPY: netAPY.value,
      supplyOpportunityInfo: opportunityInfoForCollateral.value,
      borrowOpportunityInfo: opportunityInfoForBorrow.value,
    },
  })
}
watch(isConnected, () => {
  load()
}, { immediate: true })
</script>

<template>
  <section class="flex flex-col gap-16 min-h-[calc(100dvh-178px)]">
    <template v-if="isPositionsLoading">
      <div class="h-[calc(100dvh-178px)] flex items-center justify-center">
        <UiLoader class="text-neutral-500" />
      </div>
    </template>
    <template v-else-if="position">
      <VaultLabelsAndAssets
        :vault="position.collateral"
        :assets="pairAssets"
        :assets-label="pairAssetsLabel"
      />

      <div
        v-if="!hasNoBorrow"
        class="flex flex-col gap-16 p-16 rounded-12 border border-line-default bg-card shadow-card"
      >
        <div class="flex justify-between items-center">
          <div class="text-p2 text-neutral-500">
            Net APY
          </div>
          <div class="text-h5 text-neutral-800 flex justify-end items-center gap-4">
            {{ formatNumber(netAPY) }}%
            <SvgIcon
              class="!w-24 !h-24 text-neutral-400 cursor-pointer"
              name="info-circle"
              @click="onNetApyInfoIconClick"
            />
          </div>
        </div>
        <div class="flex justify-between items-center">
          <div class="text-p2 text-neutral-500">
            Net asset value
          </div>
          <div class="text-h5 text-neutral-800">
            {{ isCollateralsLoading ? '-' : netAssetValue.hasPrice ? formatCompactUsdValue(netAssetValue.usd) : '-' }}
          </div>
        </div>
      </div>
      <div
        v-if="!hasNoBorrow"
        class="rounded-12 bg-card border border-line-default shadow-card p-16"
      >
        <div class="text-h4 text-neutral-800 flex items-center flex-wrap gap-12 mb-16">
          Position risk

          <div class="text-h6 text-content-secondary bg-surface-elevated py-4 px-12 rounded-8 border border-line-default">
            Position {{ positionIndex }}
          </div>
        </div>
        <div class="flex justify-between gap-8 flex-wrap mb-16">
          <div class="text-neutral-500 text-p3">
            Health score
          </div>
          <div class="text-neutral-800 text-p3">
            {{ formatNumber(nanoToValue(position.health, 18)) }}
          </div>
        </div>
        <div class="flex justify-between gap-8 flex-wrap mb-16">
          <div class="text-neutral-500 text-p3">
            Time to liquidation
          </div>
          <div class="text-neutral-800 text-p3">
            {{ timeToLiquidationDisplay }}
          </div>
        </div>
        <div class="flex justify-between gap-8 flex-wrap mb-12">
          <div class="text-neutral-500 text-p3">
            Your LTV
          </div>
          <div class="text-neutral-800 text-p3">
            {{ formatNumber(nanoToValue(position.userLTV, 18), 2) }}/{{ nanoToValue(position.liquidationLTV, 2) }}%
          </div>
        </div>
        <UiProgress
          :model-value="nanoToValue(position.userLTV, 18)"
          :max="nanoToValue(position.liquidationLTV, 2)"
          :color="nanoToValue(position.userLTV, 18) >= (nanoToValue(position.liquidationLTV, 2) - 2) ? 'danger' : undefined"
          size="small"
        />
      </div>
      <div
        v-if="!hasNoBorrow"
        class="cursor-pointer"
        @click="openPairInfoModal"
      >
        <div class="mb-12 text-h4 text-neutral-800">
          Borrow
        </div>
        <div class="rounded-12 bg-card border border-line-default shadow-card">
          <div class="flex gap-16 p-16 pb-12 border-b border-line-default">
            <VaultLabelsAndAssets
              :vault="position.borrow"
              :assets="[position.borrow.asset]"
            />
          </div>
          <div class="pt-12 px-16 pb-16">
            <div class="flex justify-between gap-8 flex-wrap mb-16">
              <div class="text-neutral-500 text-p3">
                Market value
              </div>
              <div class="flex justify-between gap-8 justify-self-end">
                <div class="text-neutral-800 text-p3">
                  {{ borrowMarketValue.hasPrice
                    ? formatCompactUsdValue(borrowMarketValue.usd)
                    : `${roundAndCompactTokens(position.borrowed, borrowVault.decimals)} ${borrowVault.asset.symbol}`
                  }}
                </div>
                <div
                  v-if="borrowMarketValue.hasPrice"
                  class="text-neutral-500 text-p3"
                >
                  ~ {{ roundAndCompactTokens(position.borrowed, borrowVault.decimals) }} {{ borrowVault.asset.symbol }}
                </div>
              </div>
            </div>
            <div class="flex justify-between gap-8 flex-wrap mb-16">
              <div class="text-neutral-500 text-p3">
                Borrow APY
              </div>
              <div class="text-neutral-800 text-p3">
                {{ formatNumber(borrowApyWithRewards) }}%
              </div>
            </div>
            <div class="flex justify-between gap-8 flex-wrap mb-12">
              <div class="text-neutral-500 text-p3">
                Current price
              </div>
              <div class="text-neutral-800 text-p3">
                {{ borrowUnitPrice.hasPrice ? formatUsdValue(borrowUnitPrice.usd) : '-' }}
              </div>
            </div>
            <div class="flex justify-between gap-8 flex-wrap mb-12">
              <div class="text-neutral-500 text-p3">
                Oracle price
              </div>
              <div class="text-neutral-800 text-p3">
                {{
                  borrowOraclePrice
                    ? formatUsdValue(borrowOraclePrice)
                    : '-'
                }}
              </div>
            </div>
            <div class="flex justify-between gap-8 flex-wrap mb-12">
              <div class="text-neutral-500 text-p3">
                Liquidation price
              </div>
              <div class="text-neutral-800 text-p3">
                ${{ borrowLiquidationPrice ? formatNumber(borrowLiquidationPrice) : '-' }}
              </div>
            </div>
            <div
              class="flex justify-between gap-8"
              @click.stop
            >
              <UiButton
                size="medium"
                variant="primary"
                rounded
                :disabled="isEligibleForLiquidation"
                :to="isEligibleForLiquidation ? undefined : `/position/${positionIndex}/multiply`"
              >
                Multiply
              </UiButton>
              <UiButton
                size="medium"
                variant="primary-stroke"
                rounded
                :disabled="isEligibleForLiquidation"
                :to="isEligibleForLiquidation ? undefined : `/position/${positionIndex}/borrow`"
              >
                Borrow
              </UiButton>
              <UiButton
                size="medium"
                variant="primary-stroke"
                rounded
                :to="`/position/${positionIndex}/repay`"
              >
                Repay
              </UiButton>
              <UiButton
                size="medium"
                variant="primary-stroke"
                rounded
                :to="`/position/${positionIndex}/borrow/swap`"
              >
                Debt swap
              </UiButton>
            </div>
          </div>
        </div>
      </div>
      <div>
        <div class="mb-12 text-h4 text-neutral-800">
          {{ !hasNoBorrow ? 'Collateral' : 'Deposit' }}
        </div>
        <div class="flex flex-col gap-12">
          <div
            v-for="collateral in collateralRows"
            :key="collateral.vault.address"
            class="rounded-12 bg-card border border-line-default shadow-card cursor-pointer"
            @click="openCollateralInfoModal(collateral.vault)"
          >
            <div class="flex gap-16 p-16 pb-12 border-b border-line-default">
              <VaultLabelsAndAssets
                :vault="collateral.vault"
                :assets="[collateral.vault.asset]"
              />
            </div>
            <div class="pt-12 px-16 pb-16">
              <div class="flex justify-between gap-8 flex-wrap mb-16">
                <div class="text-neutral-500 text-p3">
                  {{ !hasNoBorrow ? 'Market value' : 'Supply value' }}
                </div>
                <div class="flex justify-between gap-8 justify-self-end">
                  <div class="text-neutral-800 text-p3">
                    {{ collateral.value.hasPrice
                      ? formatCompactUsdValue(collateral.value.usd)
                      : `${roundAndCompactTokens(collateral.assets, collateral.vault.decimals)} ${collateral.vault.asset.symbol}`
                    }}
                  </div>
                  <div
                    v-if="collateral.value.hasPrice"
                    class="text-neutral-500 text-p3"
                  >
                    ~ {{ roundAndCompactTokens(collateral.assets, collateral.vault.decimals) }}
                    {{ collateral.vault.asset.symbol }}
                  </div>
                </div>
              </div>
              <div class="flex justify-between gap-8 flex-wrap mb-16">
                <div class="text-neutral-500 text-p3">
                  Supply APY
                </div>
                <div class="text-neutral-800 text-p3">
                  {{ formatNumber(collateral.supplyApyWithRewards) }}%
                </div>
              </div>
              <div class="flex justify-between gap-8 flex-wrap mb-16">
                <div class="text-neutral-500 text-p3">
                  Current price
                </div>
                <div class="text-neutral-800 text-p3">
                  {{ collateral.unitPriceUsd > 0 ? formatUsdValue(collateral.unitPriceUsd) : '-' }}
                </div>
              </div>
              <div class="flex justify-between gap-8 flex-wrap mb-16">
                <div class="text-neutral-500 text-p3">
                  Oracle price
                </div>
                <div class="text-neutral-800 text-p3">
                  {{ collateral.oraclePriceUsd > 0
                    ? formatUsdValue(collateral.oraclePriceUsd)
                    : '-' }}
                </div>
              </div>
              <div
                v-if="!hasNoBorrow && isPrimaryCollateral(collateral.vault)"
                class="flex justify-between gap-8 flex-wrap mb-16"
              >
                <div class="text-neutral-500 text-p3">
                  Liquidation price
                </div>
                <div class="text-neutral-800 text-p3">
                  ${{ liquidationPrice ? formatNumber(liquidationPrice) : '-' }}
                </div>
              </div>
              <div
                v-if="!hasNoBorrow && isPrimaryCollateral(collateral.vault)"
                class="flex justify-between gap-8 flex-wrap mb-16"
              >
                <div class="text-neutral-500 text-p3">
                  LLTV
                </div>
                <div class="text-neutral-800 text-p3">
                  {{ formatNumber(nanoToValue(position.liquidationLTV, 2)) }}%
                </div>
              </div>
              <div
                v-if="!hasNoBorrow"
                class="flex gap-8"
                @click.stop
              >
                <UiButton
                  size="medium"
                  variant="primary"
                  rounded
                  :to="`/position/${positionIndex}/supply?collateral=${collateral.vault.address}`"
                >
                  Supply
                </UiButton>
                <UiButton
                  size="medium"
                  variant="primary-stroke"
                  rounded
                  :disabled="isEligibleForLiquidation"
                  :to="isEligibleForLiquidation ? undefined : `/position/${positionIndex}/withdraw?collateral=${collateral.vault.address}`"
                >
                  Withdraw
                </UiButton>
                <UiButton
                  size="medium"
                  variant="primary-stroke"
                  rounded
                  :to="`/position/${positionIndex}/collateral/swap?collateral=${collateral.vault.address}`"
                >
                  Collateral swap
                </UiButton>
              </div>
              <div
                v-else
                @click.stop
              >
                <UiButton
                  size="medium"
                  variant="primary"
                  rounded
                  :loading="isSubmitting"
                  @click="disableCollateral(collateral.vault)"
                >
                  Disable collateral
                </UiButton>
                <UiToast
                  v-if="disableCollateralSimulationError && isDisableCollateralError(collateral.vault)"
                  class="mt-12"
                  title="Error"
                  variant="error"
                  :description="disableCollateralSimulationError"
                  size="compact"
                />
              </div>
            </div>
          </div>
          <div
            v-if="!collateralRows.length && isCollateralsLoading"
            class="flex items-center justify-center rounded-12 bg-card border border-line-default p-16"
          >
            <UiLoader class="text-neutral-500" />
          </div>
        </div>
      </div>

      <div class="mt-auto flex flex-col gap-8">
        <UiButton
          size="large"
          variant="primary-stroke"
          @click="openPairInfoModal"
        >
          Position information
        </UiButton>
      </div>
    </template>
    <template v-else>
      Position not found
    </template>
  </section>
</template>
