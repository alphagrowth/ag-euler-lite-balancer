<script setup lang="ts">
import { DateTime } from 'luxon'
import type { Opportunity } from '~/entities/merkl'

const emits = defineEmits(['close'])
const { lendingAPY, opportunityInfo } = defineProps<{
  lendingAPY: number
  opportunityInfo?: Opportunity
}>()

const rewardsTotalAPY = computed(() => opportunityInfo ? opportunityInfo.apr : null)
const rewardsInfo = computed(() => {
  return opportunityInfo?.campaigns
    .map((campaign) => {
      return {
        id: campaign.id,
        apr: campaign.apr,
        endDate: DateTime.fromSeconds(campaign.endTimestamp),
        rewardToken: campaign.rewardToken,
      }
    })
    .filter(campaign => campaign.endDate > DateTime.now())
    .sort((a, b) => a.rewardToken.symbol.localeCompare(b.rewardToken.symbol))
})

const handleClose = () => {
  emits('close')
}
</script>

<template>
  <BaseModalWrapper
    title="Supply APY"
    @close="handleClose"
  >
    <div class="mb-24">
      <div
        :class="$style.top"
        class="between align-center pb-16 mb-16"
      >
        <div>
          <p class="mb-4">
            Lending APY
          </p>
          <p class="text-euler-dark-900">
            Yield from lending on Euler
          </p>
        </div>
        <div class="h5">
          {{ formatNumber(lendingAPY) }}%
        </div>
      </div>
      <div
        v-if="rewardsTotalAPY !== null"
        class="between align-center mb-16"
      >
        <div>
          <p class="mb-4 flex gap-4">
            <SvgIcon
              class="icon--20 text-aquamarine-700"
              name="sparks"
            />
            <span>Rewards APY</span>
          </p>
          <p class="text-euler-dark-900">
            Yield from token rewards
          </p>
        </div>
        <div class="h5">
          + {{ formatNumber(rewardsTotalAPY) }}%
        </div>
      </div>
      <div
        v-for="reward in rewardsInfo"
        :key="reward.id"
        class="between align-center mb-16"
      >
        <div class="flex">
          <img
            :class="$style.rewardLogo"
            :src="reward.rewardToken.icon"
            alt="Reward token logo"
          >
          <p class="ml-12">
            {{ reward.rewardToken.symbol === 'WTAC' ? 'TAC' : reward.rewardToken.symbol }} <!-- TODO wtac -> tac @ useMerkl -->
          </p>
          <p class="ml-4 text-euler-dark-900">
            (ends {{ reward.endDate.toFormat('MMMM dd, yyyy') }})
          </p>
        </div>
        <div class="p2">
          {{ formatNumber(reward.apr) }}%
        </div>
      </div>
    </div>
    <div class="bg-euler-dark-600 br-12 p-16 between align-center">
      <p>Total supply APY</p>
      <p class="h4">
        {{ formatNumber(lendingAPY + (rewardsTotalAPY || 0)) }}%
      </p>
    </div>
  </BaseModalWrapper>
</template>

<style lang="scss" module>
.top {
  border-bottom: 1px solid var(--c-euler-dark-600);
}

.rewardLogo {
  width: 20px;
  height: 20px;
}
</style>
