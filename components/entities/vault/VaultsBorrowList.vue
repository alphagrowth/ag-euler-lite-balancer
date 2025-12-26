<script setup lang="ts">
import type { BorrowVaultPair } from '~/entities/vault'

defineProps<{ items: BorrowVaultPair[] }>()
</script>

<template>
  <div
    class="flex flex-col gap-8"
  >
    <VaultBorrowItem
      v-for="pair in items"
      :key="`${pair.collateral.address}-${pair.borrow.address}`"
      :pair="pair"
    />
  </div>
</template>
