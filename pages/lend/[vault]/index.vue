<script setup lang="ts">
import { useAccount } from '@wagmi/vue'
import { useModal } from '~/components/ui/composables/useModal'
import { OperationReviewModal, VaultSupplyApyModal, VaultUnverifiedDisclaimerModal } from '#components'
import { useToast } from '~/components/ui/composables/useToast'
import { computeAPYs, getVaultPrice, isSecuritizeVault, type SecuritizeVault, type Vault, type VaultAsset } from '~/entities/vault'
import type { TxPlan } from '~/entities/txPlan'
import { useEulerProductOfVault } from '~/composables/useEulerLabels'
import VaultFormInfoBlock from '~/components/entities/vault/form/VaultFormInfoBlock.vue'
import VaultFormSubmit from '~/components/entities/vault/form/VaultFormSubmit.vue'
import SecuritizeVaultOverview from '~/components/entities/vault/overview/SecuritizeVaultOverview.vue'

// Type definitions for vault display
type VaultType = 'evk' | 'securitize'

interface VaultFeatures {
  hasInterestRate: boolean
  hasCollateralLTVs: boolean
  hasPriceInfo: boolean
  hasVerifiedStatus: boolean
  hasPoints: boolean
  hasApyBreakdown: boolean
  hasOverview: boolean
}

const VAULT_FEATURES: Record<VaultType, VaultFeatures> = {
  evk: {
    hasInterestRate: true,
    hasCollateralLTVs: true,
    hasPriceInfo: true,
    hasVerifiedStatus: true,
    hasPoints: true,
    hasApyBreakdown: true,
    hasOverview: true,
  },
  securitize: {
    hasInterestRate: false,
    hasCollateralLTVs: false,
    hasPriceInfo: false,
    hasVerifiedStatus: false,
    hasPoints: false,
    hasApyBreakdown: false,
    hasOverview: true,
  },
}

const router = useRouter()
const route = useRoute()
const modal = useModal()
const { error } = useToast()
const { supply, buildSupplyPlan } = useEulerOperations()
const { getVault, getSecuritizeVault, updateVault } = useVaults()
const { isConnected } = useAccount()
const { getBalance } = useWallets()
const vaultAddress = route.params.vault as string
const { name } = useEulerProductOfVault(vaultAddress)
const { getOpportunityOfLendVault } = useMerkl()
const { getCampaignOfLendVault } = useBrevis()
const { getIntrinsicApy } = useIntrinsicApy()

// Determine vault type
const vaultType = computed<VaultType>(() => isSecuritizeVault(vaultAddress) ? 'securitize' : 'evk')
const features = computed(() => VAULT_FEATURES[vaultType.value])

// State
const isLoading = ref(false)
const isSubmitting = ref(false)
const isEstimatesLoading = ref(false)
const amount = ref('')
const plan = ref<TxPlan | null>(null)
const estimateSupplyAPY = ref(0n)
const monthlyEarnings = ref(0)

// Vault data - only one will be populated based on type
const evkVault: Ref<Vault | undefined> = ref(undefined)
const securitizeVault: Ref<SecuritizeVault | undefined> = ref(undefined)

// Load vault data based on type
if (vaultType.value === 'securitize') {
  securitizeVault.value = await getSecuritizeVault(vaultAddress)
}
else {
  evkVault.value = await getVault(vaultAddress)
}

// Unified accessors - these provide a common interface regardless of vault type
const vaultName = computed(() => evkVault.value?.name || securitizeVault.value?.name || '')
const asset: Ref<VaultAsset | undefined> = ref(evkVault.value?.asset || securitizeVault.value?.asset)

// For components that need the EVK Vault type (VaultLabelsAndAssets, VaultPoints, etc.)
const vault = computed(() => evkVault.value)

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
const intrinsicApy = computed(() => getIntrinsicApy(asset.value?.symbol))

const baseSupplyApy = computed(() => {
  if (!features.value.hasInterestRate) return 0
  if (!evkVault.value) return 0
  return nanoToValue(evkVault.value.interestRateInfo.supplyAPY, 25)
})
const supplyApyWithIntrinsic = computed(() => baseSupplyApy.value + intrinsicApy.value)
const supplyAPYDisplay = computed(() => {
  if (!evkVault.value && !securitizeVault.value) return '0.00'
  return formatNumber(supplyApyWithIntrinsic.value + totalRewardsAPY.value)
})
const estimateSupplyAPYDisplay = computed(() => {
  return formatNumber(nanoToValue(estimateSupplyAPY.value, 25))
})

