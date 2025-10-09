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
            :src="[position.collateral.asset.symbol].map(s => getAssetLogoUrl(s))"
            :label="position.collateral.asset.symbol"
            class="icon--40"
          />
          <div :class="$style.topCenter">
            <div class="text-euler-dark-900 p3 mb-4">
              {{ pairName }}
            </div>
            <div class="h5">
              {{ position.collateral.asset.symbol }}
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
            Supply value
          </div>
          <div class="between gap-8 right">
            <div class="text-white p3">
              ${{ formatNumber(getVaultPrice(
                nanoToValue(position.supplied, position.collateral.decimals), position.collateral,
              )) }}
            </div>
            <div class="text-euler-dark-900 p3">
              ~ {{ formatNumber(nanoToValue(position.supplied, position.collateral.decimals)) }}
              {{ position.borrow.asset.symbol }}
            </div>
          </div>
        </div>
        <div class="between">
          <div class="text-euler-dark-900 p3">
            Supply APY
          </div>
          <div
            :class="[$style.apy, nanoToValue(position.collateral.interestRateInfo.supplyAPY, 25) + (opportunityInfoForCollateral?.apr || 0) <= 0 ? 'text-red-700' : 'text-aquamarine-700']"
            class="p2"
          >
          {{ formatNumber(nanoToValue(position.collateral.interestRateInfo.supplyAPY, 25) + (opportunityInfoForCollateral?.apr || 0)) }}%
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
