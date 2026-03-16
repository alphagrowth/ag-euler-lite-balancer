<script setup lang="ts">
import { DateTime } from 'luxon'
import { formatNumber } from '~/utils/string-utils'
import type { RewardCampaign } from '~/entities/reward-campaign'

const emits = defineEmits(['close'])
const {
  supplyAPY,
  borrowAPY,
  intrinsicSupplyAPY,
  intrinsicBorrowAPY,
  supplyRewardAPY,
  borrowRewardAPY,
  supplyCampaigns,
  borrowCampaigns,
} = defineProps<{
  supplyAPY: number
  borrowAPY: number
  intrinsicSupplyAPY?: number
  intrinsicBorrowAPY?: number
  supplyRewardAPY?: number | null
  borrowRewardAPY?: number | null
  supplyCampaigns?: RewardCampaign[]
  borrowCampaigns?: RewardCampaign[]
}>()

const totalSupplyApy = computed(() =>
  supplyAPY + (intrinsicSupplyAPY ?? 0) + (supplyRewardAPY || 0),
)
const totalBorrowApy = computed(() =>
  borrowAPY + (intrinsicBorrowAPY ?? 0) - (borrowRewardAPY || 0),
)
const netApy = computed(() => totalSupplyApy.value - totalBorrowApy.value)

const hasIntrinsic = computed(() => (intrinsicSupplyAPY ?? 0) !== 0 || (intrinsicBorrowAPY ?? 0) !== 0)
const hasRewards = computed(() => (supplyRewardAPY || 0) > 0 || (borrowRewardAPY || 0) > 0)

const PROVIDER_LABELS: Record<string, string> = {
  merkl: 'Merkl',
  brevis: 'Brevis',
  fuul: 'Fuul',
}

const mapCampaigns = (campaigns: RewardCampaign[] | undefined, side: string) => {
  if (!campaigns) return []
  const now = Math.floor(Date.now() / 1000)
  return campaigns
    .filter(c => c.endTimestamp > now || c.endTimestamp === 0)
    .map(c => ({
      id: `${side}-${c.vault}-${c.provider}-${c.type}-${c.endTimestamp}`,
      apr: c.apr,
      endDate: c.endTimestamp > 0 ? DateTime.fromSeconds(c.endTimestamp) : null,
      rewardToken: c.rewardToken || { symbol: 'Unknown', icon: '' },
      source: c.provider,
      sourceUrl: c.sourceUrl,
    }))
    .sort((a, b) => a.rewardToken.symbol.localeCompare(b.rewardToken.symbol))
}

const supplyRewardsInfo = computed(() => mapCampaigns(supplyCampaigns, 'supply'))
const borrowRewardsInfo = computed(() => mapCampaigns(borrowCampaigns, 'borrow'))

const handleClose = () => {
  emits('close')
}
</script>

