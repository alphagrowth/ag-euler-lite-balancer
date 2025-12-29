<script setup lang="ts">
import { OperationReviewModal } from '#components'
import { useModal } from '~/components/ui/composables/useModal'
import { useToast } from '~/components/ui/composables/useToast'
import type { Reward } from '~/entities/merkl'
import type { TxPlan } from '~/entities/txPlan'

const { reward } = defineProps<{ reward: Reward }>()

const { isTokensLoading, rewardTokens, claimReward, loadRewards, buildClaimRewardPlan } = useMerkl()
const modal = useModal()
const { error } = useToast()

const isClaiming = ref(false)
const plan = ref<TxPlan | null>(null)

const amount = computed(() => nanoToValue(reward.amount, reward.token.decimals))
const claimed = computed(() => nanoToValue(reward.claimed, reward.token.decimals))
const amountToClaim = computed(() => amount.value - claimed.value)
const amountInUsd = computed(() => amountToClaim.value * reward.token.price)
const tokenIconUrl = computed(() => {
  if (isTokensLoading.value) return null
  return rewardTokens.value.find(token => token.address === reward.token.address)!.icon
})

const claim = async () => {
  try {
    isClaiming.value = true

    await claimReward(reward)
    modal.close()
    loadRewards()
  }
  catch (e) {
    error('Transaction failed')
    console.warn(e)
  }
  finally {
    isClaiming.value = false
  }
}

const onClaimClick = async () => {
  try {
    try {
      plan.value = await buildClaimRewardPlan(reward)
    }
    catch (e) {
      console.warn('[OperationReviewModal] failed to build plan', e)
      plan.value = null
    }

    modal.open(OperationReviewModal, {
      props: {
        type: 'reward',
        asset: reward.token,
        amount: amountToClaim.value,
        rewardInfo: reward,
        plan: plan.value || undefined,
        onConfirm: () => {
          setTimeout(() => {
            claim()
          }, 400)
        },
      },
    })
  }
  catch (e) {
    console.warn(e)
  }
}
</script>

<template>
  <div
    :class="$style.VaultItem"
    class="text-white bg-euler-dark-500 br-16 p-16"
  >
    <div
      :class="$style.portfolioWrap"
      class="column gap-12"
    >
      <div class="between align-center mb-12">
        <BaseAvatar
          :src="tokenIconUrl || '/img/euler-default.png'"
          class="icon--40"
        />
        <h4 class="h5 ml-12">
          {{ reward.token.symbol === 'WTAC' ? 'TAC' : reward.token.symbol }} <!-- TODO wtac -> tac @ useMerkl -->
        </h4>
        <div class="column gap-8 ml-auto right">
          <p class="p2">
            {{ amountInUsd < 0.01 ? ' < $0.01' : `$${formatNumber(amountInUsd, 2)}` }}
          </p>
          <p class="p3 text-euler-dark-900">
            ~ {{ amountToClaim < 0.01 ? '< 0.01' : formatNumber(amountToClaim, 2) }} {{ reward.token.symbol === 'WTAC' ? 'TAC' : reward.token.symbol }} <!-- TODO wtac -> tac @ useMerkl -->
          </p>
        </div>
      </div>
      <UiButton
        rounded
        :loading="isClaiming"
        @click="onClaimClick"
      >
        Claim
      </UiButton>
    </div>
  </div>
</template>

<style lang="scss" module>
.VaultItem {
}
</style>
