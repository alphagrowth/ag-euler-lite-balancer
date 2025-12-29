<script setup lang="ts">
import type { EarnVault } from '~/entities/vault'

defineProps<{ items: EarnVault[] }>()
</script>

<template>
  <div
    class="flex flex-col gap-8"
  >
    <VaultEarnItem
      v-for="vault in items"
      :key="vault.address"
      :vault="vault"
    />
  </div>
</template>
