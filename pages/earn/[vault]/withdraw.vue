<script setup lang="ts">
import { useAccount } from '@wagmi/vue'
import { FixedPoint } from '~/utils/fixed-point'
import { useModal } from '~/components/ui/composables/useModal'
import { OperationReviewModal } from '#components'
import { useTermsOfUseGate } from '~/composables/useTermsOfUseGate'
import { useToast } from '~/components/ui/composables/useToast'
import {
  convertSharesToAssets,
  type EarnVault,
  type VaultAsset,
} from '~/entities/vault'
import { getAssetUsdValueOrZero } from '~/services/pricing/priceProvider'
import type { TxPlan } from '~/entities/txPlan'

const router = useRouter()
const route = useRoute()
const modal = useModal()
const { error } = useToast()
const { getSubmitLabel, getSubmitDisabled, guardWithTerms } = useTermsOfUseGate()
const reviewWithdrawLabel = getSubmitLabel('Review Withdraw')
const { buildWithdrawPlan, buildRedeemPlan, executeTxPlan } = useEulerOperations()
const { getEarnVault } = useVaults()
const { isConnected } = useAccount()
const { fetchVaultShareBalance } = useWallets()
const { runSimulation, simulationError, clearSimulationError } = useTxPlanSimulation()
const { getOpportunityOfLendVault } = useMerkl()
const vaultAddress = route.params.vault as string

const isLoading = ref(false)
const isSubmitting = ref(false)
const isEstimatesLoading = ref(false)
const amount = ref('')
const plan = ref<TxPlan | null>(null)
const vault: Ref<EarnVault | undefined> = ref()
const asset: Ref<VaultAsset | undefined> = ref()
const assetsBalance = ref(0n)
const sharesBalance = ref(0n)
const delta = ref(0n)
const estimateSupplyAPY = ref(0)
const estimatesError = ref('')

// Reactive USD prices for display
const assetsBalanceUsd = ref(0)
const deltaUsd = ref(0)

const opportunityInfo = computed(() => getOpportunityOfLendVault(vault.value?.address || ''))
const amountFixed = computed(() => {
  return FixedPoint.fromValue(
    valueToNano(amount.value || '0', asset.value?.decimals || 0),
    Number(asset.value?.decimals || 0),
    { decimals: Number(asset.value?.decimals || 0) },
  )
})
const isSubmitDisabled = computed(() => {
  if (!isConnected.value) return false
  return assetsBalance.value < amountFixed.value.value
    || isLoading.value
    || amountFixed.value.isZero() || amountFixed.value.isNegative()
    || !!(estimatesError.value)
})
const reviewWithdrawDisabled = getSubmitDisabled(isSubmitDisabled)
const supplyAPYDisplay = computed(() => {
  if (!vault.value) return '0.00'
  return formatNumber(vault.value.supplyAPY || 0 + (opportunityInfo.value?.apr || 0))
})
const estimateSupplyAPYDisplay = computed(() => {
  return formatNumber(estimateSupplyAPY.value + (opportunityInfo.value?.apr || 0))
})

const load = async () => {
  isLoading.value = true
  try {
    vault.value = await getEarnVault(vaultAddress)
    estimateSupplyAPY.value = vault.value?.supplyAPY || 0
    asset.value = vault.value?.asset

    // Fetch fresh share balance and convert to assets
    await fetchShareBalance()
    await updateBalance()
  }
  catch (e) {
    showError('Unable to load Vault')
    console.warn(e)
  }
  finally {
    isLoading.value = false
  }
}

const fetchShareBalance = async () => {
  if (!vault.value?.address) {
    sharesBalance.value = 0n
    return
  }
  sharesBalance.value = await fetchVaultShareBalance(vault.value.address)
}

