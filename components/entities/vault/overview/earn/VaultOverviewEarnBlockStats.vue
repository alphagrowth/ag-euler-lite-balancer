<script setup lang="ts">
import { getEarnVaultPrice, type EarnVault } from '~/entities/vault'

const { vault } = defineProps<{ vault: EarnVault }>()

const { getOpportunityOfLendVault } = useMerkl()

const rewardSupplyAPY = computed(() => getOpportunityOfLendVault(vault.address)?.apr)

const calcPrice = (amount: bigint) => {
  return getEarnVaultPrice(nanoToValue(amount, vault.decimals), vault)
}
</script>

<template>
  <div class="bg-euler-dark-300 br-16 column gap-24 p-24">
    <p class="h3 text-white">
      Statistics
    </p>
    <div class="column align-start gap-24">
      <VaultOverviewLabelValue
        label="Total supply"
        :value="`$${compactNumber(calcPrice(vault.totalShares))}`"
        orientation="horizontal"
      />
      <VaultOverviewLabelValue
        label="Available liquidity"
        :value="`$${compactNumber(calcPrice(vault.availableAssets))}`"
        orientation="horizontal"
      />
      <VaultOverviewLabelValue
        label="Supply APY"
        :value="`${formatNumber((vault.supplyAPY || 0) + (rewardSupplyAPY || 0))}%`"
        orientation="horizontal"
      />
    </div>
  </div>
</template>

<style scoped lang="scss">

</style>
