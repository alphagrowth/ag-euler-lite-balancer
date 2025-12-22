<script setup lang="ts">
import type { Vault, EarnVault } from '~/entities/vault'

// TODO: More types
const { type, vault } = defineProps<{
  type: string
  vault: Vault | EarnVault
}>()

const icon = computed(() => {
  switch (type) {
    case 'governed':
    case 'managed':
      return 'bank'
    case 'escrow':
      return 'shield'
  }

  return 'pulse'
})
const label = computed(() => {
  switch (type) {
    case 'governed':
      return 'Governed'
    case 'managed':
      return 'Managed'
    case 'escrow':
      return 'Escrow'
  }

  return 'Edge'
})
</script>

<template>
  <template v-if="'verified' in vault && !vault.verified">
    <div
      :class="[$style.VaultTypeChip, $style.unverified]"
      class="gap-4 align-center py-8 px-12 br-8"
    >
      <UiIcon
        class="mr-2 icon--20 text-yellow-600"
        name="warning"
      />
      Unverified
    </div>
  </template>
  <template v-else>
    <div
      :class="$style.VaultTypeChip"
      class="gap-4 align-center py-8 px-12 br-8"
    >
      <UiIcon
        class="mr-2 icon--20"
        :name="icon"
      />
      {{ label }}
    </div>
  </template>
</template>

<style module lang="scss">
.VaultTypeChip {
  background-color: var(--c-aquamarine-opaque-300);

  &.unverified {
    background-color: var(--c-yellow-opaque-200);
    color: var(--c-yellow-700);
  }
}
</style>
