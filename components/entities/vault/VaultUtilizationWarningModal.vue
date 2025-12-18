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
      :class="$style.content"
      class="text-white"
    >
      <p>
        High utilization on this market. A large proportion of the available liquidity has been borrowed.
      </p>
    </div>
    <div :class="$style.buttons">
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

<style lang="scss" module>
.content {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 16px;
}
.buttons {
  display: flex;
  gap: 8px;
}
</style>
