<script setup lang="ts">
import type { Vault } from '~/entities/vault'

const { vault } = defineProps<{ vault: Vault }>()
const { borrowList } = useVaults()

const borrowVaultPairs = computed(() => borrowList.value.filter(pair => pair.borrow.address === vault.address))
</script>

<template>
  <div
    v-if="borrowVaultPairs.length"
    class="bg-euler-dark-300 br-16 column gap-24 p-24"
  >
    <div>
      <p class="h3 text-white mb-12">
        Collateral exposure
      </p>
      <p class="text-euler-dark-900">
        Deposits in this market can be borrowed.
        Please make sure you're comfortable accepting the collateral
        listed in the table below before depositing.
      </p>
    </div>

    <div class="column gap-12">
      <div
        v-for="pair in borrowVaultPairs"
        :key="pair.collateral.address"
        class="bg-euler-dark-500 br-16 "
      >
        <div
          class="px-16 pt-16 pb-12"
          style="border-bottom: 1px solid var(--c-euler-dark-600)"
        >
          <VaultLabelsAndAssets
            :vault="pair.collateral"
            :assets="[pair.collateral.asset]"
          />
        </div>
        <div class="column gap-12 px-16 pt-12 pb-16">
          <VaultOverviewLabelValue
            label="Max LTV"
            orientation="horizontal"
            :value="`${formatNumber(nanoToValue(pair.borrowLTV, 2), 2)}%`"
          />
          <VaultOverviewLabelValue
            label="LLTV"
            orientation="horizontal"
            :value="`${formatNumber(nanoToValue(pair.liquidationLTV, 2), 2)}%`"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<style module lang="scss">
</style>