const updateBalance = async () => {
  if (!isConnected.value || sharesBalance.value === 0n) {
    assetsBalance.value = 0n
    delta.value = 0n
    return
  }

  // Convert shares to assets
  assetsBalance.value = await convertSharesToAssets(
    vaultAddress,
    sharesBalance.value,
  )
  delta.value = assetsBalance.value
}
const submit = async () => {
  await guardWithTerms(async () => {
    if (!asset.value?.address) {
      return
    }

    const isMax = FixedPoint.fromValue(assetsBalance.value, asset.value?.decimals).lte(amountFixed.value)

    try {
      plan.value = isMax
        ? await buildRedeemPlan(vaultAddress, amountFixed.value.value, sharesBalance.value, isMax)
        : await buildWithdrawPlan(vaultAddress, amountFixed.value.value)
    }
    catch (e) {
      console.warn('[OperationReviewModal] failed to build plan', e)
      plan.value = null
    }

    if (plan.value) {
      const ok = await runSimulation(plan.value)
      if (!ok) {
        return
      }
    }

    modal.open(OperationReviewModal, {
      props: {
        type: 'withdraw',
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
  })
}
const send = async () => {
  try {
    isSubmitting.value = true
    if (!asset.value?.address) {
      console.error('No asset address')
      return
    }

    const isMax = FixedPoint.fromValue(assetsBalance.value, asset.value?.decimals).lte(amountFixed.value)
    const txPlan = isMax
      ? await buildRedeemPlan(vaultAddress, amountFixed.value.value, sharesBalance.value, isMax)
      : await buildWithdrawPlan(vaultAddress, amountFixed.value.value)
    await executeTxPlan(txPlan)

    modal.close()
    setTimeout(() => {
      router.replace('/portfolio/saving')
    }, 400)
  }
  catch (e) {
    error('Transaction failed')
    console.error('Transaction error:', e)
  }
  finally {
    isSubmitting.value = false
  }
}
const updateEstimates = useDebounceFn(async () => {
  clearSimulationError()
  estimatesError.value = ''
  if (!vault.value) {
    return
  }
  try {
    if (assetsBalance.value < amountFixed.value.value) {
      throw new Error('Not enough balance')
    }
    delta.value = assetsBalance.value - amountFixed.value.value
    estimateSupplyAPY.value = vault.value.supplyAPY || 0
  }
  catch (e) {
    console.warn(e)
    delta.value = assetsBalance.value || 0n
    estimateSupplyAPY.value = vault.value.supplyAPY || 0
    estimatesError.value = (e as { message: string }).message
  }
  finally {
    isEstimatesLoading.value = false
  }
}, 500)

load()

// Update USD prices when vault or amounts change
watchEffect(async () => {
  if (!vault.value) {
    assetsBalanceUsd.value = 0
    deltaUsd.value = 0
    return
  }
  assetsBalanceUsd.value = await getAssetUsdValueOrZero(assetsBalance.value, vault.value, 'off-chain')
  deltaUsd.value = await getAssetUsdValueOrZero(delta.value, vault.value, 'off-chain')
})

watch(isConnected, async () => {
  if (vault.value) {
    await fetchShareBalance()
    await updateBalance()
  }
})
watch(amount, async () => {
  clearSimulationError()
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
    title="Withdraw"
    class="flex flex-col gap-16"
    :loading="isLoading"
    @submit.prevent="submit"
  >
    <template v-if="vault && asset">
      <div class="flex justify-between">
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
        maxable
      />

      <UiToast
        v-show="estimatesError"
        title="Error"
        variant="error"
        :description="estimatesError"
        size="compact"
      />
      <UiToast
        v-if="simulationError"
        title="Error"
        variant="error"
        :description="simulationError"
        size="compact"
      />

      <VaultFormInfoBlock
        :loading="isEstimatesLoading"
        class="flex flex-col gap-16"
      >
        <div class="flex justify-between items-center">
          <p class="text-content-tertiary">
            Supply APY
          </p>
          <p
            v-if="supplyAPYDisplay !== estimateSupplyAPYDisplay"
            class="text-p2 text-content-tertiary"
          >
            {{ supplyAPYDisplay }}% → <span class="text-content-primary">{{ estimateSupplyAPYDisplay }}%</span>
          </p>
          <p
            v-else
            class="text-p2 text-content-primary"
          >
            {{ supplyAPYDisplay }}%
          </p>
        </div>
        <div class="flex justify-between items-center">
          <p class="text-content-tertiary">
            Deposit
          </p>
          <p class="text-p2 text-content-tertiary">
            ${{ formatNumber(assetsBalanceUsd) }} <template v-if="amount && delta !== assetsBalance && delta >= 0n">
              → <span class="text-content-primary">${{ formatNumber(deltaUsd) }}</span>
            </template>
          </p>
        </div>
        <div class="flex justify-between items-center">
          <p class="text-content-tertiary">
            Available for withdraw
          </p>
          <p
            v-if="asset"
            class="text-p2 flex items-center gap-4"
          >
            {{ formatNumber(nanoToValue(assetsBalance, asset.decimals), 2) }} <span class="text-p3 text-content-tertiary">{{ asset.symbol }}</span>
            <span class="text-p3 text-content-tertiary">≈ ${{ formatNumber(assetsBalanceUsd) }}</span>
          </p>
        </div>
      </VaultFormInfoBlock>
    </template>

    <template #buttons>
      <VaultFormSubmit
        :loading="isSubmitting"
        :disabled="reviewWithdrawDisabled"
      >
        {{ reviewWithdrawLabel }}
      </VaultFormSubmit>
    </template>
  </VaultForm>
</template>
