<script setup lang="ts">
import { useAccount } from '@wagmi/vue'
import { offset, useFloating } from '@floating-ui/vue'
import { DateTime } from 'luxon'
import { ethers } from 'ethers'
import { getVaultUtilization, type Vault } from '~/entities/vault'
import { formatAssetValue } from '~/services/pricing/priceProvider'
import { useEulerProductOfVault } from '~/composables/useEulerLabels'
import { getAssetLogoUrl } from '~/composables/useTokens'
import BaseLoadableContent from '~/components/base/BaseLoadableContent.vue'
import { useModal } from '~/components/ui/composables/useModal'
import { VaultUtilizationWarningModal } from '#components'

interface RewardInfo {
  id: string
  apr: number
  endDate: DateTime
  rewardToken: {
    symbol: string
    icon: string
  }
  source: string
}

const { isConnected } = useAccount()
const { vault } = defineProps<{ vault: Vault }>()
const product = useEulerProductOfVault(vault.address)
const isUnverified = computed(() => !vault.verified)
const displayName = computed(() => product.name || vault.name)
const { getBalance, isLoading: isBalancesLoading } = useWallets()
const { getOpportunityOfLendVault } = useMerkl()
const { getCampaignOfLendVault } = useBrevis()
const { withIntrinsicSupplyApy, getIntrinsicApy } = useIntrinsicApy()
const modal = useModal()

const balance = computed(() => getBalance(vault.asset.address as `0x${string}`))
const opportunityInfo = computed(() => getOpportunityOfLendVault(vault.address))
const brevisInfo = computed(() => getCampaignOfLendVault(vault.address))
const totalRewardsAPY = computed(() => (opportunityInfo.value?.apr || 0) + (brevisInfo.value?.reward_info.apr || 0) * 100)
const hasRewards = computed(() => opportunityInfo.value || brevisInfo.value)
const lendingAPY = computed(() => nanoToValue(vault.interestRateInfo.supplyAPY, 25))
const intrinsicAPY = computed(() => getIntrinsicApy(vault.asset.symbol))
const supplyApy = computed(() => withIntrinsicSupplyApy(
  lendingAPY.value,
  vault.asset.symbol,
))
const supplyApyWithRewards = computed(() => supplyApy.value + totalRewardsAPY.value)
const utilization = computed(() => getVaultUtilization(vault))
const isDeprecated = computed(() => {
  try {
    const addr = ethers.getAddress(vault.address)
    return product.deprecatedVaults?.includes(addr) ?? false
  }
  catch {
    return product.deprecatedVaults?.includes(vault.address) ?? false
  }
})
const deprecationReason = computed(() => (isDeprecated.value ? product.deprecationReason : ''))

// Tooltip state
const isTooltipVisible = ref(false)
const apyReference = ref<HTMLElement | null>(null)
const apyFloating = ref<HTMLElement | null>(null)
const hideTimeout = ref<NodeJS.Timeout | null>(null)

const { floatingStyles, update } = useFloating(apyReference, apyFloating, {
  placement: 'bottom-end',
  middleware: [
    offset({ mainAxis: 8 }),
  ],
})

const rewardsInfo = computed<RewardInfo[]>(() => {
  const rewards: RewardInfo[] = opportunityInfo.value?.campaigns
    .map((campaign) => {
      return {
        id: campaign.id,
        apr: campaign.apr,
        endDate: DateTime.fromSeconds(campaign.endTimestamp),
        rewardToken: {
          symbol: campaign.rewardToken.symbol,
          icon: campaign.rewardToken.icon,
        },
        source: 'merkl',
      }
    })
    .filter(campaign => campaign.endDate > DateTime.now()) || []

  if (brevisInfo.value) {
    rewards.push({
      id: brevisInfo.value.campaign_id,
      apr: brevisInfo.value.reward_info.apr * 100,
      endDate: DateTime.fromSeconds(brevisInfo.value.end_time),
      rewardToken: {
        symbol: brevisInfo.value.reward_info.token_symbol,
        icon: '',
      },
      source: 'brevis',
    })
  }

  return rewards.sort((a, b) => a.rewardToken.symbol.localeCompare(b.rewardToken.symbol))
})

const showTooltip = (event: MouseEvent | TouchEvent) => {
  event.stopPropagation()

  if (hideTimeout.value) {
    clearTimeout(hideTimeout.value)
    hideTimeout.value = null
  }

  isTooltipVisible.value = true
  nextTick(() => update())
}

