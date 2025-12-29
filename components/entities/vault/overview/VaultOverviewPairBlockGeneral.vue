<script setup lang="ts">
import { type BorrowVaultPair, getVaultPrice } from '~/entities/vault'
import type { AccountBorrowPosition } from '~/entities/account'

const { pair } = defineProps<{ pair: BorrowVaultPair | AccountBorrowPosition }>()

const { getOpportunityOfBorrowVault, getOpportunityOfLendVault } = useMerkl()

const borrowRewardAPY = computed(() => getOpportunityOfBorrowVault(pair.borrow.asset.address)?.apr)
const collateralRewardAPY = computed(() => getOpportunityOfLendVault(pair.collateral.address)?.apr)

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
        :value="`${formatNumber(nanoToValue(pair.collateral.interestRateInfo.supplyAPY, 25) + (collateralRewardAPY || 0))}%`"
      />
      <VaultOverviewLabelValue
        label="Borrow APY"
        :value="`${formatNumber(nanoToValue(pair.borrow.interestRateInfo.borrowAPY, 25) - (borrowRewardAPY || 0))}%`"
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
