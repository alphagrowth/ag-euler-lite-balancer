<script setup lang="ts">
import { useAccount } from '@wagmi/vue'
import { FixedNumber } from 'ethers'
import { useModal } from '~/components/ui/composables/useModal'
import { OperationReviewModal } from '#components'
import { useToast } from '~/components/ui/composables/useToast'
import {
  convertSharesToAssets,
  getEarnVaultPrice,
  type EarnVault,
  type VaultAsset,
} from '~/entities/vault'

const router = useRouter()
const route = useRoute()
const modal = useModal()
const { error } = useToast()
const { withdraw, redeem } = useEulerOperations()
const { getEarnVault } = useVaults()
const { isConnected } = useAccount()
const { getBalance } = useWallets()
const { getOpportunityOfLendVault } = useMerkl()
const vaultAddress = route.params.vault as string

const isLoading = ref(false)
const isSubmitting = ref(false)
const isEstimatesLoading = ref(false)
const amount = ref('')
const vault: Ref<EarnVault | undefined> = ref()
const asset: Ref<VaultAsset | undefined> = ref()
const assetsBalance = ref(0n)
const sharesBalance = ref(0n)
const delta = ref(0n)
const estimateSupplyAPY = ref(0)
const estimatesError = ref('')

const opportunityInfo = computed(() => getOpportunityOfLendVault(vault.value?.address || ''))
const amountFixed = computed(() => {
  return FixedNumber.fromValue(
    valueToNano(amount.value || '0', asset.value?.decimals || 0),
    Number(asset.value?.decimals || 0),
    { decimals: Number(asset.value?.decimals || 0) },
  )
})
const balance = computed(() => {
  return getBalance(vault.value?.address as `0x${string}`) || 0n
})
const isSubmitDisabled = computed(() => {
  if (!isConnected.value) return false
  return assetsBalance.value < amountFixed.value.value
    || isLoading.value
    || amountFixed.value.isZero() || amountFixed.value.isNegative()
    || !!(estimatesError.value)
})
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
const updateBalance = async () => {
  if (!isConnected.value) {
    assetsBalance.value = 0n
    sharesBalance.value = 0n
    return
  }

  sharesBalance.value = balance.value
  assetsBalance.value = await convertSharesToAssets(
    vaultAddress,
    sharesBalance.value,
  )
  delta.value = assetsBalance.value
}
const submit = async () => {
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
      console.error('No asset address')
      return
    }

    const method = FixedNumber.fromValue(assetsBalance.value, asset.value?.decimals).lte(amountFixed.value) ? redeem : withdraw

    await method(
      vaultAddress,
      asset.value.address,
      amountFixed.value.value,
      asset.value.symbol,
      undefined, // subAccount
      sharesBalance.value,
      FixedNumber.fromValue(assetsBalance.value, asset.value?.decimals).lte(amountFixed.value),
    )

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
</script>

<template>
  <VaultForm
    title="Withdraw"
    :class="$style.LendVaultPage"
    class="column gap-16"
    :loading="isLoading"
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
        :loading="isEstimatesLoading"
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
            ${{ formatNumber(getEarnVaultPrice(assetsBalance, vault)) }} <template v-if="amount && delta !== assetsBalance && delta >= 0n">
              → <span class="text-white">${{ formatNumber(getEarnVaultPrice(delta, vault)) }}</span>
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
            {{ formatNumber(nanoToValue(assetsBalance, asset.decimals), 2) }} <span class="p3 text-euler-dark-900">{{ asset.symbol }}</span>
            <span class="p3 text-euler-dark-900">≈ ${{ formatNumber(getEarnVaultPrice(assetsBalance, vault)) }}</span>
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
