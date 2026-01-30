<script setup lang="ts">
import type { Reward } from '~/entities/merkl'
import type { Campaign } from '~/entities/brevis'
import type { VaultAsset } from '~/entities/vault'
import type { TxPlan } from '~/entities/txPlan'

const emits = defineEmits(['close', 'confirm'])

interface REULUnlockInfo {
  unlockableAmount: number
  amountToBeBurned: number
  maturityDate: string
  daysUntilMaturity: number
}

const { type, asset, rewardInfo, campaignInfo, reulUnlockInfo, amount, onConfirm, fee, plan } = defineProps<{
  type?: 'supply' | 'withdraw' | 'borrow' | 'repay' | 'swap' | 'reward' | 'brevis-reward' | 'reul-unlock' | 'disableCollateral'
  asset: VaultAsset
  amount: number | string
  fee?: number | string
  plan?: TxPlan
  supplyingAssetForBorrow?: VaultAsset
  supplyingAmount?: number | string
  rewardInfo?: Reward
  campaignInfo?: Campaign
  reulUnlockInfo?: REULUnlockInfo
  onConfirm: () => void
  subAccount?: string
  hasBorrows?: boolean
}>()

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

const handleConfirm = () => {
  emits('close')
  onConfirm()
}

const btnLabel = computed(() => {
  switch (type) {
    case 'supply':
      return 'Supply'
    case 'withdraw':
      return 'Withdraw'
    case 'swap':
      return 'Swap'
    case 'reul-unlock':
      return 'Unlock'
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
    case 'swap':
      return 'Swap review'
    case 'reul-unlock':
      return 'Unlock review'
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
    case 'swap':
      return 'Swapping'
    case 'reward':
    case 'brevis-reward':
      return 'Claiming'
    case 'reul-unlock':
      return 'Unlocking'
    default:
      return 'Spending'
  }
})
const reulUnlockDisclaimerText = computed(() => {
  if (type !== 'reul-unlock' || !reulUnlockInfo) return

  return `This action will unlock ${formatNumber(reulUnlockInfo.unlockableAmount, 6)} EUL, and ${formatNumber(reulUnlockInfo.amountToBeBurned, 6)} EUL will be permanently burned. To fully redeem your EUL rewards, you must wait for the 6-month vesting period to complete (${reulUnlockInfo.daysUntilMaturity} days remaining, maturity date: ${reulUnlockInfo.maturityDate}).`
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
const totalClaimAmount = computed(() => {
  return Number(amount) < 0.01 ? '< 0.01' : formatNumber(amount)
})
const eulerClaimAmount = computed(() => {
  const eulerAmount = eulerOnlyRewardsAmount.value || 0
  return eulerAmount < 0.01 && eulerAmount > 0 ? '< 0.01' : formatNumber(eulerAmount)
})
const otherClaimAmount = computed(() => {
  const eulerAmount = eulerOnlyRewardsAmount.value || 0
  const otherAmount = Math.max(0, Number(amount) - eulerAmount)
  return otherAmount < 0.01 && otherAmount > 0 ? '< 0.01' : formatNumber(otherAmount)
})
const disclaimerText = computed(() => {
  if (type !== 'reward') return

  return `You're claiming ${totalClaimAmount.value} tokens, ${eulerClaimAmount.value} of them from Euler, ${otherClaimAmount.value} of them earned elsewhere`
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
              {{ formatNumber(amount, 8, 0) }} {{ asset.symbol }}
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
        v-if="type === 'reul-unlock'"
        title="Important"
        variant="warning"
        :description="reulUnlockDisclaimerText"
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
        @click="handleConfirm"
      >
        {{ btnLabel }}
      </UiButton>
    </div>
  </BaseModalWrapper>
</template>
