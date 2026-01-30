<script setup lang="ts">
import type { Vault, EarnVault, EscrowVault } from '~/entities/vault'

// TODO: More types
const { type, vault } = defineProps<{
  type: string
  vault: Vault | EarnVault | EscrowVault
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
      class="vault-type-chip flex gap-8 items-center py-8 px-12 rounded-8 vault-type-chip--warning"
    >
      <UiIcon
        class="mr-2 !w-20 !h-20"
        name="warning"
      />
      Unverified
    </div>
  </template>
  <template v-else>
    <div
      class="vault-type-chip flex gap-8 items-center py-8 px-12 rounded-8"
    >
      <UiIcon
        class="mr-2 !w-20 !h-20"
        :name="icon"
      />
      {{ label }}
    </div>
  </template>
</template>

<style scoped lang="scss">
.vault-type-chip {
  background-color: rgba(196, 155, 100, 0.15);
  color: var(--accent-600);

  [data-theme="dark"] & {
    background-color: rgba(212, 169, 90, 0.2);
    color: var(--accent-500);
  }

  &--warning {
    background-color: var(--warning-100);
    color: var(--warning-500);
  }
}
</style>
