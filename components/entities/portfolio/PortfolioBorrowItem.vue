<script setup lang="ts">
import type { AccountBorrowPosition } from '~/entities/account'
import { getAssetLogoUrl } from '~/composables/useTokens'
import { useEulerProductOfVault } from '~/composables/useEulerLabels'
import { getNetAPY, getVaultPrice } from '~/entities/vault'

const { index, position } = defineProps<{ index: number, position: AccountBorrowPosition }>()

const { getOpportunityOfBorrowVault, getOpportunityOfLendVault } = useMerkl()
const { withIntrinsicBorrowApy, withIntrinsicSupplyApy } = useIntrinsicApy()

const { name: collateralName } = useEulerProductOfVault(position.collateral.address)
const { name: borrowName } = useEulerProductOfVault(position.borrow.address)

const borrowVault = computed(() => position.borrow)
const collateralVault = computed(() => position.collateral)
const pairName = computed(() => {
  if (!collateralName || !borrowName) {
    return `${position.collateral.name}/${position.borrow.name}`
  }
  if (collateralName === borrowName) {
    return collateralName
  }
  return `${collateralName}/${borrowName}`
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
              {{ [position.collateral.asset.symbol, position.borrow.asset.symbol].join('/') }}
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
              ${{ formatNumber(getVaultPrice(position.supplied, position.collateral) - getVaultPrice(position.borrowed, position.borrow)) }}
            </div>
          </div>
        </div>
        <div class="flex justify-between">
          <div class="text-euler-dark-900 text-p3">
            My Debt
          </div>
          <div class="flex justify-between gap-8 text-right">
            <div class="text-white text-p3">
              ${{ formatNumber(getVaultPrice(position.borrowed, position.borrow)) }}
            </div>
            <div class="text-euler-dark-900 text-p3">
              ~ {{ roundAndCompactTokens(position.borrowed, position.borrow.decimals) }}
              {{ position.borrow.asset.symbol }}
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
              ${{ formatNumber(getVaultPrice(1, position.collateral)) }}
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
