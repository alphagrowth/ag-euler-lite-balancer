<script setup lang="ts">
const emit = defineEmits(['close'])
const slippageRef = ref<InstanceType<typeof SlippageSettings> | null>(null)

const onSave = () => {
  slippageRef.value?.savePending()
  emit('close')
}
</script>

<template>
  <BaseModalWrapper
    @close="emit('close')"
  >
    <SlippageSettings
      ref="slippageRef"
      defer-save
    />
    <UiButton
      variant="primary"
      size="xlarge"
      @click="onSave"
    >
      Save
    </UiButton>
  </BaseModalWrapper>
</template>
