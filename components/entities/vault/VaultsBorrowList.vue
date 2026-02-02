<script setup lang="ts">
import type { AnyBorrowVaultPair } from '~/entities/vault'

defineProps<{ items: AnyBorrowVaultPair[] }>()
</script>

<template>
  <div
    class="flex flex-col gap-8"
  >
    <VaultBorrowItem
      v-for="(pair, index) in items"
      :key="`${pair.collateral.address}-${pair.borrow.address}`"
      :pair="pair"
      class="animate-fade-in-up"
      :style="{ animationDelay: `${Math.min(index * 0.05, 0.4)}s` }"
    />
  </div>
</template>
