<script setup lang="ts">
import { useAccount, useBalance } from '@wagmi/vue'
import { useModal } from '~/components/ui/composables/useModal'
import OperationTrackerTransactionModal
  from '~/components/entities/operation/OperationTrackerTransactionModal.vue'
import { OperationReviewModal, VaultSupplyApyModal } from '#components'
import { useToast } from '~/components/ui/composables/useToast'
import { computeAPYs, getVaultPrice, type Vault, type VaultAsset } from '~/entities/vault'
import { useEulerProductOfVault } from '~/composables/useEulerLabels'
import VaultFormInfoBlock from '~/components/entities/vault/form/VaultFormInfoBlock.vue'
import VaultFormSubmit from '~/components/entities/vault/form/VaultFormSubmit.vue'

const router = useRouter()
const route = useRoute()
const modal = useModal()
const { error } = useToast()
const { supply } = useEulerOperations()
const { getVault, updateVault } = useVaults()
const { address, isConnected } = useAccount()
const vaultAddress = route.params.vault as string
const { name } = useEulerProductOfVault(vaultAddress)
const { getOpportunityOfLendVault } = useMerkl()

const isLoading = ref(false)
const isSubmitting = ref(false)
const isEstimatesLoading = ref(false)
const amount = ref('')
const vault: Ref<Vault | undefined> = ref(await getVault(vaultAddress))
const asset: Ref<VaultAsset | undefined> = ref(vault.value?.asset)
const balance = ref(0n)
const estimateSupplyAPY = ref(0n)
const monthlyEarnings = ref(0)

const {
  data: tokenBalance, isLoading: isTokenBalanceLoading,
} = useBalance({ address: address, token: asset.value?.address as `0x${string}` })

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
const supplyAPYDisplay = computed(() => {
  if (!vault.value) return '0.00'
  return formatNumber(nanoToValue(vault.value.interestRateInfo.supplyAPY, 25) + (opportunityInfo.value?.apr || 0))
})
const estimateSupplyAPYDisplay = computed(() => {
  return formatNumber(nanoToValue(estimateSupplyAPY.value, 25))
})

const load = async () => {
  isLoading.value = true
  try {
    estimateSupplyAPY.value = vault.value!.interestRateInfo.supplyAPY + valueToNano(opportunityInfo.value?.apr || 0, 25)
  }
  catch (e) {
    showError('Unable to load Vault')
    console.warn(e)
  }
  finally {
    isLoading.value = false
  }
}
const updateBalance = async () => {
  if (!isConnected.value) {
    balance.value = 0n
    return
  }
  balance.value = tokenBalance.value?.value || 0n
}
const submit = async () => {
  modal.open(OperationReviewModal, {
    props: {
      type: 'supply',
      asset: asset.value,
      amount: amount.value,
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
    const tl = await supply(vaultAddress, asset.value.address, valueToNano(amount.value || '0', asset.value.decimals), asset.value.symbol)
    modal.open(OperationTrackerTransactionModal, {
      props: { transactionLinker: tl },
      onClose: () => {
        updateEstimates()
        setTimeout(() => {
          router.replace('/portfolio/saving')
        }, 400)
      },
    })
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
    const { supplyAPY } = await computeAPYs(
      vault.value.interestRateInfo.borrowSPY,
      vault.value.interestRateInfo.cash + valueToNano(amount.value, vault.value.decimals),
      vault.value.interestRateInfo.borrows,
      vault.value.interestFee,
    )
    estimateSupplyAPY.value = supplyAPY + valueToNano(opportunityInfo.value?.apr || 0, 25)
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
    },
  })
}

load()

watch(tokenBalance, () => {
  if (!isLoading.value) {
    updateBalance()
  }
})
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
  <VaultForm
    title="Open lend position"
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
            v-if="opportunityInfo"
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
      :balance-loading="isTokenBalanceLoading"
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
            <span class="text-white p2">{{ compactNumber(monthlyEarnings) }}</span> {{
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
</template>

<style module lang="scss">
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
