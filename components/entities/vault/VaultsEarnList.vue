<script setup lang="ts">
import type { EarnVault } from '~/entities/vault'

defineProps<{ items: EarnVault[] }>()
</script>

<template>
  <div
    class="flex flex-col gap-8"
  >
    <VaultEarnItem
      v-for="(vault, index) in items"
      :key="vault.address"
      :vault="vault"
      class="animate-fade-in-up"
      :style="{ animationDelay: `${Math.min(index * 0.05, 0.4)}s` }"
    />
  </div>
</template>
