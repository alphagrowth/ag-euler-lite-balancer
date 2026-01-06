<script setup lang="ts">
import { type BorrowVaultPair, getVaultPrice } from '~/entities/vault'
import type { AccountBorrowPosition } from '~/entities/account'

const { pair } = defineProps<{ pair: BorrowVaultPair | AccountBorrowPosition }>()

const { getOpportunityOfBorrowVault, getOpportunityOfLendVault } = useMerkl()
const { withIntrinsicBorrowApy, withIntrinsicSupplyApy } = useIntrinsicApy()

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

const price = computed(() => {
  return getVaultPrice(1, pair.collateral)
    / getVaultPrice(1, pair.borrow)
})
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
        :value="`${formatNumber(supplyApyWithRewards)}%`"
      />
      <VaultOverviewLabelValue
        label="Borrow APY"
        :value="`${formatNumber(borrowApyWithRewards)}%`"
      />
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