const hideTooltip = (event?: MouseEvent | TouchEvent) => {
  event?.stopPropagation()

  hideTimeout.value = setTimeout(() => {
    isTooltipVisible.value = false
  }, 100)
}

const keepTooltipVisible = () => {
  if (hideTimeout.value) {
    clearTimeout(hideTimeout.value)
    hideTimeout.value = null
  }
}

const hideTooltipImmediate = () => {
  hideTimeout.value = setTimeout(() => {
    isTooltipVisible.value = false
  }, 100)
}

const totalSupplyPrice = computed(() => {
  const price = formatAssetValue(vault.totalAssets, vault)
  return price.hasPrice ? `$${compactNumber(price.usdValue)}` : price.display
})

const liquidityPrice = computed(() => {
  const liquidity = vault.supply - vault.borrow
  const price = formatAssetValue(liquidity, vault)
  return price.hasPrice ? `$${compactNumber(price.usdValue)}` : price.display
})

const walletBalancePrice = computed(() => {
  const price = formatAssetValue(balance.value, vault)
  return price.hasPrice ? `$${compactNumber(price.usdValue)}` : price.display
})

const onWarningClick = () => {
  modal.open(VaultUtilizationWarningModal)
}
</script>

<template>
  <NuxtLink
    class="block no-underline text-content-primary bg-surface rounded-12 border border-line-default shadow-card hover:shadow-card-hover hover:border-line-emphasis transition-all"
    :to="`/lend/${vault.address}`"
  >
    <div class="flex pb-12 p-16 border-b border-line-subtle">
      <BaseAvatar
        class="icon--40"
        :src="getAssetLogoUrl(vault.asset.symbol)"
        :label="vault.asset.symbol"
      />
      <div class="flex-grow ml-12">
        <div class="text-content-tertiary text-p3 mb-4 flex items-center gap-8">
          <VaultDisplayName
            :name="displayName"
            :is-unverified="isUnverified"
          />
          <span
            v-if="isDeprecated"
            class="inline-flex items-center gap-4 rounded-8 px-8 py-2 bg-[var(--c-red-opaque-200)] text-red-700 text-p5"
            :title="deprecationReason || 'This vault has been deprecated.'"
          >
            <SvgIcon name="warning" class="!w-14 !h-14" />
            Deprecated
          </span>
        </div>
        <div class="text-h5 text-content-primary">
          {{ vault.asset.symbol }}
        </div>
      </div>
      <div class="flex flex-col items-end">
        <div class="text-content-tertiary text-p3 mb-4 text-right">
          Supply APY
        </div>
        <div
          class="flex items-center"
        >
          <div class="mr-6">
            <VaultPoints :vault="vault" />
          </div>
          <div
            ref="apyReference"
            class="text-p2 flex items-center text-accent-600 font-semibold cursor-pointer relative"
            @mouseenter="showTooltip"
            @mouseleave="hideTooltip"
            @touchstart.prevent="showTooltip"
            @touchend.prevent="hideTooltip"
          >
            <SvgIcon
              v-if="hasRewards"
              class="!w-20 !h-20 text-accent-500 mr-4"
              name="sparks"
            />
            {{ formatNumber(supplyApyWithRewards) }}%
          </div>
        </div>
      </div>
    </div>
    <div class="flex-1 flex py-12 px-16 pb-12 justify-between mobile:border-b mobile:border-line-subtle">
      <div class="flex-1">
        <div class="text-content-tertiary text-p3 mb-4">
          Total supply
        </div>
        <div class="text-p2 text-content-primary">
          {{ totalSupplyPrice }}
        </div>
      </div>
      <div class="flex-1 flex flex-col items-center">
        <div class="text-content-tertiary text-p3 mb-4">
          Available liquidity
        </div>
        <div class="text-p2 text-content-primary">
          {{ liquidityPrice }}
        </div>
      </div>
      <div
        class="flex flex-col flex-1 mobile:!hidden"
        :class="isConnected ? 'justify-center items-center' : 'items-end text-right'"
      >
        <div class="text-content-tertiary text-p3 mb-4">
          Utilization
        </div>
        <div
          class="flex gap-8 justify-end items-center text-right"
        >
          <button
            v-if="utilization >= 95"
            class="flex justify-center items-center w-20 h-20 bg-warning-100 text-warning-500 rounded-4 cursor-pointer"
            @click.stop.prevent="onWarningClick"
          >
            <SvgIcon
              name="warning"
              class="!w-16 !h-16"
            />
          </button>
          <UiRadialProgress
            :value="utilization"
            :max="100"
          />
          <div class="text-p2 text-content-primary">
            {{ compactNumber(utilization, 2, 2) }}%
          </div>
        </div>
      </div>
      <div
        v-if="isConnected"
        class="flex flex-col flex-1 items-end text-right"
      >
          <div class="text-content-tertiary text-p3 mb-4">
            In wallet
          </div>
          <BaseLoadableContent
            :loading="isBalancesLoading"
            style="min-width: 70px; height: 20px"
          >
            <div class="text-p2 text-content-primary whitespace-nowrap">
              {{ walletBalancePrice }}
            </div>
          </BaseLoadableContent>
      </div>
    </div>
    <div class="hidden mobile:flex py-12 px-16 pb-16">
      <div class="flex-1">
        <div class="text-content-tertiary text-p3">
          Utilization
        </div>
      </div>
      <div
        class="flex gap-8 justify-end items-center text-right flex-1"
      >
        <button
          v-if="utilization >= 95"
          class="flex justify-center items-center w-20 h-20 bg-warning-100 text-warning-500 rounded-4 cursor-pointer"
          @click.stop.prevent="onWarningClick"
        >
          <SvgIcon
            name="warning"
            class="!w-16 !h-16"
          />
        </button>
        <UiRadialProgress
          :value="utilization"
          :max="100"
        />
        <div class="text-p2 text-content-primary">
          {{ compactNumber(utilization, 2, 2) }}%
        </div>
      </div>
    </div>
    <Transition name="tooltip">
      <div
        v-show="isTooltipVisible"
        ref="apyFloating"
        :style="floatingStyles"
        class="pointer-events-auto px-16 py-16 rounded-12 bg-euler-dark-500 border border-euler-dark-700 text-white z-50 min-w-[300px] max-w-[400px]"
        @mouseenter="keepTooltipVisible"
        @mouseleave="hideTooltipImmediate"
        @click.stop.prevent
      >
        <div class="mb-12">
          <div class="flex justify-between items-center mb-12">
            <div>
              <p class="text-p3 mb-2">
                Lending APY
              </p>
              <p class="text-p4 text-euler-dark-900">
                Yield from lending on Euler
              </p>
            </div>
            <div class="text-p2">
              {{ formatNumber(lendingAPY) }}%
            </div>
          </div>
          <div
            v-if="intrinsicAPY > 0"
            class="flex justify-between items-center mb-12"
          >
            <div>
              <p class="text-p3 mb-2">
                Intrinsic APY
              </p>
              <p class="text-p4 text-euler-dark-900">
                Yield intrinsic to the supplied asset
              </p>
            </div>
            <div class="text-p2">
              {{ formatNumber(intrinsicAPY) }}%
            </div>
          </div>
        </div>
        <div
          v-if="hasRewards"
          class="mb-12 pt-12 border-t border-euler-dark-600"
        >
          <div class="flex justify-between items-center mb-12">
            <div>
              <p class="text-p3 mb-2 flex gap-4 items-center">
                <SvgIcon
                  class="!w-16 !h-16 text-accent-500"
                  name="sparks"
                />
                <span>Rewards APY</span>
              </p>
              <p class="text-p4 text-euler-dark-900">
                Yield from token rewards
              </p>
            </div>
            <div class="text-p2">
              + {{ formatNumber(totalRewardsAPY) }}%
            </div>
          </div>
          <div
            v-for="reward in rewardsInfo"
            :key="reward.id"
            class="flex justify-between items-center mb-8"
          >
            <div class="flex items-center gap-8">
              <img
                v-if="reward.rewardToken.icon"
                class="w-16 h-16 rounded-full"
                :src="reward.rewardToken.icon"
                alt="Reward token logo"
              >
              <div>
                <p class="text-p4">
                  {{ reward.rewardToken.symbol === 'WTAC' ? 'TAC' : reward.rewardToken.symbol }}
                </p>
                <p class="text-p5 text-euler-dark-900">
                  {{ reward.source === 'brevis' ? 'Brevis, ' : '' }}ends {{ reward.endDate.toFormat('MMM dd, yyyy') }}
                </p>
              </div>
            </div>
            <div class="text-p4">
              {{ formatNumber(reward.apr) }}%
            </div>
          </div>
        </div>
        <div class="bg-euler-dark-600 rounded-8 p-12 flex justify-between items-center">
          <p class="text-p3">Total supply APY</p>
          <p class="text-p2 font-bold">
            {{ formatNumber(supplyApyWithRewards) }}%
          </p>
        </div>
      </div>
    </Transition>
  </NuxtLink>
</template>
