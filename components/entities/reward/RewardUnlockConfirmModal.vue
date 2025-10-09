<script setup lang="ts">
import type { REULLock } from '~/entities/merkl'

const { rewardTokens } = useMerkl()

const { item } = defineProps<{
  item: REULLock
  onConfirm: () => void
}>()
defineEmits(['close'])

const reulToken = computed(() => {
  return rewardTokens.value.find(token => token.symbol === 'rEUL')
})

const unlockableAmount = computed(() => {
  return nanoToValue(item.unlockableAmount, reulToken.value?.decimals)
})

const amountToBeBurned = computed(() => {
  return nanoToValue(item.amountToBeBurned, reulToken.value?.decimals)
})
</script>

<template>
  <div
    :class="$style.RewardUnlockConfirmModal"
    class="bg-euler-dark-500"
  >
    <div
      class="between mb-12 align-center center h3"
      :class="$style.top"
    >
      Are you sure?
    </div>
    <div class="p2 text-euler-dark-900 mb-24">
      This action will unlock <span class="text-aquamarine-700">{{ formatNumber(unlockableAmount, 6) }} EUL</span>,
      and <span class="text-aquamarine-700">{{ formatNumber(amountToBeBurned, 6) }} EUL will be permanently burned.</span>
      To fully redeem your EUL rewards, you must wait for the <span class="text-aquamarine-700">6-month</span> vesting period to complete.
    </div>
    <div class="between gap-8">
      <UiButton
        variant="primary-stroke"
        size="large"
        rounded
        @click="$emit('close')"
      >
        Cancel
      </UiButton>
      <UiButton
        size="large"
        rounded
        @click="onConfirm(); $emit('close')"
      >
        Confirm
      </UiButton>
    </div>
  </div>
</template>

<style module lang="scss">
.RewardUnlockConfirmModal {
  display: flex;
  flex-direction: column;
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  padding: 16px;
  min-width: 375px;
  max-width: 600px;
  overflow: auto;
  scrollbar-width: none;
  max-height: calc(85dvh);
  border-radius: 16px;

  @include respond-to(mobile) {
    top: auto;
    left: 0;
    bottom: 0;
    width: 100%;
    min-width: 100%;
    max-height: calc(95dvh);
    transform: translate(0, 0);
    border-radius: 16px 16px 0 0;
  }
}

.top {
  height: 36px;
}

.close {
  cursor: pointer;
}
</style>
