<script setup lang="ts">
import { Address, fromNano, TonClient } from '@ton/ton'
import { useModal } from '~/components/ui/composables/useModal'
import OperationTrackerTransactionModal
  from '~/components/entities/operation/OperationTrackerTransactionModal.vue'
import { OperationReviewModal, VaultSupplyApyModal } from '#components'
import { useToast } from '~/components/ui/composables/useToast'
import { computeAPYs, getVaultPrice, type Vault, type VaultAsset } from '~/entities/vault'
import { useEulerProductOfVault } from '~/composables/useEulerLabels'
import VaultFormInfoBlock from '~/components/entities/vault/form/VaultFormInfoBlock.vue'
import VaultFormSubmit from '~/components/entities/vault/form/VaultFormSubmit.vue'

let tvmAssetAddress: string

const router = useRouter()
const route = useRoute()
const modal = useModal()
const { error } = useToast()
const { supply } = useEulerOperations()
const { getVault, updateVault } = useVaults()
const { isLoaded: isSdkLoaded } = useTacSdk()
const { isConnected, address, friendlyAddress } = useTonConnect()
const vaultAddress = route.params.vault as string
const { name } = useEulerProductOfVault(vaultAddress)
const { walletState } = useWallets()
const { getOpportunityOfLendVault } = useMerkl()
const { TVM_TONCENTER_URL } = useConfig()

const isLoading = ref(false)
const isSubmitting = ref(false)
const isBalanceLoading = ref(false)
const isEstimatesLoading = ref(false)
const amount = ref('')
const vault: Ref<Vault | undefined> = ref()
const asset: Ref<VaultAsset | undefined> = ref()
const balance = ref(0n)
const estimateSupplyAPY = ref(0n)
const monthlyEarnings = ref(0)

const errorText = computed(() => {
  if (balance.value < valueToNano(amount.value, asset.value?.decimals)) {
    return 'Not enough balance'
  }
  return null
})
const assets = computed(() => [asset.value!])
const isSubmitDisabled = computed(() => {
  if (!isConnected.value) return false
  if (walletState.value !== 'active') return true
  return balance.value < valueToNano(amount.value, asset.value?.decimals)
    || isLoading.value || !isSdkLoaded.value || !(+amount.value)
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
    const { tacSdk } = useTacSdk()
    vault.value = await getVault(vaultAddress)
    asset.value = vault.value?.asset
    estimateSupplyAPY.value = vault.value.interestRateInfo.supplyAPY + valueToNano(opportunityInfo.value?.apr || 0, 25)
    tvmAssetAddress = await tacSdk.getTVMTokenAddress(asset.value?.address)
    updateBalance()
  }
  catch (e) {
    showError('Unable to load Vault')
    console.warn(e)
  }
  finally {
    isLoading.value = false
  }
}
const updateBalance = async (isInitialLoading = true) => {
  const { tacSdk } = useTacSdk()
  if (!isConnected.value) {
    balance.value = 0n
    return
  }
  if (isInitialLoading) {
    isBalanceLoading.value = true
  }

  if (asset.value!.symbol === 'TON') {
    const client = new TonClient({
      endpoint: `${TVM_TONCENTER_URL}/api/v2/jsonRPC`,
    })
    balance.value = await client.getBalance(Address.parse(friendlyAddress.value))
  }
  else {
    balance.value = await tacSdk.getUserJettonBalance(address.value, tvmAssetAddress).catch((e) => {
      console.warn(e)
      return 0n
    })
  }
  isBalanceLoading.value = false
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
        updateBalance()
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

watch(isSdkLoaded, (val) => {
  if (val) {
    load()
  }
}, { immediate: true })
watch(isConnected, () => {
  updateBalance()
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

const interval = setInterval(() => {
  updateBalance(false)
}, 5000)

onUnmounted(() => {
  clearInterval(interval)
})
</script>

<template>
  <VaultForm
    title="Open lend position"
    :loading="isLoading || !isSdkLoaded"
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
      :balance-loading="isBalanceLoading"
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

    <WalletInactiveDisclaimer
      v-if="walletState && walletState !== 'active'"
    />

    <template #buttons>
      <VaultFormInfoButton
        :vault="vault"
        :disabled="isLoading || !isSdkLoaded || isSubmitting"
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
