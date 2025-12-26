<script setup lang="ts">
defineEmits(['close'])
</script>

<template>
  <BaseModalWrapper
    title="Your health score"
    @close="$emit('close')"
  >
    <div class="text-p2 text-euler-dark-900">
      Health score measures how safe your position is. A score above 1 means you're safe; below 1 means you're at risk of liquidation.
    </div>
  </BaseModalWrapper>
</template>
