<script setup lang="ts">
import { useAccount } from '@wagmi/vue'
import { offset, useFloating } from '@floating-ui/vue'
import { DateTime } from 'luxon'
import { getVaultPriceDisplay, getVaultUtilization, type Vault } from '~/entities/vault'
import { useEulerEntitiesOfVault, useEulerProductOfVault, useEulerVaultLabelOfVault } from '~/composables/useEulerLabels'
import { getEulerLabelEntityLogo } from '~/entities/euler/labels'
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
const vaultLabel = useEulerVaultLabelOfVault(vault.address)
const displayName = computed(() => vaultLabel.name || product.name || vault.name)
const entities = useEulerEntitiesOfVault(vault)
const { balances, isLoading: isBalancesLoading } = useWallets()
const { getOpportunityOfLendVault } = useMerkl()
const { getCampaignOfLendVault } = useBrevis()
const { withIntrinsicSupplyApy, getIntrinsicApy } = useIntrinsicApy()
const modal = useModal()

const entitiesLabels = computed(() => entities.map(e => e.name))
const entitiesLogos = computed(() => entities.map(e => getEulerLabelEntityLogo(e.logo)))

const balance = computed(() => balances.value.get(vault.asset.address) || 0n)
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
  const price = getVaultPriceDisplay(vault.totalAssets, vault)
  return price.hasPrice ? `$${compactNumber(price.usdValue)}` : price.display
})

const walletBalancePrice = computed(() => {
  const price = getVaultPriceDisplay(balance.value, vault)
  return price.hasPrice ? `$${compactNumber(price.usdValue)}` : price.display
})

const onWarningClick = () => {
  modal.open(VaultUtilizationWarningModal)
}
</script>

<template>
  <NuxtLink
    class="block no-underline text-white bg-euler-dark-500 rounded-16"
    :to="`/lend/${vault.address}`"
  >
    <div class="flex pb-12 p-16 border-b border-border-primary">
      <BaseAvatar
        class="icon--40"
        :src="getAssetLogoUrl(vault.asset.symbol)"
        :label="vault.asset.symbol"
      />
      <div class="flex-grow ml-12">
        <div class="text-euler-dark-900 text-p3 mb-4">
          {{ displayName }}
        </div>
        <div class="text-h5">
          {{ vault.asset.symbol }}
        </div>
      </div>
      <div class="flex flex-col items-end">
        <div class="text-euler-dark-900 text-p3 mb-4 text-right">
          Supply APY
        </div>
        <div
          class="flex items-center "
        >
          <div class="mr-6">
            <VaultPoints :vault="vault" />
          </div>
          <div
            ref="apyReference"
            class="text-p2 flex items-center text-aquamarine-700 cursor-pointer relative"
            @mouseenter="showTooltip"
            @mouseleave="hideTooltip"
            @touchstart.prevent="showTooltip"
            @touchend.prevent="hideTooltip"
          >
            <SvgIcon
              v-if="hasRewards"
              class="!w-20 !h-20 text-aquamarine-700 mr-4"
              name="sparks"
            />
            {{ formatNumber(supplyApyWithRewards) }}%
          </div>
        </div>
      </div>
    </div>
    <div class="flex-1 flex py-12 px-16 pb-12 justify-between mobile:border-b mobile:border-border-primary">
      <div class="flex-1">
        <div class="text-euler-dark-900 text-p3 mb-4">
          Total supply
        </div>
        <div class="text-p2">
          {{ totalSupplyPrice }}
        </div>
      </div>
      <div class="flex-1 flex flex-col items-center">
        <div class="text-euler-dark-900 text-p3 mb-4">
          Risk curator
        </div>
        <BaseAvatar
          class="icon--20"
          :label="entitiesLabels"
          :src="entitiesLogos"
        />
      </div>
      <div
        class="flex justify-center items-center flex-col flex-1 mobile:!hidden"
      >
        <div class="text-euler-dark-900 text-p3 mb-4">
          Utilization
        </div>
        <div
          class="flex gap-8 justify-end items-center text-right"
        >
          <button
            v-if="utilization >= 95"
            class="flex justify-center items-center w-20 h-20 bg-[#3e4540] text-yellow-600 rounded-4 cursor-pointer"
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
          <div class="text-p2">
            {{ compactNumber(utilization, 2, 2) }}%
          </div>
        </div>
      </div>
      <div
        class="flex flex-col flex-1 items-end text-right"
      >
        <template v-if="isConnected">
          <div class="text-euler-dark-900 text-p3 mb-4">
            In wallet
          </div>
          <BaseLoadableContent
            :loading="isBalancesLoading"
            style="width: 70px; height: 20px"
          >
            <div class="text-p2">
              {{ walletBalancePrice }}
            </div>
          </BaseLoadableContent>
        </template>
      </div>
    </div>
    <div class="hidden mobile:flex py-12 px-16 pb-16">
      <div class="flex-1">
        <div class="text-euler-dark-900 text-p3">
          Utilization
        </div>
      </div>
      <div
        class="flex gap-8 justify-end items-center text-right flex-1"
      >
        <button
          v-if="utilization >= 95"
          class="flex justify-center items-center w-20 h-20 bg-[#3e4540] text-yellow-600 rounded-4 cursor-pointer"
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
        <div class="text-p2">
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
                  class="!w-16 !h-16 text-aquamarine-700"
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
