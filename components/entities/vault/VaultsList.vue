<script setup lang="ts">
import type { Vault } from '~/entities/vault'

defineProps<{ items: Vault[], type: 'lend' | 'borrow' }>()
</script>

<template>
  <div
    class="flex flex-col gap-8"
  >
    <VaultItem
      v-for="vault in items"
      :key="vault.address"
      :vault="vault"
      :type="type"
    />
  </div>
</template>
