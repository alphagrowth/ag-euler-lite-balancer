<script setup lang="ts">
defineProps<{
  loading?: boolean
  variant?: 'default' | 'card'
}>()
</script>

<template>
  <div
    class="relative p-16 rounded-16 flex flex-col gap-16"
    :class="[
      variant === 'card'
        ? 'bg-surface-secondary shadow-card'
        : 'bg-card border border-border-subtle shadow-[var(--ui-form-field-shadow)]',
    ]"
    style="overflow: hidden"
  >
    <BaseLoadingBar v-show="loading" />
    <slot />
  </div>
</template>
