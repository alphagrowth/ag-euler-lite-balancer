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
    class="flex flex-col gap-12 bg-euler-dark-500 rounded-16"
  >
    <div
      class="flex justify-between items-center p-16 pb-12 border-b border-border-primary"
    >
      <BaseAvatar
        src="/img/euler-default.png"
        class="icon--40"
      />
      <h4 class="text-h5 ml-12">
        rEUL
      </h4>
      <div class="flex flex-col gap-8 ml-auto text-right">
        <p class="text-p2">
          {{ formatNumber(unlockableAmount, 6) }} EUL
        </p>
        <p class="text-p3 text-euler-dark-900">
          OF {{ formatNumber(amount, 6) }} rEUL
        </p>
      </div>
    </div>
    <div class="pb-16 pl-16 pr-16">
      <div class="flex justify-between items-center mb-16">
        <div class="text-euler-dark-900">
          Maturity date
        </div>
        <div class="text-right flex flex-col gap-4 text-p2">
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
