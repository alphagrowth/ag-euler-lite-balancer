<script setup lang="ts">
defineProps<{ loading?: boolean }>()
</script>

<template>
  <div
    class="relative bg-euler-dark-400 p-16 rounded-16"
    style="overflow: hidden"
  >
    <BaseLoadingBar v-show="loading" />
    <slot />
  </div>
</template>
