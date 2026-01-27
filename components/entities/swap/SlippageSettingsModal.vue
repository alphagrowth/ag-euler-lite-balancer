<script setup lang="ts">
defineEmits(['close'])
</script>

<template>
  <BaseModalWrapper
    @close="$emit('close')"
  >
    <SlippageSettings />
  </BaseModalWrapper>
</template>
