<script setup lang="ts">
import { useAccount } from '@wagmi/vue'
import { useAppKit } from '@reown/appkit/vue'

const props = defineProps<{ disabled?: boolean, loading?: boolean }>()
const { isConnected } = useAccount()
const { open } = useAppKit()
const { chainId: _chainId } = useEulerAddresses()
const { chainId, switchChain } = useWagmi()

const needToSwitchChain = computed(() => {
  return isConnected.value && chainId.value !== _chainId.value
})
const _disabled = computed(() => {
  return props.disabled && !needToSwitchChain.value
})
const onClick = (e: Event) => {
  if (needToSwitchChain.value) {
    e.preventDefault()
    switchChain({ chainId: _chainId.value })
    return
  }
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
    :variant="needToSwitchChain ? 'red' : 'primary'"
    :loading="loading"
    :disabled="_disabled"
    @click="onClick"
  >
    <template v-if="needToSwitchChain">
      Switch chain
    </template>
    <slot v-else-if="isConnected" />
    <template v-else>
      Connect wallet
    </template>
  </UiButton>
</template>
