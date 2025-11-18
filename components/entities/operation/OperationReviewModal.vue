<script setup lang="ts">
import type { Reward } from '~/entities/merkl'
import type { Campaign } from '~/entities/brevis'
import type { VaultAsset } from '~/entities/vault'

defineEmits(['close', 'confirm'])
const { type, asset, rewardInfo, campaignInfo, amount, onConfirm } = defineProps<{
  type?: 'supply' | 'withdraw' | 'borrow' | 'reward' | 'brevis-reward' | 'disableCollateral'
  asset: VaultAsset
  amount: number | string
  supplyingAssetForBorrow?: VaultAsset
  supplyingAmount?: number | string
  rewardInfo?: Reward
  campaignInfo?: Campaign
  onConfirm: () => void
}>()

const btnLabel = computed(() => {
  switch (type) {
    case 'supply':
      return 'Supply'
    case 'withdraw':
      return 'Withdraw'
    default:
      return 'Submit'
  }
})
const modalLabel = computed(() => {
  switch (type) {
    case 'supply':
      return 'Supply review'
    case 'withdraw':
      return 'Withdraw review'
    default:
      return 'Operation review'
  }
})
const assetLabel = computed(() => {
  switch (type) {
    case 'supply':
      return 'Supplying'
    case 'withdraw':
      return 'Withdraw'
    case 'borrow':
      return 'Borrowing'
    case 'reward':
    case 'brevis-reward':
      return 'Claiming'
    default:
      return 'Spending'
  }
})
const anyNonEulerReward = computed(() => {
  return !!(rewardInfo?.breakdowns.find(breakdown => !breakdown.reason.startsWith('EULER')))
})
const eulerOnlyRewardsAmount = computed(() => {
  return rewardInfo?.breakdowns
    .filter(breakdown => breakdown.reason.startsWith('EULER'))
    .reduce((prev, curr) => {
      return prev + nanoToValue(BigInt(curr.amount) - BigInt(curr.claimed), rewardInfo.token.decimals)
    }, 0)
})
const disclaimerText = computed(() => {
  if (type === 'brevis-reward') {
    return `You're claiming ${formatNumber(amount)} tokens from Brevis Incentra campaign`
  }
  if (type !== 'reward') return

  return `You're claiming ${formatNumber(amount)} tokens, ${formatNumber(eulerOnlyRewardsAmount.value || 0)} of them from Euler, ${formatNumber(Number(amount) - (eulerOnlyRewardsAmount.value || 0))} of them earned elsewhere`
})
</script>

<template>
  <BaseModalWrapper
    :title="modalLabel"
    @close="$emit('close')"
  >
    <div class="flex column gap-24">
      <div class="column gap-16">
        <div
          v-if="type === 'borrow' && supplyingAssetForBorrow"
          class="flex-wrap gap-8 between"
        >
          <p class="p3 text-euler-dark-900 be">
            Supplying
          </p>
          <div class="flex gap-8 align-center">
            <BaseAvatar
              class="icon--20"
              :src="''"
              :label="supplyingAssetForBorrow.symbol"
            />
            <p class="p2">
              {{ formatNumber(supplyingAmount, 8, 0) }} {{ supplyingAssetForBorrow.symbol }}
            </p>
          </div>
        </div>
        <div v-if="type !== 'disableCollateral'" class="flex-wrap gap-8 between">
          <p class="p3 text-euler-dark-900 be">
            {{ assetLabel }}
          </p>
          <div class="flex gap-8 align-center">
            <BaseAvatar
              class="icon--20"
              :src="''"
              :label="asset.symbol"
            />
            <p class="p2">
              {{ formatNumber(amount, 8, 0) }} {{ asset.symbol === 'WTAC' ? 'TAC' : asset.symbol }} <!-- TODO wtac -> tac @ useMerkl -->
            </p>
          </div>
        </div>
      </div>
      <div class="flex-wrap gap-8 bg-euler-dark-600 p-16 br-12 between">
        <div class="flex gap-8 align-center">
          <UiIcon
            name="gas"
            class="icon--20"
          />
          Transaction fee
        </div>
        <div class="flex gap-8 align-center">
          <span class="p2">&lt; 0.3 TON</span>
        </div>
      </div>
      <UiToast
        v-if="type === 'reward' && anyNonEulerReward"
        title="Disclaimer"
        variant="warning"
        :description="disclaimerText"
        size="compact"
      />
      <UiToast
        v-if="type === 'disableCollateral'"
        title="Disclaimer"
        variant="warning"
        description="Disabling collateral will move this deposit to savings"
        size="compact"
      />
      <UiButton
        variant="primary"
        size="xlarge"
        rounded
        @click="$emit('close'); onConfirm()"
      >
        {{ btnLabel }}
      </UiButton>
    </div>
  </BaseModalWrapper>
</template>

<style module lang="scss">
.OperationReviewModal {
  &._success {
    .icon {
      border-color: var(--c-green-opaque-1000);
      background-color: var(--c-green-opaque-300);
    }
  }

  &._error {
    .icon {
      border-color: var(--c-red-opaque-1000);
      background-color: var(--c-red-opaque-300);
    }
  }
}

.icon {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  border: 1px solid var(--c-euler-dark-700);
  background-color: var(--c-euler-dark-600);
}
</style>
