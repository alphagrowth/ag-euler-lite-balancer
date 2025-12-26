<script setup lang="ts">
import { DateTime } from 'luxon'
import type { Opportunity } from '~/entities/merkl'
import type { Campaign } from '~/entities/brevis'

const emits = defineEmits(['close'])
const { lendingAPY, opportunityInfo, brevisInfo } = defineProps<{
  lendingAPY: number
  opportunityInfo?: Opportunity
  brevisInfo?: Campaign
}>()

const rewardsTotalAPY = computed(() => {
  const merklAPY = opportunityInfo ? opportunityInfo.apr : 0
  const brevisAPY = brevisInfo ? brevisInfo.reward_info.apr * 100 : 0
  return merklAPY + brevisAPY > 0 ? merklAPY + brevisAPY : null
})

const rewardsInfo = computed(() => {
  const rewards = opportunityInfo?.campaigns
    .map((campaign) => {
      return {
        id: campaign.id,
        apr: campaign.apr,
        endDate: DateTime.fromSeconds(campaign.endTimestamp),
        rewardToken: campaign.rewardToken,
        source: 'merkl',
      }
    })
    .filter(campaign => campaign.endDate > DateTime.now()) || []

  if (brevisInfo) {
    rewards.push({
      id: brevisInfo.campaign_id,
      apr: brevisInfo.reward_info.apr * 100,
      endDate: DateTime.fromSeconds(brevisInfo.end_time),
      rewardToken: {
        symbol: brevisInfo.reward_info.token_symbol,
        icon: '',
      },
      source: 'brevis',
    })
  }

  return rewards.sort((a, b) => a.rewardToken.symbol.localeCompare(b.rewardToken.symbol))
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
        class="flex justify-between items-center pb-16 mb-16 border-b border-euler-dark-600"
      >
        <div>
          <p class="mb-4">
            Lending APY
          </p>
          <p class="text-euler-dark-900">
            Yield from lending on Euler
          </p>
        </div>
        <div class="text-h5">
          {{ formatNumber(lendingAPY) }}%
        </div>
      </div>
      <div
        v-if="rewardsTotalAPY !== null"
        class="flex justify-between items-center mb-16"
      >
        <div>
          <p class="mb-4 flex gap-4">
            <SvgIcon
              class="!w-20 !h-20 text-aquamarine-700"
              name="sparks"
            />
            <span>Rewards APY</span>
          </p>
          <p class="text-euler-dark-900">
            Yield from token rewards
          </p>
        </div>
        <div class="text-h5">
          + {{ formatNumber(rewardsTotalAPY) }}%
        </div>
      </div>
      <div
        v-for="reward in rewardsInfo"
        :key="reward.id"
        class="flex justify-between items-center mb-16"
      >
        <div class="flex">
          <img
            v-if="reward.rewardToken.icon"
            class="w-20 h-20"
            :src="reward.rewardToken.icon"
            alt="Reward token logo"
          >
          <p class="ml-12">
            {{ reward.rewardToken.symbol === 'WTAC' ? 'TAC' : reward.rewardToken.symbol }}
          </p>
          <p class="ml-4 text-euler-dark-900">
            ({{ reward.source === 'brevis' ? 'Brevis, ' : '' }}ends {{ reward.endDate.toFormat('MMMM dd, yyyy') }})
          </p>
        </div>
        <div class="text-p2">
          {{ formatNumber(reward.apr) }}%
        </div>
      </div>
    </div>
    <div class="bg-euler-dark-600 rounded-12 p-16 flex justify-between items-center">
      <p>Total supply APY</p>
      <p class="text-h4">
        {{ formatNumber(lendingAPY + (rewardsTotalAPY || 0)) }}%
      </p>
    </div>
  </BaseModalWrapper>
</template>