<template>
  <BaseModalWrapper
    title="Net APY"
    @close="handleClose"
  >
    <div class="mb-24">
      <div class="pb-16 mb-16 border-b border-euler-dark-600">
        <div class="flex justify-between items-center">
          <div>
            <p class="mb-4">
              Supply APY
            </p>
            <p class="text-euler-dark-900">
              Yield from lending collateral on Euler
            </p>
          </div>
          <div class="text-h5">
            + {{ formatNumber(supplyAPY) }}%
          </div>
        </div>
        <div
          v-if="hasIntrinsic && (intrinsicSupplyAPY ?? 0) !== 0"
          class="flex justify-between items-center mt-16"
        >
          <div>
            <p class="mb-4">
              Intrinsic supply APY
            </p>
            <p class="text-euler-dark-900">
              Yield intrinsic to the collateral asset
            </p>
          </div>
          <div class="text-h5">
            + {{ formatNumber(intrinsicSupplyAPY) }}%
          </div>
        </div>
        <div
          v-if="hasRewards && (supplyRewardAPY || 0) > 0"
          class="flex justify-between items-center mt-16"
        >
          <div>
            <p class="mb-4 flex gap-4">
              <SvgIcon
                class="!w-20 !h-20 text-accent-500"
                name="sparks"
              />
              <span>Supply rewards APY</span>
            </p>
          </div>
          <div class="text-h5">
            + {{ formatNumber(supplyRewardAPY ?? 0) }}%
          </div>
        </div>
        <div
          v-for="reward in supplyRewardsInfo"
          :key="reward.id"
          class="flex justify-between items-center mt-12"
        >
          <div class="flex">
            <img
              v-if="reward.rewardToken.icon"
              class="w-20 h-20 rounded-full"
              :src="reward.rewardToken.icon"
              alt="Reward token logo"
            >
            <p class="ml-12">
              {{ reward.rewardToken.symbol === 'WTAC' ? 'TAC' : reward.rewardToken.symbol }}
            </p>
            <p class="ml-4 text-euler-dark-900">
              (<a
                v-if="reward.sourceUrl"
                :href="reward.sourceUrl"
                target="_blank"
                rel="noopener noreferrer"
                class="underline"
                @click.stop
              >{{ PROVIDER_LABELS[reward.source] || reward.source }}</a><template v-else>
                {{ PROVIDER_LABELS[reward.source] || reward.source }}
              </template>{{ reward.endDate ? `, ends ${reward.endDate.toFormat('MMMM dd, yyyy')}` : '' }})
            </p>
          </div>
          <div class="text-p2">
            {{ formatNumber(reward.apr) }}%
          </div>
        </div>
      </div>
      <div class="pb-16 mb-16 border-b border-euler-dark-600">
        <div class="flex justify-between items-center">
          <div>
            <p class="mb-4">
              Borrow APY
            </p>
            <p class="text-euler-dark-900">
              Cost of borrowing on Euler
            </p>
          </div>
          <div class="text-h5">
            - {{ formatNumber(borrowAPY) }}%
          </div>
        </div>
        <div
          v-if="hasIntrinsic && (intrinsicBorrowAPY ?? 0) !== 0"
          class="flex justify-between items-center mt-16"
        >
          <div>
            <p class="mb-4">
              Intrinsic borrow APY
            </p>
            <p class="text-euler-dark-900">
              Yield intrinsic to the borrowed asset
            </p>
          </div>
          <div class="text-h5">
            - {{ formatNumber(intrinsicBorrowAPY) }}%
          </div>
        </div>
        <div
          v-if="hasRewards && (borrowRewardAPY || 0) > 0"
          class="flex justify-between items-center mt-16"
        >
          <div>
            <p class="mb-4 flex gap-4">
              <SvgIcon
                class="!w-20 !h-20 text-accent-500"
                name="sparks"
              />
              <span>Borrow rewards APY</span>
            </p>
          </div>
          <div class="text-h5">
            - {{ formatNumber(borrowRewardAPY ?? 0) }}%
          </div>
        </div>
        <div
          v-for="reward in borrowRewardsInfo"
          :key="reward.id"
          class="flex justify-between items-center mt-12"
        >
          <div class="flex">
            <img
              v-if="reward.rewardToken.icon"
              class="w-20 h-20 rounded-full"
              :src="reward.rewardToken.icon"
              alt="Reward token logo"
            >
            <p class="ml-12">
              {{ reward.rewardToken.symbol === 'WTAC' ? 'TAC' : reward.rewardToken.symbol }}
            </p>
            <p class="ml-4 text-euler-dark-900">
              (<a
                v-if="reward.sourceUrl"
                :href="reward.sourceUrl"
                target="_blank"
                rel="noopener noreferrer"
                class="underline"
                @click.stop
              >{{ PROVIDER_LABELS[reward.source] || reward.source }}</a><template v-else>
                {{ PROVIDER_LABELS[reward.source] || reward.source }}
              </template>{{ reward.endDate ? `, ends ${reward.endDate.toFormat('MMMM dd, yyyy')}` : '' }})
            </p>
          </div>
          <div class="text-p2">
            {{ formatNumber(reward.apr) }}%
          </div>
        </div>
      </div>
    </div>
    <div class="bg-euler-dark-600 rounded-12 p-16 flex justify-between items-center">
      <div>
        <p>Net APY</p>
        <p class="text-euler-dark-900 text-p3">
          Return on supplied collateral after borrow costs
        </p>
      </div>
      <p
        class="text-h4"
        :class="[netApy >= 0 ? 'text-accent-600' : 'text-error-500']"
      >
        = {{ formatNumber(netApy) }}%
      </p>
    </div>
  </BaseModalWrapper>
</template>