// Check if vault data is loaded
const isVaultLoaded = computed(() => !!evkVault.value || !!securitizeVault.value)

const load = async () => {
  isLoading.value = true
  try {
    if (features.value.hasInterestRate && evkVault.value) {
      estimateSupplyAPY.value = evkVault.value.interestRateInfo.supplyAPY + valueToNano(totalRewardsAPY.value + intrinsicApy.value, 25)

      if (features.value.hasVerifiedStatus && !evkVault.value.verified) {
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
    else {
      // For vaults without interest rate info, just use rewards
      estimateSupplyAPY.value = valueToNano(totalRewardsAPY.value + intrinsicApy.value, 25)
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
    await supply(vaultAddress, asset.value.address, valueToNano(amount.value || '0', asset.value.decimals), asset.value.symbol)

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
  if (!isVaultLoaded.value) {
    return
  }
  try {
    if (features.value.hasInterestRate && evkVault.value) {
      await updateVault(evkVault.value.address)
      if (!asset.value?.address) {
        return
      }
      const { supplyAPY } = await computeAPYs(
        evkVault.value.interestRateInfo.borrowSPY,
        evkVault.value.interestRateInfo.cash + valueToNano(amount.value, evkVault.value.decimals),
        evkVault.value.interestRateInfo.borrows,
        evkVault.value.interestFee,
      )
      estimateSupplyAPY.value = supplyAPY + valueToNano(totalRewardsAPY.value + intrinsicApy.value, 25)
      monthlyEarnings.value = !amount.value
        ? 0
        : (+(amount.value || 0) * nanoToValue(estimateSupplyAPY.value, 27)) / 12
    }
    else {
      // For vaults without interest rate computation
      estimateSupplyAPY.value = valueToNano(totalRewardsAPY.value + intrinsicApy.value, 25)
      monthlyEarnings.value = !amount.value
        ? 0
        : (+(amount.value || 0) * nanoToValue(estimateSupplyAPY.value, 27)) / 12
    }
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
      lendingAPY: baseSupplyApy.value,
      intrinsicAPY: intrinsicApy.value,
      opportunityInfo: opportunityInfo.value,
      brevisInfo: brevisInfo.value,
    },
  })
}

load()

watch(amount, async () => {
  if (!isVaultLoaded.value) {
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
      <!-- Vault header -->
      <div
        v-if="isVaultLoaded && asset"
        class="flex justify-between"
      >
        <!-- EVK vaults use VaultLabelsAndAssets component -->
        <VaultLabelsAndAssets
          v-if="features.hasPoints && vault"
          :vault="vault"
          :assets="assets"
          size="large"
        />
        <!-- Other vault types show simple name/symbol -->
        <div
          v-else
          class="flex items-center gap-12"
        >
          <div>
            <p class="text-h3">
              {{ vaultName }}
            </p>
            <p class="text-euler-dark-900">
              {{ asset.symbol }}
            </p>
          </div>
        </div>

        <div class="flex flex-col items-end justify-end">
          <p class="mb-4 text-euler-dark-900">
            Supply APY
          </p>

          <p class="flex justify-end gap-4 text-h3">
            <VaultPoints
              v-if="features.hasPoints && vault"
              class="mr-4"
              :vault="vault"
            />
            <SvgIcon
              v-if="hasRewards"
              class="!w-24 !h-24 text-aquamarine-700"
              name="sparks"
            />
            <span>
              {{ supplyAPYDisplay }}%
            </span>
            <SvgIcon
              v-if="features.hasApyBreakdown"
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
        v-if="isVaultLoaded && asset"
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
              <template v-if="features.hasPriceInfo && vault">
                ≈ ${{ compactNumber(getVaultPrice(monthlyEarnings, vault)) }}
              </template>
            </p>
          </div>

          <div>
            <p class="mb-8">
              Supply APY
            </p>

            <p
              v-if="features.hasInterestRate && supplyAPYDisplay !== estimateSupplyAPYDisplay"
              class="text-p2 text-euler-dark-900"
            >
              {{ supplyAPYDisplay }}%
              <template v-if="supplyAPYDisplay !== estimateSupplyAPYDisplay">
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
          v-if="features.hasOverview && vault"
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
      <!-- EVK Vault Overview -->
      <VaultOverview
        v-if="features.hasOverview && vault && vaultType === 'evk'"
        :vault="vault"
        desktop-overview
      />
      <!-- Securitize Vault Overview -->
      <SecuritizeVaultOverview
        v-if="features.hasOverview && securitizeVault && vaultType === 'securitize'"
        :vault="securitizeVault"
        desktop-overview
      />
    </div>
  </div>
</template>
