<script setup lang="ts">
import { FixedNumber } from 'ethers'
import { useModal } from '~/components/ui/composables/useModal'
import OperationTrackerTransactionModal
  from '~/components/entities/operation/OperationTrackerTransactionModal.vue'
import { OperationReviewModal } from '#components'
import { useToast } from '~/components/ui/composables/useToast'
import {
  computeAPYs,
  convertSharesToAssets,
  getVaultPrice,
  type Vault,
  type VaultAsset,
} from '~/entities/vault'
import { nanoToValue } from '~/utils/ton-utils'

const { error } = useToast()
const modal = useModal()

const route = useRoute()
const { getVault } = useVaults()
const { withdraw, redeem } = useEulerOperations()
const { isLoaded: isSdkLoaded } = useTacSdk()
const { updateBalances } = useWallets()
const { getOpportunityOfLendVault } = useMerkl()
const { isConnected, address, tonConnectUI, friendlyAddress } = useTonConnect()
const { TVM_TONCENTER_URL } = useAppConfig()
const vaultAddress = route.params.vault as string
let tvmAssetAddress: string

const isLoading = ref(false)
const isSubmitting = ref(false)
const isBalanceLoading = ref(false)
const isEstimatesLoading = ref(false)
const amount = ref('')
const vault: Ref<Vault | undefined> = ref()
const asset: Ref<VaultAsset | undefined> = ref()
const assetsBalance = ref(0n)
const sharesBalance = ref(0n)
const delta = ref(0n)
const estimateSupplyAPY = ref(0n)
const estimatesError = ref('')
const oldSharesBalance = ref(-1n)

const opportunityInfo = computed(() => getOpportunityOfLendVault(vault.value?.address || ''))
const amountFixed = computed(() => {
  return FixedNumber.fromValue(
    valueToNano(amount.value || '0', asset.value?.decimals || 0),
    Number(asset.value?.decimals || 0),
    { decimals: Number(asset.value?.decimals || 0) },
  )
})
const isSubmitDisabled = computed(() => {
  if (!isConnected.value) return false
  return assetsBalance.value < amountFixed.value.value
    || isLoading.value || !isSdkLoaded.value
    || amountFixed.value.isZero() || amountFixed.value.isNegative()
    || !!(estimatesError.value)
})
const friendlyBalance = computed(() => nanoToValue(assetsBalance.value, asset.value?.decimals || 18))
const supplyAPYDisplay = computed(() => {
  if (!vault.value) return '0.00'
  return formatNumber(nanoToValue(vault.value.interestRateInfo.supplyAPY, 25) + (opportunityInfo.value?.apr || 0))
})
const estimateSupplyAPYDisplay = computed(() => {
  return formatNumber(nanoToValue(estimateSupplyAPY.value, 25) + (opportunityInfo.value?.apr || 0))
})

