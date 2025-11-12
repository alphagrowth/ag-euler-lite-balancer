<script setup lang="ts">
import type { AccountBorrowPosition } from '~/entities/account'
import { getAssetLogoUrl } from '~/entities/assets'
import { useEulerProductOfVault } from '~/composables/useEulerLabels'
import { getNetAPY, getVaultPrice } from '~/entities/vault'

const { index, position } = defineProps<{ index: number, position: AccountBorrowPosition }>()

const { getOpportunityOfBorrowVault, getOpportunityOfLendVault } = useMerkl()

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

const netAPY = computed(() => {
  return getNetAPY(
    getVaultPrice(position.supplied || 0n, collateralVault.value!),
    nanoToValue(collateralVault.value?.interestRateInfo.supplyAPY || 0n, 25),
    getVaultPrice(position.borrowed || 0n || 0, borrowVault.value!),
    nanoToValue(borrowVault.value?.interestRateInfo.borrowAPY || 0n, 25),
    opportunityInfoForCollateral.value?.apr || null,
    opportunityInfoForBorrow.value?.apr || null,
  )
})
</script>

<template>
  <NuxtLink
    :to="`/position/${index + 1}`"
    :class="$style.VaultItem"
    class="text-white bg-euler-dark-500 br-16"
  >
    <div :class="$style.top">
      <div
        :class="$style.portfolioWrap"
        class="column gap-12 align-start"
      >
        <div
          :class="$style.position"
          class="h6 text-euler-dark-900 bg-euler-dark-600 py-4 px-12 br-8"
        >
          Position {{ index + 1 }}
        </div>
        <div class="flex gap-12">
          <BaseAvatar
            :src="[position.collateral.asset.symbol, position.borrow.asset.symbol].map(s => getAssetLogoUrl(s))"
            :label="[position.collateral.asset.symbol, position.borrow.asset.symbol]"
            class="icon--40"
          />
          <div :class="$style.topCenter">
            <div class="text-euler-dark-900 p3 mb-4">
              {{ pairName }}
            </div>
            <div class="h5">
              {{ [position.collateral.asset.symbol, position.borrow.asset.symbol].join('/') }}
            </div>
          </div>
        </div>

      </div>
    </div>
    <div :class="$style.bottom">
      <div
        class="column gap-12"
        :class="$style.portfolioWrap"
      >
        <div class="between">
          <div class="text-euler-dark-900 p3">
            My Debt
          </div>
          <div class="between gap-8 right">
            <div class="text-white p3">
              ${{ formatNumber(getVaultPrice(position.borrowed, position.borrow)) }}
            </div>
            <div class="text-euler-dark-900 p3">
              ~ {{ formatNumber(nanoToValue(position.borrowed, position.borrow.decimals)) }}
              {{ position.borrow.asset.symbol }}
            </div>
          </div>
        </div>
        <div class="between">
          <div class="text-euler-dark-900 p3">
            Net APY
          </div>
          <div
            :class="[$style.apy, netAPY <= 0 ? 'text-red-700' : 'text-aquamarine-700']"
            class="p2"
          >
            {{ formatNumber(netAPY) }}%
          </div>
        </div>
        <div class="between">
          <div class="text-euler-dark-900 p3">
            Health score
          </div>
          <div class="text-white p3">
            {{ formatNumber(nanoToValue(position.health, 18)) }}
          </div>
        </div>
        <div class="between">
          <div class="text-euler-dark-900 p3">
            Current price
          </div>
          <div class="between gap-8 right">
            <span class="text-white p3">
              ${{ formatNumber(getVaultPrice(1, position.collateral)) }}
            </span>
            <span class="text-euler-dark-900 p3">
              {{ position.collateral.asset.symbol }}
            </span>
          </div>
        </div>
        <div class="between">
          <div class="text-euler-dark-900 p3">
            Liquidation price
          </div>
          <div class="between gap-8 right">
            <span class="text-white p3">
              ${{ liquidationPrice ? formatNumber(nanoToValue(liquidationPrice, 18)) : '-' }}
            </span>
            <span class="text-euler-dark-900 p3">
              {{ position.collateral.asset.symbol }}
            </span>
          </div>
        </div>
        <div class="between">
          <div class="text-euler-dark-900 p3">
            Your LTV
          </div>
          <div class="between align-center gap-16">
            <UiProgress
              style="width: 111px"
              :model-value="nanoToValue(position.userLTV, 18)"
              :max="nanoToValue(position.liquidationLTV, 2)"
              :color="nanoToValue(position.userLTV, 18) >= (nanoToValue(position.liquidationLTV, 2) - 2) ? 'danger' : undefined"
              size="small"
            />
            <div class="between gap-8 right">
              <div class="text-white p3">
                {{ formatNumber(nanoToValue(position.userLTV, 18), 2) }}/{{ nanoToValue(position.liquidationLTV, 2) }}%
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </NuxtLink>
</template>

<style lang="scss" module>
.VaultItem {
  display: block;
  text-decoration: none;
}

.top {
  display: flex;
  padding: 16px 16px 12px;
  border-bottom: 1px solid #1B3C5F;
}

.topRight {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}

.bottom {
  display: flex;
  padding: 12px 16px 16px;

  &._borrow {
    justify-content: space-between;
  }
}

.bottomRight {
  text-align: right;
}

.portfolioWrap {
  width: 100%;
}

.position {
  border: 1px solid var(--c-euler-dark-700);
}
</style>
