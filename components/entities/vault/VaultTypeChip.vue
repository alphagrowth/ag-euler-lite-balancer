<script setup lang="ts">
// TODO: More types
const { type } = defineProps<{ type: string }>()

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

<style module lang="scss">
.VaultTypeChip {
  background-color: var(--c-aquamarine-opaque-300);
}
</style>
