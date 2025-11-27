<script setup lang="ts">
import { useAccount } from '@wagmi/vue'
import { useAppKit } from '@reown/appkit/vue'

defineProps<{ disabled?: boolean, loading?: boolean }>()
const { isConnected } = useAccount()
const { open } = useAppKit()

const onClick = (e: Event) => {
  if (!isConnected.value) {
    e.preventDefault()
    open()
    return
  }
}
</script>

<template>
  <UiButton
    v-bind="$attrs"
    size="large"
    type="submit"
    :loading="loading"
    :disabled="disabled"
    @click="onClick"
  >
    <slot v-if="isConnected" />
    <template v-else>
      Connect wallet
    </template>
  </UiButton>
</template>
