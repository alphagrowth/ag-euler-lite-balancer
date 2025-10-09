<script setup lang="ts">
const emits = defineEmits(['close'])

const {
  shorterAddress,
  friendlyAddress,
  disconnect,
} = useTonConnect()

const onCopyAddressClick = () => {
  navigator.clipboard.writeText(friendlyAddress.value)
}

const onDisconnectClick = () => {
  disconnect()
  emits('close')
}
</script>

<template>
  <BaseModalWrapper
    title="Wallet"
    @close="$emit('close')"
  >
    <div
      :class="$style.content"
      class="flex column align-center gap-16 mb-16"
    >
      <div class="flex justify-center align-center gap-16">
        <div class="h3 center">
          {{ shorterAddress }}
        </div>
        <UiButton
          variant="primary-stroke"
          size="medium"
          icon="copy"
          icon-only
          @click="onCopyAddressClick"
        />
      </div>
    </div>
    <UiButton
      variant="primary-stroke"
      size="xlarge"
      rounded
      icon="unlink"
      @click="onDisconnectClick"
    >
      Disconnect
    </UiButton>
  </BaseModalWrapper>
</template>

<style module lang="scss">
.content {
  margin-top: -8px;
  padding: 6px 0;
}
</style>
