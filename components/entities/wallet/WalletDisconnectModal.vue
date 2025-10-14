<script setup lang="ts">
import { useAccount, useDisconnect } from '@wagmi/vue'

const emits = defineEmits(['close'])

const { address } = useAccount()
const { disconnect } = useDisconnect()

const onCopyAddressClick = () => {
  navigator.clipboard.writeText(address.value || '')
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
          {{ `${address?.slice(0, 6)}...${address?.slice(-4)}` }}
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
