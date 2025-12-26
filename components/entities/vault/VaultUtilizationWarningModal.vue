<script setup lang="ts">
const emits = defineEmits(['close'])
</script>

<template>
  <BaseModalWrapper
    title="High usage warning"
    warning
    @close="emits('close')"
  >
    <div
      class="text-white flex flex-col gap-8 mb-16"
    >
      <p>
        High utilization on this market. A large proportion of the available liquidity has been borrowed.
      </p>
    </div>
    <div class="flex gap-8">
      <UiButton
        size="large"
        rounded
        @click="emits('close')"
      >
        OK
      </UiButton>
    </div>
  </BaseModalWrapper>
</template>
