<script setup lang="ts">
import { useAccount } from '@wagmi/vue'
import { useModal } from '~/components/ui/composables/useModal'
import { OperationReviewModal, VaultSupplyApyModal } from '#components'
import { useToast } from '~/components/ui/composables/useToast'
import { getEarnVaultPrice, type EarnVault, type VaultAsset } from '~/entities/vault'
import type { TxPlan } from '~/entities/txPlan'
import { useEulerProductOfVault } from '~/composables/useEulerLabels'
import VaultFormInfoBlock from '~/components/entities/vault/form/VaultFormInfoBlock.vue'
import VaultFormSubmit from '~/components/entities/vault/form/VaultFormSubmit.vue'

const router = useRouter()
const route = useRoute()
const modal = useModal()
const { error } = useToast()
const { supply, buildSupplyPlan } = useEulerOperations()
const { getEarnVault, updateEarnVault } = useVaults()
const { isConnected } = useAccount()
const { getBalance } = useWallets()
const vaultAddress = route.params.vault as string
const { name } = useEulerProductOfVault(vaultAddress)
const { getOpportunityOfLendVault } = useMerkl()
const { getCampaignOfLendVault } = useBrevis()

const isLoading = ref(false)
const isSubmitting = ref(false)
const isEstimatesLoading = ref(false)
const amount = ref('')
const plan = ref<TxPlan | null>(null)
const vault: Ref<EarnVault | undefined> = ref(undefined)
const asset: Ref<VaultAsset | undefined> = ref(undefined)
const estimateSupplyAPY = ref(0)
const monthlyEarnings = ref(0)

const balance = computed(() => getBalance(asset.value?.address as `0x${string}`) || 0n)
const errorText = computed(() => {
  if (balance.value < valueToNano(amount.value, asset.value?.decimals)) {
    return 'Not enough balance'
  }
  return null
})
const assets = computed(() => [asset.value!])
const isSubmitDisabled = computed(() => {
  if (!isConnected.value) return false
  return balance.value < valueToNano(amount.value, asset.value?.decimals)
    || isLoading.value || !(+amount.value)
})
const opportunityInfo = computed(() => getOpportunityOfLendVault(vaultAddress))
const brevisInfo = computed(() => getCampaignOfLendVault(vaultAddress))
const totalRewardsAPY = computed(() => (opportunityInfo.value?.apr || 0) + (brevisInfo.value?.reward_info.apr || 0) * 100)
const hasRewards = computed(() => opportunityInfo.value || brevisInfo.value)
const supplyAPYDisplay = computed(() => {
  if (!vault.value) return '0.00'
  return formatNumber((vault.value!.supplyAPY || 0) + totalRewardsAPY.value)
})
const estimateSupplyAPYDisplay = computed(() => {
  return formatNumber(estimateSupplyAPY.value)
})

const load = async () => {
  isLoading.value = true
  try {
    vault.value = await getEarnVault(vaultAddress)
    asset.value = vault.value?.asset

    estimateSupplyAPY.value = (vault.value.supplyAPY || 0) + totalRewardsAPY.value
  }
  catch (e) {
    showError('Unable to load Vault')
    console.warn(e)
  }
  finally {
    isLoading.value = false
  }
}
const submit = async () => {
  if (!asset.value?.address) {
    return
  }

  try {
    plan.value = await buildSupplyPlan(
      vaultAddress,
      asset.value.address,
      valueToNano(amount.value || '0', asset.value.decimals),
      asset.value.symbol,
      undefined,
      { includePermit2Call: false },
    )
  }
  catch (e) {
    console.warn('[OperationReviewModal] failed to build plan', e)
    plan.value = null
  }

  modal.open(OperationReviewModal, {
    props: {
      type: 'supply',
      asset: asset.value,
      amount: amount.value,
      plan: plan.value || undefined,
      onConfirm: () => {
        setTimeout(() => {
          send()
        }, 400)
      },
    },
  })
}
const send = async () => {
  try {
    isSubmitting.value = true
    if (!asset.value?.address) {
      return
    }
    const _txHash = await supply(vaultAddress, asset.value.address, valueToNano(amount.value || '0', asset.value.decimals), asset.value.symbol)

    modal.close()
    await updateEstimates()
    setTimeout(() => {
      router.replace('/portfolio/saving')
    }, 400)
  }
  catch (e) {
    error('Transaction failed')
    console.warn(e)
  }
  finally {
    isSubmitting.value = false
  }
}
const updateEstimates = useDebounceFn(async () => {
  if (!vault.value) {
    return
  }
  try {
    await updateEarnVault(vault.value.address)
    if (!asset.value?.address) {
      return
    }
    estimateSupplyAPY.value = (vault.value.supplyAPY || 0) + totalRewardsAPY.value
    console.log(+(amount.value || 0) * (estimateSupplyAPY.value / 12 / 100))
    monthlyEarnings.value = !amount.value
      ? 0
      : +(amount.value || 0) * (estimateSupplyAPY.value / 12 / 100)
  }
  catch (e) {
    console.warn(e)
  }
  finally {
    isEstimatesLoading.value = false
  }
}, 500)
const onSupplyInfoIconClick = () => {
  modal.open(VaultSupplyApyModal, {
    props: {
      lendingAPY: vault.value!.supplyAPY || 0,
      opportunityInfo: opportunityInfo.value,
      brevisInfo: brevisInfo.value,
    },
  })
}

