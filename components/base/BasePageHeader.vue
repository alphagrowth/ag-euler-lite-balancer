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
  arrowRight: Boolean,
})
</script>

<template>
  <div class="flex items-center animate-fade-in-up">
    <div
      class="w-[52px] h-[52px] rounded-[14px] mr-16 bg-gradient-to-br from-accent-300/30 to-accent-400/40 flex items-center justify-center text-accent-600 flex-shrink-0 shadow-sm"
      :class="[
        arrowRight ? '[&>svg]:-rotate-90' : '',
        arrowDown && !arrowRight ? '[&>svg]:rotate-0' : '',
        !arrowDown && !arrowRight ? '[&>svg]:rotate-180' : ''
      ]"
    >
      <SvgIcon
        name="arrow-big"
      />
    </div>
    <div>
      <h1 class="text-h3 mb-4 text-content-primary">
        {{ title }}
      </h1>
      <p class="text-content-tertiary">
        {{ description }}
      </p>
    </div>
  </div>
</template>
