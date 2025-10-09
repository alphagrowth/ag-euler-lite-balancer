<script setup lang="ts">
defineProps<{ disabled?: boolean, loading?: boolean }>()
const { isConnected, tonConnectUI } = useTonConnect()

const onClick = (e: Event) => {
  if (!isConnected.value) {
    e.preventDefault()
    tonConnectUI.openModal()
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