const load = async () => {
  isLoading.value = true
  try {
    const { tacSdk } = useTacSdk()
    vault.value = await getVault(vaultAddress)
    estimateSupplyAPY.value = vault.value.interestRateInfo.supplyAPY
    asset.value = vault.value?.asset
    tvmAssetAddress = await tacSdk.getTVMTokenAddress(vault.value?.address)
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
    assetsBalance.value = 0n
    return
  }
  if (isInitialLoading) {
    isBalanceLoading.value = true
  }

  sharesBalance.value = await tacSdk.getUserJettonBalance(address.value, tvmAssetAddress).catch(_ => 0n)

  if (oldSharesBalance.value === sharesBalance.value) return
  oldSharesBalance.value = sharesBalance.value

  assetsBalance.value = await convertSharesToAssets(
    vaultAddress,
    sharesBalance.value,
  )
  delta.value = assetsBalance.value
  isBalanceLoading.value = false
}
const submit = async () => {
  // TODO: Validate
  if (!isConnected.value) {
    tonConnectUI.openModal()
    isSubmitting.value = false
    return
  }

  modal.open(OperationReviewModal, {
    props: {
      type: 'withdraw',
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
    const method = FixedNumber.fromValue(assetsBalance.value, asset.value?.decimals).lte(amountFixed.value) ? redeem : withdraw
    const tl = await method(
      vaultAddress,
      asset.value!.address,
      amountFixed.value.value,
      asset.value.symbol,
      undefined,
      sharesBalance.value,
      FixedNumber.fromValue(assetsBalance.value, asset.value?.decimals).lte(amountFixed.value),
    )
    modal.open(OperationTrackerTransactionModal, {
      props: { transactionLinker: tl },
      onClose: async () => {
        await updateBalance()
        await updateBalances()
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
  estimatesError.value = ''
  if (!vault.value) {
    return
  }
  try {
    if (assetsBalance.value < amountFixed.value.value) {
      throw new Error('Not enough balance')
    }

    if ((vault.value.supply - vault.value.borrow) < amountFixed.value.value) {
      throw new Error('Not enough liquidity in vault')
    }

    delta.value = assetsBalance.value - amountFixed.value.value
    const { supplyAPY } = await computeAPYs(
      vault.value.interestRateInfo.borrowSPY,
      (vault.value.supply - vault.value.borrow) - valueToNano(amount.value, vault.value.decimals),
      vault.value.interestRateInfo.borrows,
      vault.value.interestFee,
    )
    estimateSupplyAPY.value = supplyAPY
  }
  catch (e) {
    console.warn(e)
    delta.value = assetsBalance.value || 0n
    estimateSupplyAPY.value = vault.value.interestRateInfo.supplyAPY
    estimatesError.value = (e as { message: string }).message
  }
  finally {
    isEstimatesLoading.value = false
  }
}, 500)

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
    title="Withdraw"
    :class="$style.LendVaultPage"
    class="column gap-16"
    :loading="isLoading || !isSdkLoaded"
    @submit.prevent="submit"
  >
    <template v-if="vault && asset">
      <div class="between">
        <VaultLabelsAndAssets
          :vault="vault"
          :assets="[asset]"
          size="large"
        />
      </div>

      <AssetInput
        v-if="asset"
        v-model="amount"
        label="Withdraw amount"
        :asset="asset"
        :vault="vault"
        :balance="assetsBalance"
        :balance-loading="isBalanceLoading"
        maxable
      />

      <UiToast
        v-show="estimatesError"
        title="Error"
        variant="error"
        :description="estimatesError"
        size="compact"
      />

      <VaultFormInfoBlock
        :loading="isEstimatesLoading || isBalanceLoading"
        class="column gap-16"
      >
        <div class="between align-center">
          <p class="text-euler-dark-900">
            Supply APY
          </p>
          <p
            v-if="supplyAPYDisplay !== estimateSupplyAPYDisplay"
            class="p2 text-euler-dark-900"
          >
            {{ supplyAPYDisplay }}% → <span class="text-white">{{ estimateSupplyAPYDisplay }}%</span>
          </p>
          <p
            v-else
            class="p2 text-white"
          >
            {{ supplyAPYDisplay }}%
          </p>
        </div>
        <div class="between align-center">
          <p class="text-euler-dark-900">
            Deposit
          </p>
          <p class="p2 text-euler-dark-900">
            ${{ formatNumber(getVaultPrice(assetsBalance, vault)) }} <template v-if="amount && delta !== assetsBalance && delta >= 0n">
              → <span class="text-white">${{ formatNumber(getVaultPrice(delta, vault)) }}</span>
            </template>
          </p>
        </div>
        <div class="between align-center">
          <p class="text-euler-dark-900">
            Available for withdraw
          </p>
          <p
            v-if="asset"
            class="p2 align-center gap-4"
          >
            {{ formatNumber(friendlyBalance, 2) }} <span class="p3 text-euler-dark-900">{{ asset.symbol }}</span>
            <span class="p3 text-euler-dark-900">≈ ${{ formatNumber(getVaultPrice(friendlyBalance, vault)) }}</span>
          </p>
        </div>
      </VaultFormInfoBlock>
    </template>

    <template #buttons>
      <VaultFormSubmit
        :loading="isSubmitting"
        :disabled="isSubmitDisabled"
      >
        Withdraw review
      </VaultFormSubmit>
    </template>
  </VaultForm>
</template>

<style module lang="scss">
.LendVaultPage {
  min-height: calc(100dvh - 178px);
}
</style>
