<script setup lang="ts">
import type { EarnVault } from '~/entities/vault'

defineProps<{ items: EarnVault[] }>()
</script>

<template>
  <div
    :class="$style.VaultsList"
    class="column gap-8"
  >
    <VaultEarnItem
      v-for="vault in items"
      :key="vault.address"
      :vault="vault"
    />
  </div>
</template>

<style lang="scss" module>
.VaultsList {
  ///
}
</style>
