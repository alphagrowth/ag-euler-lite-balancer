<script setup lang="ts">
import { DateTime } from 'luxon'
import type { Opportunity } from '~/entities/merkl'

const emits = defineEmits(['close'])
const { borrowingAPY, intrinsicAPY, opportunityInfo } = defineProps<{
  borrowingAPY: number
  intrinsicAPY?: number
  opportunityInfo?: Opportunity
}>()

const rewardsTotalAPY = computed(() => {
  const merklAPY = opportunityInfo ? opportunityInfo.apr : 0
  return merklAPY > 0 ? merklAPY : null
})

const intrinsicApyValue = computed(() => intrinsicAPY ?? 0)
const hasIntrinsicApy = computed(() => intrinsicApyValue.value > 0)
const totalBorrowApy = computed(() => borrowingAPY - intrinsicApyValue.value - (rewardsTotalAPY.value || 0))

const rewardsInfo = computed(() => {
  const rewards = opportunityInfo?.campaigns
    .map((campaign) => {
      return {
        id: campaign.id,
        apr: campaign.apr,
        endDate: DateTime.fromSeconds(campaign.endTimestamp),
        rewardToken: campaign.rewardToken,
      }
    })
    .filter(campaign => campaign.endDate > DateTime.now()) || []

  return rewards.sort((a, b) => a.rewardToken.symbol.localeCompare(b.rewardToken.symbol))
})

const handleClose = () => {
  emits('close')
}
</script>

<template>
  <BaseModalWrapper
    title="Borrow APY"
    @close="handleClose"
  >
    <div class="mb-24">
      <div
        class="pb-16 mb-16 border-b border-euler-dark-600"
      >
        <div class="flex justify-between items-center">
          <div>
            <p class="mb-4">
              Borrowing APY
            </p>
            <p class="text-euler-dark-900">
              Cost of borrowing on Euler
            </p>
          </div>
          <div class="text-h5">
            {{ formatNumber(borrowingAPY) }}%
          </div>
        </div>
        <div
          v-if="hasIntrinsicApy"
          class="flex justify-between items-center mt-16"
        >
          <div>
            <p class="mb-4">
              Intrinsic APY
            </p>
            <p class="text-euler-dark-900">
              Yield intrinsic to the borrowed asset, such as staking yield, which reduces effective borrowing cost
            </p>
          </div>
          <div class="text-h5">
            - {{ formatNumber(intrinsicApyValue) }}%
          </div>
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
          - {{ formatNumber(rewardsTotalAPY) }}%
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
            (ends {{ reward.endDate.toFormat('MMMM dd, yyyy') }})
          </p>
        </div>
        <div class="text-p2">
          {{ formatNumber(reward.apr) }}%
        </div>
      </div>
    </div>
    <div class="bg-euler-dark-600 rounded-12 p-16 flex justify-between items-center">
      <p>Total borrow APY</p>
      <p class="text-h4">
        {{ formatNumber(totalBorrowApy) }}%
      </p>
    </div>
  </BaseModalWrapper>
</template>
