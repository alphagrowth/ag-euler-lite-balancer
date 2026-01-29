<script setup lang="ts">
import type { AccountBorrowPosition } from '~/entities/account'
import { getAssetLogoUrl } from '~/composables/useTokens'
import { useEulerProductOfVault } from '~/composables/useEulerLabels'
import { getNetAPY, getVaultPrice, getVaultPriceDisplay, getCollateralAssetPriceFromLiability } from '~/entities/vault'

const { index, position } = defineProps<{ index: number, position: AccountBorrowPosition }>()

const { getOpportunityOfBorrowVault, getOpportunityOfLendVault } = useMerkl()
const { withIntrinsicBorrowApy, withIntrinsicSupplyApy } = useIntrinsicApy()

const { name: collateralProductName } = useEulerProductOfVault(position.collateral.address)
const { name: borrowProductName } = useEulerProductOfVault(position.borrow.address)

const borrowVault = computed(() => position.borrow)
const collateralVault = computed(() => position.collateral)
const hasMultipleCollaterals = computed(() => (position.collaterals?.length || 0) > 1)
const collateralSymbolLabel = computed(() => {
  const symbol = position.collateral.asset.symbol
  return hasMultipleCollaterals.value ? `${symbol} & others` : symbol
})
const pairSymbols = computed(() => `${collateralSymbolLabel.value}/${position.borrow.asset.symbol}`)

// Handle escrow vaults showing "Ungoverned"
const collateralLabel = computed(() => {
  if ('type' in position.collateral && position.collateral.type === 'escrow') {
    return 'Ungoverned'
  }
  return collateralProductName || position.collateral.name
})
const borrowLabel = computed(() => {
  if ('type' in position.borrow && position.borrow.type === 'escrow') {
    return 'Ungoverned'
  }
  return borrowProductName || position.borrow.name
})

const pairName = computed(() => {
  if (collateralLabel.value === borrowLabel.value) {
    return collateralLabel.value
  }
  return `${collateralLabel.value} / ${borrowLabel.value}`
})
const liquidationPrice = computed(() => {
  const price = position.price || 0n

  if (price <= 0n) {
    return undefined
  }

  return price
})
const opportunityInfoForBorrow = computed(() => getOpportunityOfBorrowVault(borrowVault.value.asset.address || ''))
const opportunityInfoForCollateral = computed(() => getOpportunityOfLendVault(collateralVault.value.address || ''))
const collateralSupplyApy = computed(() => withIntrinsicSupplyApy(
  nanoToValue(collateralVault.value?.interestRateInfo.supplyAPY || 0n, 25),
  collateralVault.value?.asset.symbol,
))
const borrowApy = computed(() => withIntrinsicBorrowApy(
  nanoToValue(borrowVault.value?.interestRateInfo.borrowAPY || 0n, 25),
  borrowVault.value?.asset.symbol,
))

const collateralValueDisplay = computed(() => {
  const { map } = useVaults()
  const borrowVaultFromMap = map.value.get(position.borrow.address)
  if (!borrowVaultFromMap) {
    const price = getVaultPriceDisplay(position.supplied || 0n, collateralVault.value!)
    return price.hasPrice ? `$${formatNumber(price.usdValue)}` : price.display
  }
  const priceInfo = getCollateralAssetPriceFromLiability(borrowVaultFromMap, collateralVault.value!)
  if (!priceInfo) {
    const price = getVaultPriceDisplay(position.supplied || 0n, collateralVault.value!)
    return price.hasPrice ? `$${formatNumber(price.usdValue)}` : price.display
  }
  const amount = nanoToValue(position.supplied || 0n, collateralVault.value!.decimals)
  const usdValue = amount * nanoToValue(priceInfo.amountOutMid, 18)
  return `$${formatNumber(usdValue)}`
})

const borrowedValueDisplay = computed(() => {
  const price = getVaultPriceDisplay(position.borrowed || 0n, borrowVault.value!)
  return price.hasPrice ? `$${formatNumber(price.usdValue)}` : price.display
})

const netAssetValueDisplay = computed(() => {
  const { map } = useVaults()
  const borrowVaultFromMap = map.value.get(position.borrow.address)

  const borrowPrice = getVaultPriceDisplay(position.borrowed || 0n, borrowVault.value!)
  if (!borrowPrice.hasPrice) {
    return '—'
  }

  let collateralUsdValue: number | null = null

  if (borrowVaultFromMap) {
    const priceInfo = getCollateralAssetPriceFromLiability(borrowVaultFromMap, collateralVault.value!)
    if (priceInfo && priceInfo.amountOutMid > 0n && priceInfo.amountIn && priceInfo.amountIn > 0n) {
      const amount = nanoToValue(position.supplied || 0n, collateralVault.value!.decimals)
      const usdValue = amount * nanoToValue(priceInfo.amountOutMid, 18)
      collateralUsdValue = usdValue
    }
  }

  if (collateralUsdValue === null) {
    const price = getVaultPriceDisplay(position.supplied || 0n, collateralVault.value!)
    if (!price.hasPrice) {
      return '—'
    }
    collateralUsdValue = price.usdValue
  }

  if (!Number.isFinite(collateralUsdValue) || !Number.isFinite(borrowPrice.usdValue)) {
    return '—'
  }

  const net = collateralUsdValue - borrowPrice.usdValue
  if (!Number.isFinite(net)) {
    return '—'
  }

  return `$${formatNumber(net)}`
})

