<script setup lang="ts">
const { label, value, orientation = 'vertical' } = defineProps<{
  label?: string
  value?: string
  orientation?: 'horizontal' | 'vertical'
}>()
</script>

<template>
  <div
    :class="[$style.VaultOverviewLabelValue, [$style[`_${orientation}`]]]"
    class="column gap-8"
  >
    <div class="p3 text-euler-dark-900">
      <slot name="label">
        {{ label }}
      </slot>
    </div>
    <div class="p2 text-white">
      <slot>
        {{ value || '-' }}
      </slot>
    </div>
  </div>
</template>

<style module lang="scss">
.VaultOverviewLabelValue {
  display: flex;
  flex-direction: column;

  &._horizontal {
    flex-direction: row;
    justify-content: space-between;
    width: 100%;
  }
}
</style>
