<script setup lang="ts">
import { useImage } from '@vueuse/core'

defineOptions({
  inheritAttrs: false,
})
const { src, label } = defineProps<{ src?: string | string[], label?: string | string[] }>()
const images = computed(() => {
  const srcs = !src || typeof src === 'string' ? [src || ''] : [...src]
  const labels = !label || typeof label === 'string' ? [label || ''] : [...label]
  return srcs.map((s, index) => {
    return {
      label: labels[index],
      src: s,
      state: shallowReactive(useImage({ src: s })),
    }
  })
})
</script>

<template>
  <div
    :class="$style.BaseAvatar"
    class="align-center"
  >
    <template
      v-for="(image, idx) in images"
      :key="idx"
    >
      <div
        v-if="image.state.isReady"
        :class="$style.icon"
        class="icon align-center justify-center"
        v-bind="$attrs"
        :style="{ backgroundImage: `url(${image.src})` }"
      />
      <div
        v-else
        :class="$style.icon"
        class="icon align-center justify-center weight-600"
        v-bind="$attrs"
        :style="{ backgroundColor: label ? stringToColor(image.label || '') : 'var(--c-euler-dark-400)' }"
      >
        {{ image.label ? image.label.slice(0, 2) : '' }}
      </div>
    </template>
  </div>
</template>

<style module lang="scss">
.BaseAvatar {
  position: relative;
}

.icon {
  overflow: hidden;
  border-radius: 50%;
  background-position: center;
  background-size: cover;
  flex-shrink: 0;

  &:global(.icon--46) {
    font-size: 16px;
  }

  &:global(.icon--20) {
    font-size: 8px;
  }

  &:not(:first-child) {
    margin-left: -8px;

    &:global(.icon--38) {
      margin-left: -18px;
    }

    &:global(.icon--40) {
      margin-left: -20px;
    }

    &:global(.icon--46) {
      margin-left: -18px;
    }
  }
}
</style>
