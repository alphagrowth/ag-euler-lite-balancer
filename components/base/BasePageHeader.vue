<script setup lang="ts">
defineProps({
  title: {
    type: String,
    default: '',
  },
  description: {
    type: String,
    default: '',
  },
  arrowDown: Boolean,
})
</script>

<template>
  <div class="flex items-center">
    <div
      class="w-[52px] h-[52px] rounded-[12px] mr-16 bg-gradient-to-b from-[hsl(var(--aquamarine-700)/0.08)] to-[hsl(var(--aquamarine-700)/0.2)] flex items-center justify-center text-aquamarine-700 flex-shrink-0"
      :class="arrowDown ? '[&>svg]:rotate-0' : '[&>svg]:rotate-180'"
    >
      <SvgIcon
        name="arrow-big"
      />
    </div>
    <div>
      <div class="text-h3 mb-4">
        {{ title }}
      </div>
      <p class="text-euler-dark-900">
        {{ description }}
      </p>
    </div>
  </div>
</template>
