<script setup lang="ts">
import { useAccount } from '@wagmi/vue'
import type { AccountBorrowPosition } from '~/entities/account'
import { getSubAccountIndex } from '~/entities/account'
import { getAssetLogoUrl } from '~/composables/useTokens'
import { useEulerProductOfVault } from '~/composables/useEulerLabels'
import { getNetAPY, getVaultPrice, getCollateralAssetPriceFromLiability, type Vault } from '~/entities/vault'

const { position } = defineProps<{ position: AccountBorrowPosition }>()

const { address } = useAccount()
const { portfolioAddress } = useEulerAccount()
const ownerAddress = computed(() => portfolioAddress.value || address.value || '')
const subAccountIndex = computed(() => {
  if (!ownerAddress.value || !position.subAccount) return 0
  return getSubAccountIndex(ownerAddress.value, position.subAccount)
})

const { getOpportunityOfBorrowVault, getOpportunityOfLendVault } = useMerkl()
const { withIntrinsicBorrowApy, withIntrinsicSupplyApy } = useIntrinsicApy()

const { name: collateralProductName } = useEulerProductOfVault(position.collateral.address)
const { name: borrowProductName } = useEulerProductOfVault(position.borrow.address)

const borrowVault = computed(() => position.borrow)
const collateralVault = computed(() => position.collateral)

const isAnyUnverified = computed(() => {
  const collateralUnverified = 'verified' in position.collateral && !position.collateral.verified
  const borrowUnverified = 'verified' in position.borrow && !position.borrow.verified
  return collateralUnverified || borrowUnverified
})

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
const collateralSupplyApy = computed(() => {
  return withIntrinsicSupplyApy(
    nanoToValue(collateralVault.value.interestRateInfo.supplyAPY || 0n, 25),
    collateralVault.value?.asset.symbol,
  )
})
const borrowApy = computed(() => withIntrinsicBorrowApy(
  nanoToValue(borrowVault.value?.interestRateInfo.borrowAPY || 0n, 25),
  borrowVault.value?.asset.symbol,
))
const collateralSupplyApyWithRewards = computed(() => collateralSupplyApy.value + (opportunityInfoForCollateral.value?.apr || 0))

const collateralValueUsd = computed(() => {
  // Collateral price ALWAYS comes from liability vault's oracle
  const priceInfo = getCollateralAssetPriceFromLiability(position.borrow, position.collateral)
  if (!priceInfo) return 0
  const amount = nanoToValue(position.supplied, position.collateral.decimals)
  return amount * nanoToValue(priceInfo.amountOutMid, 18)
})

const netAPY = computed(() => {
  return getNetAPY(
    collateralValueUsd.value,
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
    :to="`/position/${subAccountIndex}`"
    class="block no-underline text-white bg-euler-dark-500 rounded-16"
  >
    <div class="flex py-16 px-16 pb-12 border-b border-border-primary">
      <div
        class="flex flex-col gap-12 items-start w-full"
      >
        <div
          class="text-h6 text-euler-dark-900 bg-euler-dark-600 py-4 px-12 rounded-8 border border-euler-dark-700"
        >
          Position {{ subAccountIndex }}
        </div>
        <div class="flex gap-12">
          <BaseAvatar
            :src="[position.collateral.asset.symbol].map(s => getAssetLogoUrl(s))"
            :label="position.collateral.asset.symbol"
            class="icon--40"
          />
          <div>
            <div class="text-euler-dark-900 text-p3 mb-4">
              <VaultDisplayName
                :name="pairName"
                :is-unverified="isAnyUnverified"
              />
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
              ${{ formatNumber(collateralValueUsd) }}
            </div>
            <div class="text-euler-dark-900 text-p3">
              ~ {{ roundAndCompactTokens(position.supplied, position.collateral.decimals) }}
              {{ position.collateral.asset.symbol }}
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
