<script setup lang="ts">
withDefaults(defineProps<{ message?: string }>(), {
  message: 'This product is not available in your region.',
})
</script>

<template>
  <div class="w-full rounded-12 p-16 bg-warning-100 text-warning-500">
    <div class="flex items-start gap-8">
      <SvgIcon name="warning" class="!w-20 !h-20 flex-shrink-0 mt-2" />
      <p class="text-p3 text-warning-500">
        {{ message }}
      </p>
    </div>
  </div>
</template>
