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
      class="flex flex-col items-center gap-16 mb-16 -mt-8 py-6"
    >
      <div class="flex justify-center items-center gap-16">
        <div class="text-h3 text-center">
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
