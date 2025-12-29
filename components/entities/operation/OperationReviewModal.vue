<script setup lang="ts">
import type { Reward } from '~/entities/merkl'
import type { Campaign } from '~/entities/brevis'
import type { VaultAsset } from '~/entities/vault'
import type { TxPlan } from '~/entities/txPlan'

const emits = defineEmits(['close', 'confirm'])

const { type, asset, rewardInfo, campaignInfo, amount, onConfirm, subAccount, hasBorrows, fee, plan } = defineProps<{
  type?: 'supply' | 'withdraw' | 'borrow' | 'repay' | 'reward' | 'brevis-reward' | 'disableCollateral'
  asset: VaultAsset
  amount: number | string
  fee?: number | string
  plan?: TxPlan
  supplyingAssetForBorrow?: VaultAsset
  supplyingAmount?: number | string
  rewardInfo?: Reward
  campaignInfo?: Campaign
  onConfirm: (disableOperator?: boolean, transferAssets?: boolean) => void
  subAccount?: string
  hasBorrows?: boolean
}>()

const { hasOperator } = useEulerAccount()
const { chain } = useWagmi()
const { estimatePlanFees } = useEstimatePlanFees()

const isEstimatingFee = ref(false)
const feeEstimate = ref<string | null>(null)

const nativeSymbol = computed(() => chain.value?.nativeCurrency?.symbol || 'ETH')

const loadFeeEstimate = async () => {
  if (!plan) {
    feeEstimate.value = null
    return
  }

  try {
    isEstimatingFee.value = true
    const res = await estimatePlanFees(plan)
    feeEstimate.value = res.totalNative
  }
  catch (err) {
    console.warn('[OperationReviewModal] fee estimate failed', err)
    feeEstimate.value = null
  }
  finally {
    isEstimatingFee.value = false
  }
}

watch(() => plan, () => {
  loadFeeEstimate()
}, { immediate: true })

const hasOperatorForPosition = computed(() => {
  if (!subAccount) return false
  return hasOperator(subAccount)
})

const disableOperator = ref(false)
const transferAssets = ref(false)

const canTransfer = computed(() => {
  return hasOperatorForPosition.value && !hasBorrows
})

const handleConfirm = () => {
  emits('close')
  onConfirm(disableOperator.value, transferAssets.value)
}

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
  if (type !== 'reward') return

  return `You're claiming ${formatNumber(amount)} tokens, ${formatNumber(eulerOnlyRewardsAmount.value || 0)} of them from Euler, ${formatNumber(Number(amount) - (eulerOnlyRewardsAmount.value || 0))} of them earned elsewhere`
})

const feeDisplay = computed(() => {
  if (isEstimatingFee.value) {
    return '...'
  }

  const value = feeEstimate.value ?? fee
  if (value === undefined || value === null || value === '') {
    return '-'
  }

  return `${formatNumber(value, 8, 0)} ${nativeSymbol.value}`
})
</script>

<template>
  <BaseModalWrapper
    :title="modalLabel"
    @close="$emit('close')"
  >
    <div class="flex flex-col gap-24">
      <div class="flexflex-col gap-16">
        <div
          v-if="type === 'borrow' && supplyingAssetForBorrow"
          class="flex-wrap gap-8 flex justify-between"
        >
          <p class="text-p3 text-euler-dark-900 be">
            Supplying
          </p>
          <div class="flex gap-8 items-center">
            <BaseAvatar
              class="icon--20"
              :src="''"
              :label="supplyingAssetForBorrow.symbol"
            />
            <p class="text-p2">
              {{ formatNumber(supplyingAmount, 8, 0) }} {{ supplyingAssetForBorrow.symbol }}
            </p>
          </div>
        </div>
        <div
          v-if="type !== 'disableCollateral'"
          class="flex-wrap gap-8 flex justify-between"
        >
          <p class="text-p3 text-euler-dark-900 be">
            {{ assetLabel }}
          </p>
          <div class="flex gap-8 items-center">
            <BaseAvatar
              class="icon--20"
              :src="''"
              :label="asset.symbol"
            />
            <p class="text-p2">
              {{ formatNumber(amount, 8, 0) }} {{ asset.symbol === 'WTAC' ? 'TAC' : asset.symbol }} <!-- TODO wtac -> tac @ useMerkl -->
            </p>
          </div>
        </div>
      </div>
      <div class="flex-wrap gap-8 bg-euler-dark-600 p-16 rounded-12 flex justify-between">
        <div class="flex gap-8 items-center">
          <UiIcon
            name="gas"
            class="!w-20 !h-20"
          />
          Transaction fee
        </div>
        <div class="flex gap-8 items-center">
          <span class="text-p2">&asymp; {{ feeDisplay }}</span>
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
      <div
        v-if="hasOperatorForPosition"
        class="flex-wrap gap-8 bg-euler-dark-600 p-16 rounded-12 flex justify-between"
      >
        <div class="flex flex-col gap-4">
          <p class="text-p3 text-white-900 ">
            Disable swap operator
          </p>
          <p class="p4 text-euler-dark-900">
            Remove operator authorization to prevent automated position management
          </p>
        </div>
        <UiSwitch v-model="disableOperator" />
      </div>
      <div
        v-if="disableOperator && canTransfer"
        class="flex-wrap gap-8 bg-euler-dark-600 p-16 rounded-12 flex justify-between"
      >
        <div class="flex flex-col gap-4">
          <p class="text-p3 text-white-900">
            Transfer assets to primary account
          </p>
          <p class="p4 text-euler-dark-900">
            Move all vault shares from this position to your primary account
          </p>
        </div>
        <UiSwitch v-model="transferAssets" />
      </div>
      <UiButton
        variant="primary"
        size="xlarge"
        rounded
        @click="handleConfirm"
      >
        {{ btnLabel }}
      </UiButton>
    </div>
  </BaseModalWrapper>
</template>
