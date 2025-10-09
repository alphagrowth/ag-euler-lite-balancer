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
      :class="$style.BaseSkeleton"
    />
    <slot v-else />
  </Transition>
</template>

<style module lang="scss">
.BaseSkeleton {
  width: 80px;
  height: 20px;
  border-radius: 12px;
  background-color: rgba(200, 200, 200, 0.1);
}
</style>
