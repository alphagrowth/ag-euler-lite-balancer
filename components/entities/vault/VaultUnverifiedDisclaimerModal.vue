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
    title="Important!"
    warning
    @close="handleCancel"
  >
    <div :class="$style.content">
      <h4 class="text-white h4">
        Are you sure you want to interact with the unverified vault?
      </h4>
      <p class="pb-8">
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
  gap: 12px;
  color: var(--c-euler-dark-900);
  margin-bottom: 24px;
}

.buttons {
  display: flex;
  gap: 8px;
}
</style>
