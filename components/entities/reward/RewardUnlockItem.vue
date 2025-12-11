<script setup lang="ts">
import { DateTime } from 'luxon'
import { RewardUnlockConfirmModal } from '#components'
import { useModal } from '~/components/ui/composables/useModal'
import type { REULLock } from '~/entities/reul'

const modal = useModal()
const { rewardTokens } = useMerkl()
const { unlockREUL } = useREULLocks()
const { item } = defineProps<{ item: REULLock }>()

const isUnlocking = ref(false)

const reulToken = computed(() => {
  return rewardTokens.value.find(token => token.symbol === 'rEUL')
})

const unlockableAmount = computed(() => {
  return nanoToValue(item.unlockableAmount, reulToken.value?.decimals)
})

const amount = computed(() => {
  return nanoToValue(item.amount, reulToken.value?.decimals)
})

const formattedDate = computed(() => {
  return DateTime.fromSeconds(Number(item.timestamp)).plus({ days: 180 }).toFormat('MMMM dd, yyyy')
})

const daysUntilMaturity = computed(() => {
  return Math.max(0, Math.floor(DateTime.fromSeconds(Number(item.timestamp)).plus({ days: 180 }).diffNow('days').days))
})

const onUnlockClick = () => {
  modal.open(RewardUnlockConfirmModal, {
    props: {
      item,
      onConfirm: async () => {
        isUnlocking.value = true
        setTimeout(() => {
          isUnlocking.value = false
        }, 5000)

        await unlockREUL([item.timestamp])
      },
    },
  })
}
</script>

<template>
  <div
    :class="$style.RewardUnlockItem"
    class="column gap-12 bg-euler-dark-500 br-16"
  >
    <div
      class="between align-center p-16 pb-12"
      :class="$style.reulTop"
    >
      <BaseAvatar
        src="/img/euler-default.png"
        class="icon--40"
      />
      <h4 class="h5 ml-12">
        rEUL
      </h4>
      <div class="column gap-8 ml-auto right">
        <p class="p2">
          {{ formatNumber(unlockableAmount, 6) }} EUL
        </p>
        <p class="p3 text-euler-dark-900">
          OF {{ formatNumber(amount, 6) }} rEUL
        </p>
      </div>
    </div>
    <div class="pb-16 pl-16 pr-16">
      <div class="between align-center mb-16">
        <div class="text-euler-dark-900">
          Maturity date
        </div>
        <div class="right column gap-4 p2">
          <div>
            in {{ daysUntilMaturity }} days
          </div>
          <div class="text-euler-dark-900">
            {{ formattedDate }}
          </div>
        </div>
      </div>
      <UiButton
        variant="primary-stroke"
        rounded
        :loading="isUnlocking"
        @click="onUnlockClick"
      >
        Unlock
      </UiButton>
    </div>
  </div>
</template>

<style lang="scss" module>
.RewardUnlockItem {
}

.reulTop {
  border-bottom: 1px solid #1B3C5F;
}
</style>
