<script setup lang="ts">
import { OperationReviewModal } from '#components'
import { useModal } from '~/components/ui/composables/useModal'
import { useToast } from '~/components/ui/composables/useToast'
import type { Reward } from '~/entities/merkl'

const { reward } = defineProps<{ reward: Reward }>()

const { isTokensLoading, rewardTokens, claimReward, loadRewards } = useMerkl()
const modal = useModal()
const { error } = useToast()
const { chainId } = useEulerAddresses()

const isClaiming = ref(false)

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
    loadRewards(chainId.value)
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
    modal.open(OperationReviewModal, {
      props: {
        type: 'reward',
        asset: reward.token,
        amount: amountToClaim.value,
        rewardInfo: reward,
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
    class="text-white bg-euler-dark-500 rounded-16 p-16"
  >
    <div
      class="flex flex-col gap-12"
    >
      <div class="flex justify-between items-center mb-12">
        <BaseAvatar
          :src="tokenIconUrl || '/img/euler-default.png'"
          class="icon--40"
        />
        <h4 class="text-h5 ml-12">
          {{ reward.token.symbol === 'WTAC' ? 'TAC' : reward.token.symbol }} <!-- TODO wtac -> tac @ useMerkl -->
        </h4>
        <div class="flex flex-col gap-8 ml-auto text-right">
          <p class="text-p2">
            {{ amountInUsd < 0.01 ? ' < $0.01' : `$${formatNumber(amountInUsd, 2)}` }}
          </p>
          <p class="text-p3 text-euler-dark-900">
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