load()

watch(amount, async () => {
  if (!vault.value) {
    return
  }
  if (!isEstimatesLoading.value) {
    isEstimatesLoading.value = true
  }
  updateEstimates()
})
</script>

<template>
  <div class="flex gap-32">
    <VaultForm
      title="Open earn position"
      :class="$style.form"
      @submit.prevent="submit"
    >
      <div
        v-if="vault && asset"
        class="between"
      >
        <VaultLabelsAndAssets
          :vault="vault"
          :assets="assets"
          size="large"
        />

        <div class="right">
          <p class="mb-4 text-euler-dark-900">
            Supply APY
          </p>

          <p class="flex justify-end gap-4 h3">
            <SvgIcon
              v-if="hasRewards"
              class="icon--24 text-aquamarine-700"
              name="sparks"
            />
            <span>
              {{ supplyAPYDisplay }}%
            </span>
            <SvgIcon
              :class="$style.supplyInfoIcon"
              class="icon--24 text-euler-dark-800"
              name="question-circle"
              @click="onSupplyInfoIconClick"
            />
          </p>
        </div>
      </div>

      <AssetInput
        v-if="asset"
        v-model="amount"
        label="Deposit amount"
        :desc="name"
        :asset="asset"
        :vault="vault"
        :balance="balance"
        maxable
      />

      <UiToast
        v-show="errorText"
        title="Error"
        variant="error"
        :description="errorText || ''"
        size="compact"
      />

      <VaultFormInfoBlock
        v-if="vault && asset"
        :loading="isEstimatesLoading"
      >
        <div :class="$style.info">
          <div>
            <p class="mb-8">
              Projected Earnings per Month
            </p>

            <p class="text-euler-dark-900">
              <span class="text-white p2">{{ compactNumber(monthlyEarnings, 4) }}</span> {{
                asset.symbol
              }}
              ≈ ${{ vault ? compactNumber(getEarnVaultPrice(monthlyEarnings, vault)) : 0 }}
            </p>
          </div>

          <div>
            <p class="mb-8">
              Supply APY
            </p>

            <p
              v-if="supplyAPYDisplay !== estimateSupplyAPYDisplay"
              class="p2 text-euler-dark-900"
            >
              {{ supplyAPYDisplay }}% <template v-if="supplyAPYDisplay !== estimateSupplyAPYDisplay">
                → <span class="text-white">{{ estimateSupplyAPYDisplay }}%</span>
              </template>
            </p>
            <p
              v-else
              class="p2 text-white"
            >
              {{ supplyAPYDisplay }}%
            </p>
          </div>
        </div>
      </VaultFormInfoBlock>

      <template #buttons>
        <VaultFormInfoButton
          :earn-vault="vault"
          :class="$style.vaultInfoButton"
          :disabled="isLoading || isSubmitting"
        />
        <VaultFormSubmit
          :disabled="isSubmitDisabled"
          :loading="isSubmitting"
        >
          Review Supply
        </VaultFormSubmit>
      </template>
    </VaultForm>
    <div :class="$style.vaultDetails">
      <VaultOverviewEarn
        v-if="vault"
        :vault="vault as EarnVault"
        desktop-overview
      />
    </div>
  </div>
</template>

<style module lang="scss">
.form {
  width: 100%;
}

.vaultDetails {
  width: 100%;

  @include respond-to(mobile) {
    display: none;
  }
}

.vaultInfoButton {
  display: none;

  @include respond-to(mobile) {
    display: block;
  }
}

.info {
  & > *:not(:last-child) {
    padding-bottom: 16px;
    margin-bottom: 16px;
    border-bottom: 1px solid rgba(var(--white), 0.1);
  }
}

.supplyInfoIcon {
  cursor: pointer;
}
</style>
