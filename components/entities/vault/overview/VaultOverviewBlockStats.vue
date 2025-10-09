<script setup lang="ts">
import { getVaultPrice, type Vault } from '~/entities/vault'

const { vault } = defineProps<{ vault: Vault }>()

const { getOpportunityOfBorrowVault, getOpportunityOfLendVault } = useMerkl()

const rewardBorrowAPY = computed(() => getOpportunityOfBorrowVault(vault.asset.address)?.apr)
const rewardSupplyAPY = computed(() => getOpportunityOfLendVault(vault.address)?.apr)

const calcPrice = (amount: bigint) => {
  return getVaultPrice(nanoToValue(amount, vault.decimals), vault)
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
        :value="`$${compactNumber(calcPrice(vault.supply))}`"
        orientation="horizontal"
      />
      <VaultOverviewLabelValue
        label="Total borrowed"
        :value="`$${compactNumber(calcPrice(vault.borrow))}`"
        orientation="horizontal"
      />
      <VaultOverviewLabelValue
        label="Available liquidity"
        :value="`$${compactNumber(calcPrice(vault.supply - vault.borrow))}`"
        orientation="horizontal"
      />
      <VaultOverviewLabelValue
        label="Supply APY"
        :value="`${formatNumber(nanoToValue(vault.interestRateInfo.supplyAPY, 25) + (rewardSupplyAPY || 0))}%`"
        orientation="horizontal"
      />
      <VaultOverviewLabelValue
        label="Borrow APY"
        :value="`${formatNumber(nanoToValue(vault.interestRateInfo.borrowAPY, 25) - (rewardBorrowAPY || 0))}%`"
        orientation="horizontal"
      />
      <VaultOverviewLabelValue
        label="Utilisation"
        orientation="horizontal"
      >
        <div class="gap-4 align-center">
          {{ formatNumber(Number(vault.borrow) / (Number(vault.supply) / 100), 2) }}%

          <UiRadialProgress
            :value="Number(vault.borrow) / Number(vault.supply)"
            :max="1"
          />
        </div>
      </vaultoverviewlabelvalue>
    </div>
  </div>
</template>

<style scoped lang="scss">

</style>
