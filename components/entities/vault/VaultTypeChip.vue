<script setup lang="ts">
import type { Vault, EarnVault, EscrowVault, SecuritizeVault } from '~/entities/vault'

// TODO: More types
const { type, vault } = defineProps<{
  type: string
  vault: Vault | EarnVault | EscrowVault | SecuritizeVault
}>()

// Check if vault is verified - EVK, Earn, and Securitize vaults have a verified field
const isVerified = computed(() => {
  if ('verified' in vault) {
    return vault.verified
  }
  return true
})

const icon = computed(() => {
  switch (type) {
    case 'governed':
    case 'managed':
      return 'bank'
    case 'escrow':
    case 'securitize':
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
      return 'Escrowed collateral'
    case 'securitize':
      return 'Securitize Digital Security'
  }

  return 'Edge'
})
</script>

<template>
  <template v-if="!isVerified">
    <div
      class="flex gap-8 items-center py-8 px-12 rounded-8 bg-[var(--c-yellow-opaque-200)] text-yellow-700"
    >
      <UiIcon
        class="mr-2 !w-20 !h-20 text-yellow-600"
        name="warning"
      />
      Unknown
    </div>
  </template>
  <template v-else>
    <div
      class="flex gap-8 items-center py-8 px-12 rounded-8 bg-[var(--c-aquamarine-opaque-300)]"
    >
      <UiIcon
        class="mr-2 !w-20 !h-20"
        :name="icon"
      />
      {{ label }}
    </div>
  </template>
</template>
