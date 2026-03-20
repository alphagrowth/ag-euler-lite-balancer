<script setup lang="ts">
defineProps<{ loading: boolean }>()
</script>

<template>
  <Transition
    name="instant-fade"
    mode="out-in"
  >
    <div
      v-if="loading"
      class="w-80 h-20 rounded-12 bg-neutral-300/10"
    />
    <slot v-else />
  </Transition>
</template>
