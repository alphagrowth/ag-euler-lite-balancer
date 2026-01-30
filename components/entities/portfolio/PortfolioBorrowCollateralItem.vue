<script setup lang="ts">
import type { AccountBorrowPosition } from '~/entities/account'
import { getAssetLogoUrl } from '~/composables/useTokens'
import { useEulerProductOfVault } from '~/composables/useEulerLabels'
import { getNetAPY, getVaultPrice } from '~/entities/vault'

const { index, position } = defineProps<{ index: number, position: AccountBorrowPosition }>()

const { getOpportunityOfBorrowVault, getOpportunityOfLendVault } = useMerkl()
const { withIntrinsicBorrowApy, withIntrinsicSupplyApy } = useIntrinsicApy()

const { name: collateralProductName } = useEulerProductOfVault(position.collateral.address)
const { name: borrowProductName } = useEulerProductOfVault(position.borrow.address)

const borrowVault = computed(() => position.borrow)
const collateralVault = computed(() => position.collateral)

const collateralLabel = computed(() => {
  if ('type' in position.collateral && position.collateral.type === 'escrow') {
    return 'Escrowed collateral'
  }
  return collateralProductName || position.collateral.name
})
const borrowLabel = computed(() => borrowProductName || position.borrow.name)

const pairName = computed(() => {
  if (collateralLabel.value === borrowLabel.value) {
    return collateralLabel.value
  }
  return `${collateralLabel.value} / ${borrowLabel.value}`
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
const collateralSupplyApyWithRewards = computed(() => collateralSupplyApy.value + (opportunityInfoForCollateral.value?.apr || 0))

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
            :src="[position.collateral.asset.symbol].map(s => getAssetLogoUrl(s))"
            :label="position.collateral.asset.symbol"
            class="icon--40"
          />
          <div>
            <div class="text-euler-dark-900 text-p3 mb-4">
              {{ pairName }}
            </div>
            <div class="text-h5">
              {{ position.collateral.asset.symbol }}
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
            Supply value
          </div>
          <div class="flex justify-between gap-8 text-right">
            <div class="text-white text-p3">
              ${{ formatNumber(getVaultPrice(
                nanoToValue(position.supplied, position.collateral.decimals), position.collateral,
              )) }}
            </div>
            <div class="text-euler-dark-900 text-p3">
              ~ {{ roundAndCompactTokens(position.supplied, position.collateral.decimals) }}
              {{ position.borrow.asset.symbol }}
            </div>
          </div>
        </div>
        <div class="flex justify-between">
          <div class="text-euler-dark-900 text-p3">
            Supply APY
          </div>
          <div
            :class="[collateralSupplyApyWithRewards <= 0 ? 'text-red-700' : 'text-aquamarine-700']"
            class="text-p2"
          >
            {{ formatNumber(collateralSupplyApyWithRewards) }}%
          </div>
        </div>
      </div>
    </div>
  </NuxtLink>
</template>