const currentPriceDisplay = computed(() => {
  const { map } = useVaults()
  const borrowVaultFromMap = map.value.get(position.borrow.address)
  if (!borrowVaultFromMap) {
    const price = getVaultPriceDisplay(1, collateralVault.value!)
    return price.hasPrice ? `$${formatNumber(price.usdValue)}` : price.display
  }
  const priceInfo = getCollateralAssetPriceFromLiability(borrowVaultFromMap, collateralVault.value!)
  if (!priceInfo) {
    const price = getVaultPriceDisplay(1, collateralVault.value!)
    return price.hasPrice ? `$${formatNumber(price.usdValue)}` : price.display
  }
  const usdValue = nanoToValue(priceInfo.amountOutMid, 18)
  return `$${formatNumber(usdValue)}`
})

const netAPY = computed(() => {
  return getNetAPY(
    getVaultPrice(position.supplied || 0n, collateralVault.value!),
    collateralSupplyApy.value,
    getVaultPrice(position.borrowed || 0n || 0, borrowVault.value!),
    borrowApy.value,
    opportunityInfoForCollateral.value?.apr || null,
    opportunityInfoForBorrow.value?.apr || null,
  )
})
</script>

<template>
  <NuxtLink
    :to="`/position/${index + 1}`"
    class="block no-underline text-white bg-euler-dark-500 rounded-16"
  >
    <div class="flex py-16 px-16 pb-12 border-b border-border-primary">
      <div
        class="flex flex-col gap-12 items-start w-full"
      >
        <div
          class="text-h6 text-euler-dark-900 bg-euler-dark-600 py-4 px-12 rounded-8 border border-euler-dark-700"
        >
          Position {{ index + 1 }}
        </div>
        <div class="flex gap-12">
          <BaseAvatar
            :src="[position.collateral.asset.symbol, position.borrow.asset.symbol].map(s => getAssetLogoUrl(s))"
            :label="[position.collateral.asset.symbol, position.borrow.asset.symbol]"
            class="icon--40"
          />
          <div>
            <div class="text-euler-dark-900 text-p3 mb-4">
              {{ pairName }}
            </div>
            <div class="text-h5">
              {{ pairSymbols }}
            </div>
          </div>
        </div>

      </div>
    </div>
    <div class="flex py-12 px-16 pb-16">
      <div
        class="flex flex-col gap-12 w-full"
      >
        <div class="flex justify-between">
          <div class="text-euler-dark-900 text-p3">
            Net asset value
          </div>
          <div class="flex justify-between gap-8 text-right">
            <div class="text-white text-p3">
              {{ netAssetValueDisplay }}
            </div>
          </div>
        </div>
        <div class="flex justify-between">
          <div class="text-euler-dark-900 text-p3">
            My Debt
          </div>
          <div class="flex justify-between gap-8 text-right">
            <div class="text-white text-p3">
              {{ borrowedValueDisplay }}
            </div>
            <div class="text-euler-dark-900 text-p3">
              ~ {{ roundAndCompactTokens(position.borrowed, position.borrow.decimals) }}
              {{ position.borrow.asset.symbol }}
            </div>
          </div>
        </div>
        <div class="flex justify-between">
          <div class="text-euler-dark-900 text-p3">
            Collateral value
          </div>
          <div class="flex justify-between gap-8 text-right">
            <div class="text-white text-p3">
              {{ collateralValueDisplay }}
            </div>
            <div class="text-euler-dark-900 text-p3">
              ~ {{ roundAndCompactTokens(position.supplied, position.collateral.decimals) }}
              {{ position.collateral.asset.symbol }}
            </div>
          </div>
        </div>
        <div class="flex justify-between">
          <div class="text-euler-dark-900 text-p3">
            Net APY
          </div>
          <div
            :class="[netAPY <= 0 ? 'text-red-700' : 'text-aquamarine-700']"
            class="text-p2"
          >
            {{ formatNumber(netAPY) }}%
          </div>
        </div>
        <div class="flex justify-between">
          <div class="text-euler-dark-900 text-p3">
            Health score
          </div>
          <div class="text-white text-p3">
            {{ formatNumber(nanoToValue(position.health, 18)) }}
          </div>
        </div>
        <div class="flex justify-between">
          <div class="text-euler-dark-900 text-p3">
            Current price
          </div>
          <div class="flex justify-between gap-8 text-right">
            <span class="text-white text-p3">
              {{ currentPriceDisplay }}
            </span>
            <span class="text-euler-dark-900 text-p3">
              {{ position.collateral.asset.symbol }}
            </span>
          </div>
        </div>
        <div class="flex justify-between">
          <div class="text-euler-dark-900 text-p3">
            Liquidation price
          </div>
          <div class="flex justify-between gap-8 text-right">
            <span class="text-white text-p3">
              ${{ liquidationPrice ? formatNumber(nanoToValue(liquidationPrice, 18)) : '-' }}
            </span>
            <span class="text-euler-dark-900 text-p3">
              {{ position.collateral.asset.symbol }}
            </span>
          </div>
        </div>
        <div class="flex justify-between">
          <div class="text-euler-dark-900 text-p3">
            Your LTV
          </div>
          <div class="flex justify-between items-center gap-16">
            <UiProgress
              style="width: 111px"
              :model-value="nanoToValue(position.userLTV, 18)"
              :max="nanoToValue(position.liquidationLTV, 2)"
              :color="nanoToValue(position.userLTV, 18) >= (nanoToValue(position.liquidationLTV, 2) - 2) ? 'danger' : undefined"
              size="small"
            />
            <div class="flex justify-between gap-8 text-right">
              <div class="text-white text-p3">
                {{ formatNumber(nanoToValue(position.userLTV, 18), 2) }}/{{ nanoToValue(position.liquidationLTV, 2) }}%
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </NuxtLink>
</template>
