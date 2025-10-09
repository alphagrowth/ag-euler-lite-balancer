<script setup lang="ts">
import type { BorrowVaultPair } from '~/entities/vault'

defineProps<{ items: BorrowVaultPair[] }>()
</script>

<template>
  <div
    :class="$style.VaultsList"
    class="column gap-8"
  >
    <VaultBorrowItem
      v-for="pair in items"
      :key="`${pair.collateral.address}-${pair.borrow.address}`"
      :pair="pair"
    />
  </div>
</template>

<style lang="scss" module>
.VaultsList {
  ///
}
</style>
