<script setup lang="ts">
import { type BorrowVaultPair, getVaultPrice } from '~/entities/vault'
import type { AccountBorrowPosition } from '~/entities/account'
import { useModal } from '~/components/ui/composables/useModal'
import { VaultBorrowApyModal, VaultSupplyApyModal } from '#components'

const { pair } = defineProps<{ pair: BorrowVaultPair | AccountBorrowPosition }>()

const modal = useModal()
const { getOpportunityOfBorrowVault, getOpportunityOfLendVault } = useMerkl()
const { withIntrinsicBorrowApy, withIntrinsicSupplyApy, getIntrinsicApy } = useIntrinsicApy()

const borrowRewardAPY = computed(() => getOpportunityOfBorrowVault(pair.borrow.asset.address)?.apr)
const collateralRewardAPY = computed(() => getOpportunityOfLendVault(pair.collateral.address)?.apr)
const supplyApyWithRewards = computed(() => withIntrinsicSupplyApy(
  nanoToValue(pair.collateral.interestRateInfo.supplyAPY, 25),
  pair.collateral.asset.symbol,
) + (collateralRewardAPY.value || 0))
const borrowApyWithRewards = computed(() => withIntrinsicBorrowApy(
  nanoToValue(pair.borrow.interestRateInfo.borrowAPY, 25),
  pair.borrow.asset.symbol,
) - (borrowRewardAPY.value || 0))

const baseSupplyApy = computed(() => nanoToValue(pair.collateral.interestRateInfo.supplyAPY, 25))
const baseBorrowApy = computed(() => nanoToValue(pair.borrow.interestRateInfo.borrowAPY, 25))
const intrinsicSupplyApy = computed(() => getIntrinsicApy(pair.collateral.asset.symbol))
const intrinsicBorrowApy = computed(() => getIntrinsicApy(pair.borrow.asset.symbol))
const supplyOpportunityInfo = computed(() => getOpportunityOfLendVault(pair.collateral.address))
const borrowOpportunityInfo = computed(() => getOpportunityOfBorrowVault(pair.borrow.asset.address))

const price = computed(() => {
  return getVaultPrice(1, pair.collateral)
    / getVaultPrice(1, pair.borrow)
})

const onSupplyInfoIconClick = () => {
  modal.open(VaultSupplyApyModal, {
    props: {
      lendingAPY: baseSupplyApy.value,
      intrinsicAPY: intrinsicSupplyApy.value,
      opportunityInfo: supplyOpportunityInfo.value,
    },
  })
}

const onBorrowInfoIconClick = () => {
  modal.open(VaultBorrowApyModal, {
    props: {
      borrowingAPY: baseBorrowApy.value,
      intrinsicAPY: intrinsicBorrowApy.value,
      opportunityInfo: borrowOpportunityInfo.value,
    },
  })
}
</script>

<template>
  <div class="bg-euler-dark-300 rounded-16 flex flex-col gap-24 p-24">
    <p class="text-h3 text-white">
      Overview
    </p>
    <div class="flex flex-col items-start gap-24">
      <VaultOverviewLabelValue
        label="Price"
      >
        ${{ formatNumber(price) }} <span class="text-euler-dark-900">
          {{ pair.collateral.asset.symbol }}/{{ pair.borrow.asset.symbol }}
        </span>
      </VaultOverviewLabelValue>
      <VaultOverviewLabelValue
        label="Supply APY"
      >
        <p class="flex items-center gap-4">
          <span>
            {{ formatNumber(supplyApyWithRewards) }}%
          </span>
          <SvgIcon
            class="!w-20 !h-20 text-euler-dark-800 cursor-pointer"
            name="question-circle"
            @click="onSupplyInfoIconClick"
          />
        </p>
      </VaultOverviewLabelValue>
      <VaultOverviewLabelValue
        label="Borrow APY"
      >
        <p class="flex items-center gap-4">
          <span>
            {{ formatNumber(borrowApyWithRewards) }}%
          </span>
          <SvgIcon
            class="!w-20 !h-20 text-euler-dark-800 cursor-pointer"
            name="question-circle"
            @click="onBorrowInfoIconClick"
          />
        </p>
      </VaultOverviewLabelValue>
      <VaultOverviewLabelValue
        label="Max LTV"
        :value="`${formatNumber(nanoToValue(pair.borrowLTV, 2), 2)}%`"
      />
      <VaultOverviewLabelValue
        label="LLTV"
        :value="`${formatNumber(nanoToValue(pair.liquidationLTV, 2), 2)}%`"
      />
    </div>
  </div>
</template>
