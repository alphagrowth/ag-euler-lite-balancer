<script setup lang="ts">
import { OperationReviewModal } from '#components'
import { useModal } from '~/components/ui/composables/useModal'
import { useToast } from '~/components/ui/composables/useToast'
import type { Campaign } from '~/entities/brevis'
import { getAssetLogoUrl } from '~/composables/useTokens'

const { campaign } = defineProps<{ campaign: Campaign }>()

const { getVault } = useVaults()
const { claimReward, loadRewards } = useBrevis()
const modal = useModal()
const { error } = useToast()

const vault = ref(await getVault(campaign.vault_address))
const isClaiming = ref(false)
const rewardAmount = computed(() => Number.parseFloat(campaign.reward_info.reward_amt))
const rewardUsdValue = computed(() => rewardAmount.value * Number.parseFloat(campaign.reward_info.reward_usd_price))
const actionLabel = computed(() => campaign.action === 2001 ? 'Borrow' : 'Lend')

const claim = async () => {
  try {
    isClaiming.value = true

    await claimReward(campaign)
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
    modal.open(OperationReviewModal, {
      props: {
        type: 'brevis-reward',
        asset: {
          symbol: campaign.reward_info.token_symbol,
          address: campaign.reward_info.token_address,
          decimals: 18,
        },
        amount: rewardAmount.value,
        campaignInfo: campaign,
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
        <div class="flex items-center">
          <BaseAvatar
            v-if="vault"
            :src="getAssetLogoUrl(vault.asset.address)"
            class="icon--40"
          />
          <div class="ml-12">
            <h4 class="text-h5 mb-4">
              {{ campaign.reward_info.token_symbol }}
            </h4>
            <p class="text-p3 text-euler-dark-900">
              {{ actionLabel }} {{ vault?.asset.symbol }}
            </p>
          </div>
        </div>
        <div class="flex flex-col gap-8 text-right">
          <p class="text-p2">
            {{ rewardUsdValue < 0.01 ? ' < $0.01' : `$${formatNumber(rewardUsdValue, 2)}` }}
          </p>
          <p class="text-p3 text-euler-dark-900">
            ~ {{ rewardAmount < 0.01 ? '< 0.01' : formatNumber(rewardAmount, 2) }} {{ campaign.reward_info.token_symbol }}
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
