<script setup lang="ts">
const emits = defineEmits(['close'])
const { onCancel } = defineProps<{
  onCancel: () => void
}>()

const handleCancel = () => {
  onCancel()
  emits('close')
}
</script>

<template>
  <BaseModalWrapper
    title="Unverified vault"
    @close="handleCancel"
  >
    <div
      :class="$style.content"
      class="text-white"
    >
      <p>Are you sure you want to interact with the unverified vault?</p>
      <p>
        Proceeding with this unverified vault may pose security risks. Unverified vaults could potentially be used for phishing attempts.
      </p>
      <p>
        Please ensure you trust the source before continuing.
      </p>
    </div>
    <div :class="$style.buttons">
      <UiButton
        size="large"
        rounded
        variant="primary-stroke"
        @click="emits('close')"
      >
        Yes
      </UiButton>
      <UiButton
        size="large"
        rounded
        @click="handleCancel"
      >
        Cancel
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
