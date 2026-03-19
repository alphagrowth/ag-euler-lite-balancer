<script setup lang="ts">
import { DateTime } from 'luxon'
import { formatNumber } from '~/utils/string-utils'
import type { RewardCampaign } from '~/entities/reward-campaign'

const emits = defineEmits(['close'])
const {
  maxRoe,
  maxMultiplier,
  supplyAPY,
  borrowAPY,
  borrowLTV,
  borrowVaultAddress,
  collateralAddress,
} = defineProps<{
  maxRoe: number
  maxMultiplier: number
  supplyAPY: number
  borrowAPY: number
  borrowLTV: number
  borrowVaultAddress?: string
  collateralAddress?: string
  isBestInMarket?: boolean
}>()

const { getLoopingRewardApy, getLoopingRewardCampaigns } = useRewardsApy()

const PROVIDER_LABELS: Record<string, string> = {
  merkl: 'Merkl',
  brevis: 'Brevis',
  fuul: 'Fuul',
}

const loopingRewardAPR = computed(() =>
  borrowVaultAddress && collateralAddress
    ? getLoopingRewardApy(borrowVaultAddress, collateralAddress)
    : 0,
)

const loopingCampaigns = computed(() => {
  if (!borrowVaultAddress || !collateralAddress) return []
  const campaigns = getLoopingRewardCampaigns(borrowVaultAddress, collateralAddress)
  const now = Math.floor(Date.now() / 1000)
  return campaigns
    .filter((c: RewardCampaign) => c.endTimestamp > now || c.endTimestamp === 0)
    .map((c: RewardCampaign) => ({
      apr: c.apr,
      endDate: c.endTimestamp > 0 ? DateTime.fromSeconds(c.endTimestamp) : null,
      rewardToken: c.rewardToken || { symbol: 'Unknown', icon: '' },
      source: c.provider,
      sourceUrl: c.sourceUrl,
      minMultiplier: c.minMultiplier,
      maxMultiplier: c.maxMultiplier,
    }))
})

const hasLooping = computed(() => loopingRewardAPR.value > 0)

const handleClose = () => {
  emits('close')
}
</script>

<template>
  <BaseModalWrapper
    :title="isBestInMarket ? 'Best Max ROE' : 'Max ROE'"
    @close="handleClose"
  >
    <p class="text-euler-dark-900 text-p3 mb-16">
      ROE (Return on Equity) estimates the annualized return on your own capital in a multiplied position. A positive ROE means the supply yield exceeds borrowing costs at the given multiplier. A negative ROE means the position is gradually losing value to interest costs.
      <template v-if="isBestInMarket">
        The value shown is the best max ROE out of all possible collateral/borrow pairs in this market.
      </template>
    </p>
    <div class="mb-24">
      <div class="pb-16 mb-16 border-b border-euler-dark-600">
        <div class="flex justify-between items-center mb-16">
          <div>
            <p class="mb-4">
              Max LTV
            </p>
            <p class="text-euler-dark-900">
              Maximum loan-to-value ratio
            </p>
          </div>
          <div class="text-h5">
            {{ formatNumber(borrowLTV, 2) }}%
          </div>
        </div>
        <div class="flex justify-between items-center mb-16">
          <div>
            <p class="mb-4">
              Max multiplier
            </p>
            <p class="text-euler-dark-900">
              Max multiplier at max LTV
            </p>
          </div>
          <div class="text-h5">
            {{ formatNumber(maxMultiplier, 2, 2) }}x
          </div>
        </div>
        <div class="flex justify-between items-center mb-16">
          <div>
            <p class="mb-4">
              Supply APY
            </p>
            <p class="text-euler-dark-900">
              Collateral yield (S)
            </p>
          </div>
          <div class="text-h5">
            {{ formatNumber(supplyAPY) }}%
          </div>
        </div>
        <div class="flex justify-between items-center">
          <div>
            <p class="mb-4">
              Borrow APY
            </p>
            <p class="text-euler-dark-900">
              Borrowing cost (B)
            </p>
          </div>
          <div class="text-h5">
            {{ formatNumber(borrowAPY) }}%
          </div>
        </div>
        <template v-if="hasLooping">
          <div class="flex justify-between items-center mt-16">
            <div>
              <p class="mb-4 flex gap-4">
                <SvgIcon
                  class="!w-20 !h-20 text-accent-500"
                  name="sparks"
                />
                <span>Looping reward (R)</span>
              </p>
              <p class="text-euler-dark-900">
                Incentive on net liquidity
              </p>
            </div>
            <div class="text-h5">
              + {{ formatNumber(loopingRewardAPR) }}%
            </div>
          </div>
          <div
            v-for="(campaign, idx) in loopingCampaigns"
            :key="idx"
            class="mt-12"
          >
            <div class="flex justify-between items-center">
              <div class="flex ml-32">
                <img
                  v-if="campaign.rewardToken.icon"
                  class="w-20 h-20 rounded-full"
                  :src="campaign.rewardToken.icon"
                  alt="Reward token logo"
                >
                <p :class="campaign.rewardToken.icon ? 'ml-12' : ''">
                  {{ campaign.rewardToken.symbol }} reward
                </p>
                <p class="ml-4 text-euler-dark-900">
                  (<a
                    v-if="campaign.sourceUrl"
                    :href="campaign.sourceUrl"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="underline"
                    @click.stop
                  >{{ PROVIDER_LABELS[campaign.source] || campaign.source }}</a><template v-else>
                    {{ PROVIDER_LABELS[campaign.source] || campaign.source }}
                  </template>{{ campaign.endDate ? `, ends ${campaign.endDate.toFormat('MMMM dd, yyyy')}` : '' }})
                </p>
              </div>
              <div class="text-p2">
                {{ formatNumber(campaign.apr) }}%
              </div>
            </div>
            <p
              v-if="campaign.minMultiplier || campaign.maxMultiplier"
              class="text-euler-dark-900 text-p4 mt-4 ml-32"
            >
              Requires multiplier
              <template v-if="campaign.minMultiplier && campaign.maxMultiplier">
                between {{ campaign.minMultiplier }}x and {{ campaign.maxMultiplier }}x
              </template>
              <template v-else-if="campaign.minMultiplier">
                of at least {{ campaign.minMultiplier }}x
              </template>
              <template v-else-if="campaign.maxMultiplier">
                of at most {{ campaign.maxMultiplier }}x
              </template>
            </p>
          </div>
          <p class="text-euler-dark-900 text-p4 mt-8">
            Looping reward is based on net liquidity and does not scale with multiplier.
          </p>
        </template>
      </div>
      <div class="flex justify-between items-center mb-16">
        <div>
          <p class="mb-4">
            Formula
          </p>
          <p class="text-euler-dark-900">
            <template v-if="hasLooping">
              M &times; S - (M - 1) &times; B + R = ROE
            </template>
            <template v-else>
              M &times; S - (M - 1) &times; B = ROE
            </template>
          </p>
        </div>
      </div>
    </div>

    <div class="bg-euler-dark-600 rounded-12 p-16 flex justify-between items-center mb-16">
      <div>
        <p>Max ROE</p>
        <p class="text-euler-dark-900 text-p3">
          Maximum return on equity at max multiplier
        </p>
      </div>
      <p
        class="text-h4"
        :class="[maxRoe >= 0 ? 'text-accent-600' : 'text-error-500']"
      >
        = {{ formatNumber(maxRoe) }}%
      </p>
    </div>
  </BaseModalWrapper>
</template>
