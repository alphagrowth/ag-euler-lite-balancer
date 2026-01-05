<script setup lang="ts">
import { useAccount } from '@wagmi/vue'
import { useModal } from '~/components/ui/composables/useModal'
import { OperationReviewModal, VaultSupplyApyModal, VaultUnverifiedDisclaimerModal } from '#components'
import { useToast } from '~/components/ui/composables/useToast'
import { computeAPYs, getVaultPrice, type Vault, type VaultAsset } from '~/entities/vault'
import type { TxPlan } from '~/entities/txPlan'
import { useEulerProductOfVault } from '~/composables/useEulerLabels'
import VaultFormInfoBlock from '~/components/entities/vault/form/VaultFormInfoBlock.vue'
import VaultFormSubmit from '~/components/entities/vault/form/VaultFormSubmit.vue'

const router = useRouter()
const route = useRoute()
const modal = useModal()
const { error } = useToast()
const { supply, buildSupplyPlan } = useEulerOperations()
const { getVault, updateVault } = useVaults()
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
const vault: Ref<Vault | undefined> = ref(await getVault(vaultAddress))
const asset: Ref<VaultAsset | undefined> = ref(vault.value?.asset)
const estimateSupplyAPY = ref(0n)
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
  return formatNumber(nanoToValue(vault.value.interestRateInfo.supplyAPY, 25) + totalRewardsAPY.value)
})
const estimateSupplyAPYDisplay = computed(() => {
  return formatNumber(nanoToValue(estimateSupplyAPY.value, 25))
})

const load = async () => {
  isLoading.value = true
  try {
    estimateSupplyAPY.value = vault.value!.interestRateInfo.supplyAPY + valueToNano(totalRewardsAPY.value, 25)

    if (!vault.value?.verified) {
      modal.open(VaultUnverifiedDisclaimerModal, {
        isNotClosable: true,
        props: {
          onCancel: () => {
            router.replace('/')
          },
        },
      })
    }
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
    const txHash = await supply(vaultAddress, asset.value.address, valueToNano(amount.value || '0', asset.value.decimals), asset.value.symbol)

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
    await updateVault(vault.value.address)
    if (!asset.value?.address) {
      return
    }
    const { supplyAPY } = await computeAPYs(
      vault.value.interestRateInfo.borrowSPY,
      vault.value.interestRateInfo.cash + valueToNano(amount.value, vault.value.decimals),
      vault.value.interestRateInfo.borrows,
      vault.value.interestFee,
    )
    estimateSupplyAPY.value = supplyAPY + valueToNano(totalRewardsAPY.value, 25)
    monthlyEarnings.value = !amount.value
      ? 0
      : (+(amount.value || 0) * nanoToValue(estimateSupplyAPY.value, 27)) / 12
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
      lendingAPY: nanoToValue(vault.value!.interestRateInfo.supplyAPY, 25),
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
      title="Open lend position"
      class="w-full"
      @submit.prevent="submit"
    >
      <div
        v-if="vault && asset"
        class="flex justify-between"
      >
        <VaultLabelsAndAssets
          :vault="vault"
          :assets="assets"
          size="large"
        />

        <div class="flex flex-col items-end justify-end">
          <p class="mb-4 text-euler-dark-900">
            Supply APY
          </p>

          <p class="flex justify-end gap-4 text-h3">
            <SvgIcon
              v-if="hasRewards"
              class="!w-24 !h-24 text-aquamarine-700"
              name="sparks"
            />
            <span>
              {{ supplyAPYDisplay }}%
            </span>
            <SvgIcon
              class="!w-24 !h-24 text-euler-dark-800 cursor-pointer"
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
        <div class="[&>*:not(:last-child)]:pb-16 [&>*:not(:last-child)]:mb-16 [&>*:not(:last-child)]:border-b [&>*:not(:last-child)]:border-white/10">
          <div>
            <p class="mb-8">
              Projected Earnings per Month
            </p>

            <p class="text-euler-dark-900">
              <span class="text-white text-p2">{{ compactNumber(monthlyEarnings) }}</span> {{
                asset.symbol
              }}
              ≈ ${{ vault ? compactNumber(getVaultPrice(monthlyEarnings, vault)) : 0 }}
            </p>
          </div>

          <div>
            <p class="mb-8">
              Supply APY
            </p>

            <p
              v-if="supplyAPYDisplay !== estimateSupplyAPYDisplay"
              class="text-p2 text-euler-dark-900"
            >
              {{ supplyAPYDisplay }}% <template v-if="supplyAPYDisplay !== estimateSupplyAPYDisplay">
                → <span class="text-white">{{ estimateSupplyAPYDisplay }}%</span>
              </template>
            </p>
            <p
              v-else
              class="text-p2 text-white"
            >
              {{ supplyAPYDisplay }}%
            </p>
          </div>
        </div>
      </VaultFormInfoBlock>

      <template #buttons>
        <VaultFormInfoButton
          class="laptop:!hidden"
          :vault="vault"
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
    <div class="w-full hidden laptop:!block">
      <VaultOverview
        v-if="vault"
        :vault="vault"
        desktop-overview
      />
    </div>
  </div>
</template>
