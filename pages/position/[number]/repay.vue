<script setup lang="ts">
import { useAccount } from '@wagmi/vue'
import { type Vault, type VaultAsset, getNetAPY } from '~/entities/vault'
import { getAssetUsdValueOrZero, getCollateralOraclePrice, getAssetOraclePrice, conservativePriceRatioNumber } from '~/services/pricing/priceProvider'
import { type AccountBorrowPosition, isPositionEligibleForLiquidation } from '~/entities/account'
import type { TxPlan } from '~/entities/txPlan'
import { useTermsOfUseGate } from '~/composables/useTermsOfUseGate'
import { useEulerProductOfVault } from '~/composables/useEulerLabels'
import { useModal } from '~/components/ui/composables/useModal'
import { SlippageSettingsModal } from '#components'
import { POLL_INTERVAL_5S_MS } from '~/entities/tuning-constants'
import { nanoToValue } from '~/utils/crypto-utils'
import { formatNumber, formatSmartAmount, formatHealthScore } from '~/utils/string-utils'
import { useWalletRepay } from '~/composables/repay/useWalletRepay'
import { useCollateralSwapRepay } from '~/composables/repay/useCollateralSwapRepay'
import { useSavingsRepay } from '~/composables/repay/useSavingsRepay'

const route = useRoute()
const router = useRouter()
const modal = useModal()
const { isConnected, address } = useAccount()
const positionIndex = usePositionIndex()
const { isPositionsLoading, isPositionsLoaded, isDepositsLoaded, refreshAllPositions, getPositionBySubAccountIndex } = useEulerAccount()
const { getSupplyRewardApy, getBorrowRewardApy } = useRewardsApy()
const { withIntrinsicBorrowApy, withIntrinsicSupplyApy } = useIntrinsicApy()
const { eulerLensAddresses } = useEulerAddresses()
const { fetchSingleBalance } = useWallets()
const { runSimulation, simulationError, clearSimulationError } = useTxPlanSimulation()
const { slippage } = useSlippage()
const { getSubmitLabel, getSubmitDisabled, guardWithTerms } = useTermsOfUseGate()

// --- Shared state ---
const isLoading = ref(false)
const isSubmitting = ref(false)
const isPreparing = ref(false)
const formTab = ref<'wallet' | 'collateral' | 'savings'>('wallet')
const plan = ref<TxPlan | null>(null)
const position: Ref<AccountBorrowPosition | undefined> = ref()
const walletBalance = ref(0n)

// --- Shared computeds ---
const borrowVault = computed(() => position.value?.borrow)
const collateralVault = computed(() => position.value?.collateral)
const assets = computed(() => [collateralVault.value?.asset, borrowVault.value?.asset])
const isEligibleForLiquidation = computed(() => isPositionEligibleForLiquidation(position.value))
const getCurrentDebt = () => position.value?.borrowed || 0n

const { name } = useEulerProductOfVault(borrowVault.value?.address || '')

const walletPriceInvert = usePriceInvert(
  () => collateralVault.value?.asset.symbol,
  () => borrowVault.value?.asset.symbol,
)

const oraclePriceRatio = computed(() => {
  if (!borrowVault.value || !collateralVault.value) return null
  const collateralPrice = getCollateralOraclePrice(borrowVault.value, collateralVault.value as Vault)
  const borrowPrice = getAssetOraclePrice(borrowVault.value)
  return conservativePriceRatioNumber(collateralPrice, borrowPrice)
})

const liquidationPrice = computed(() => {
  const health = nanoToValue(position.value?.health || 0n, 18)
  if (!oraclePriceRatio.value || health < 0.1) return null
  return oraclePriceRatio.value / health
})

// --- APYs ---
const collateralSupplyRewardApy = computed(() => getSupplyRewardApy(collateralVault.value?.address || ''))
const borrowRewardApy = computed(() => getBorrowRewardApy(borrowVault.value?.address || '', collateralVault.value?.address || ''))
const collateralSupplyApy = computed(() => withIntrinsicSupplyApy(
  nanoToValue(collateralVault.value?.interestRateInfo.supplyAPY || 0n, 25),
  collateralVault.value?.asset.address,
))
const borrowApy = computed(() => withIntrinsicBorrowApy(
  nanoToValue(borrowVault.value?.interestRateInfo.borrowAPY || 0n, 25),
  borrowVault.value?.asset.address,
))

let netAPYVersion = 0
const netAPY = ref(0)
watchEffect(async () => {
  if (!position.value || !collateralVault.value || !borrowVault.value) {
    netAPY.value = 0
    return
  }
  const version = ++netAPYVersion
  const [supplyUsd, borrowUsd] = await Promise.all([
    getAssetUsdValueOrZero(position.value.supplied || 0n, collateralVault.value, 'off-chain'),
    getAssetUsdValueOrZero(position.value.borrowed ?? 0n, borrowVault.value, 'off-chain'),
  ])
  if (version !== netAPYVersion) return
  netAPY.value = getNetAPY(
    supplyUsd,
    collateralSupplyApy.value,
    borrowUsd,
    borrowApy.value,
    collateralSupplyRewardApy.value || null,
    borrowRewardApy.value || null,
  )
})

// --- Tab composables ---
const wallet = useWalletRepay({
  position,
  borrowVault,
  collateralVault,
  formTab,
  walletBalance,
  plan,
  isSubmitting,
  isPreparing,
  clearSimulationError,
  runSimulation,
  netAPY,
  collateralSupplyApy,
  borrowApy,
  collateralSupplyRewardApy,
  borrowRewardApy,
})

const collateral = useCollateralSwapRepay({
  position,
  borrowVault,
  collateralVault,
  formTab,
  plan,
  isSubmitting,
  isPreparing,
  slippage,
  clearSimulationError,
  runSimulation,
  getCurrentDebt,
  isEligibleForLiquidation,
})

const savings = useSavingsRepay({
  position,
  borrowVault,
  collateralVault,
  formTab,
  plan,
  isSubmitting,
  isPreparing,
  slippage,
  oraclePriceRatio,
  clearSimulationError,
  runSimulation,
  getCurrentDebt,
  collateralSupplyApy,
  borrowApy,
})

// --- Form tabs ---
const formTabs = computed(() => {
  const tabs = [
    { label: 'From wallet', value: 'wallet' },
    { label: 'Swap collateral', value: 'collateral' },
  ]
  if (savings.savingsPositions.value.length > 0) {
    tabs.push({ label: 'From savings', value: 'savings' })
  }
  return tabs
})

// --- Submit ---
const reviewRepayLabel = getSubmitLabel('Review Repay')
const reviewRepayDisabled = getSubmitDisabled(computed(() => {
  if (formTab.value === 'wallet') return wallet.isSubmitDisabled.value
  if (formTab.value === 'savings') return savings.isSavingsSubmitDisabled.value
  return collateral.isSwapSubmitDisabled.value
}))

const onSubmitForm = async () => {
  await guardWithTerms(async () => {
    if (formTab.value === 'wallet') {
      await wallet.submit()
    }
    else if (formTab.value === 'savings') {
      await savings.submitSavings()
    }
    else {
      await collateral.submitSwap()
    }
  })
}

const openSlippageSettings = () => {
  modal.open(SlippageSettingsModal)
}

// --- Load / Fetch ---
const fetchWalletBalance = async () => {
  if (!isConnected.value || !borrowVault.value?.asset.address) {
    walletBalance.value = 0n
    return
  }
  walletBalance.value = await fetchSingleBalance(borrowVault.value.asset.address)
}

const load = async () => {
  if (!isConnected.value) {
    position.value = undefined
    return
  }
  isLoading.value = true
  await until(isPositionsLoaded).toBe(true)
  await until(isDepositsLoaded).toBe(true)

  try {
    position.value = getPositionBySubAccountIndex(+positionIndex)
    await fetchWalletBalance()
    await wallet.updateBalance()
    wallet.initEstimates(netAPY.value, position.value?.userLTV || 0n, position.value?.health || 0n)
    collateral.initVault(position.value?.collateral as Vault | undefined)
    savings.initVault()
  }
  catch (e) {
    showError('Unable to load Vault')
    console.warn(e)
  }
  finally {
    isLoading.value = false
  }
}

// --- Watchers ---
watch(isPositionsLoaded, (val) => {
  if (val) load()
}, { immediate: true })

watch(isConnected, () => {
  wallet.updateBalance()
})

watch(address, () => {
  fetchWalletBalance()
  wallet.updateBalance()
})

watch(formTab, () => {
  clearSimulationError()
  wallet.resetOnTabSwitch()
  collateral.resetOnTabSwitch()
  savings.resetOnTabSwitch()
})

// --- Polling ---
const interval = setInterval(() => {
  wallet.updateBalance()
}, POLL_INTERVAL_5S_MS)

onUnmounted(() => {
  clearInterval(interval)
})
</script>

<template>
  <VaultForm
    :loading="isLoading || isPositionsLoading"
    title="Repay position"
    @submit.prevent="onSubmitForm"
  >
    <div v-if="!isConnected">
      Connect your wallet to see your positions
    </div>

    <div v-else-if="!position">
      Position not found
    </div>

    <template v-else>
      <VaultLabelsAndAssets
        :vault="position.borrow"
        :assets="assets as VaultAsset[]"
        size="large"
      />

      <UiTabs
        v-model="formTab"
        class="mb-12"
        rounded
        pills
        :list="formTabs"
      />

      <template v-if="formTab === 'wallet'">
        <div class="grid gap-16 laptop:grid-cols-[minmax(0,1fr)_360px] laptop:items-start">
          <div class="flex flex-col gap-16 w-full">
            <AssetInput
              v-if="position.borrow.asset"
              v-model="wallet.amount.value"
              label="Pay from wallet"
              :desc="name"
              :asset="position.borrow.asset"
              :vault="position.borrow"
              :balance="walletBalance"
              maxable
            />

            <AssetInput
              v-if="position.borrow.asset"
              v-model="wallet.amount.value"
              label="Debt to repay"
              :asset="position.borrow.asset"
              :vault="position.borrow"
              :balance="position.borrowed"
              maxable
            />

            <UiRange
              v-if="borrowVault"
              v-model="wallet.walletRepayPercent.value"
              label="Percent of debt to repay"
              :min="0"
              :max="100"
              :step="1"
              :number-filter="(n: number) => `${n}%`"
              @update:model-value="wallet.onWalletRepayPercentInput"
            />

            <UiToast
              v-show="wallet.estimatesError.value"
              title="Error"
              variant="error"
              :description="wallet.estimatesError.value"
              size="compact"
            />
            <UiToast
              v-if="simulationError"
              title="Error"
              variant="error"
              :description="simulationError"
              size="compact"
            />
          </div>

          <VaultFormInfoBlock
            v-if="collateralVault && borrowVault"
            :loading="wallet.isEstimatesLoading.value"
            variant="card"
            class="w-full laptop:max-w-[360px]"
          >
            <SummaryRow label="Net APY">
              <SummaryValue
                :before="formatNumber(netAPY)"
                :after="formatNumber(wallet.estimateNetAPY.value)"
                suffix="%"
              />
            </SummaryRow>
            <SummaryRow label="Oracle price">
              <SummaryPriceValue
                :value="oraclePriceRatio != null ? formatSmartAmount(walletPriceInvert.invertValue(oraclePriceRatio)!) : undefined"
                :symbol="walletPriceInvert.displaySymbol"
                invertible
                @invert="walletPriceInvert.toggle"
              />
            </SummaryRow>
            <SummaryRow label="Liquidation price">
              <SummaryPriceValue
                :value="walletPriceInvert.invertValue(liquidationPrice) != null ? formatSmartAmount(walletPriceInvert.invertValue(liquidationPrice)!) : undefined"
                :symbol="walletPriceInvert.displaySymbol"
                invertible
                @invert="walletPriceInvert.toggle"
              />
            </SummaryRow>
            <SummaryRow label="LTV">
              <SummaryValue
                :before="formatNumber(nanoToValue(position.userLTV, 18))"
                :after="formatNumber(nanoToValue(wallet.estimateUserLTV.value, 18))"
                suffix="%"
              />
            </SummaryRow>
            <SummaryRow label="Health score">
              <SummaryValue
                :before="formatHealthScore(nanoToValue(position.health, 18))"
                :after="formatHealthScore(nanoToValue(wallet.estimateHealth.value, 18))"
              />
            </SummaryRow>
          </VaultFormInfoBlock>

          <div class="flex flex-col gap-8 laptop:col-start-1 laptop:row-start-2">
            <VaultFormInfoButton
              :pair="position"
              :disabled="isLoading || isSubmitting"
            >
              Pair information
            </VaultFormInfoButton>
            <VaultFormSubmit
              :disabled="reviewRepayDisabled"
              :loading="isSubmitting || isPreparing"
            >
              {{ reviewRepayLabel }}
            </VaultFormSubmit>
          </div>
        </div>
      </template>

      <template v-else-if="formTab === 'collateral'">
        <div class="grid gap-16 laptop:grid-cols-[minmax(0,1fr)_360px] laptop:items-start">
          <div class="flex flex-col gap-16 w-full">
            <UiToast
              v-if="isEligibleForLiquidation"
              title="Position in violation"
              variant="warning"
              description="This position is eligible for liquidation. Collateral swaps that don't fully clear the debt will fail. If repaying partially, consider repaying from your wallet instead."
              size="compact"
            />

            <AssetInput
              v-if="collateral.swapCollateralVault.value"
              v-model="collateral.collateralAmount.value"
              label="Collateral to swap"
              :desc="collateral.swapCollateralProduct.name"
              :asset="collateral.swapCollateralVault.value.asset"
              :vault="collateral.swapCollateralVault.value"
              :collateral-options="collateral.repayCollateralOptions.value"
              :balance="collateral.swapCollateralBalance.value"
              maxable
              @input="collateral.onCollateralInput"
              @change-collateral="collateral.onSwapCollateralChange"
            />
            <AssetInput
              v-if="borrowVault"
              v-model="collateral.debtAmount.value"
              label="Debt to repay"
              :desc="name"
              :asset="borrowVault.asset"
              :vault="borrowVault"
              :balance="collateral.swapDebtBalance.value"
              maxable
              @input="collateral.onDebtInput"
            />
            <UiRange
              v-if="borrowVault"
              v-model="collateral.repayDebtPercent.value"
              label="Percent of debt to repay"
              :min="0"
              :max="100"
              :step="1"
              :number-filter="(n: number) => `${n}%`"
              @update:model-value="collateral.onRepayPercentInput"
            />

            <SwapRouteSelector
              v-if="!collateral.swapIsSameAsset.value"
              :items="collateral.swapRouteItems.value"
              :selected-provider="collateral.quotes.selectedProvider.value"
              :status-label="collateral.quotes.statusLabel.value"
              :is-loading="collateral.quotes.isLoading.value"
              :empty-message="collateral.swapRouteEmptyMessage.value"
              @select="collateral.quotes.selectProvider"
              @refresh="collateral.onRefreshSwapQuotes"
            />

            <UiToast
              v-if="collateral.quotes.quoteError.value && !collateral.swapIsSameAsset.value"
              title="Swap quote"
              variant="warning"
              :description="collateral.quotes.quoteError.value"
              size="compact"
            />
            <UiToast
              v-if="collateral.swapDisabledReason.value"
              title="Cannot submit"
              variant="warning"
              :description="collateral.swapDisabledReason.value"
              size="compact"
            />
            <UiToast
              v-if="simulationError"
              title="Error"
              variant="error"
              :description="simulationError"
              size="compact"
            />
          </div>

          <VaultFormInfoBlock
            :loading="!collateral.swapIsSameAsset.value && collateral.quotes.isLoading.value"
            variant="card"
            class="w-full laptop:max-w-[360px]"
          >
            <SummaryRow label="ROE">
              <SummaryValue
                :before="collateral.swapRoeBefore.value !== null ? formatNumber(collateral.swapRoeBefore.value) : undefined"
                :after="collateral.swapRoeAfter.value !== null && (collateral.quotes.quote.value || collateral.swapIsSameAsset.value) ? formatNumber(collateral.swapRoeAfter.value) : undefined"
                suffix="%"
              />
            </SummaryRow>
            <template v-if="!collateral.swapIsSameAsset.value">
              <SummaryRow label="Swap price" align-top>
                <SummaryPriceValue
                  :value="collateral.swapCurrentPrice.value ? formatSmartAmount(collateral.swapPriceInvert.invertValue(collateral.swapCurrentPrice.value.value)) : undefined"
                  :symbol="collateral.swapPriceInvert.displaySymbol"
                  invertible
                  @invert="collateral.swapPriceInvert.toggle"
                />
              </SummaryRow>
            </template>
            <template v-else>
              <SummaryRow label="Transfer">
                <p class="text-p2">
                  1:1 (same asset, no slippage)
                </p>
              </SummaryRow>
            </template>
            <SummaryRow label="Liquidation price">
              <SummaryPriceValue
                :before="collateral.swapCurrentLiquidationPrice.value !== null ? formatSmartAmount(collateral.swapPriceInvert.invertValue(collateral.swapCurrentLiquidationPrice.value)) : undefined"
                :after="collateral.swapNextLiquidationPrice.value !== null && (collateral.quotes.quote.value || collateral.swapIsSameAsset.value) ? formatSmartAmount(collateral.swapPriceInvert.invertValue(collateral.swapNextLiquidationPrice.value)) : undefined"
                :symbol="collateral.swapPriceInvert.displaySymbol"
                invertible
                @invert="collateral.swapPriceInvert.toggle"
              />
            </SummaryRow>
            <SummaryRow label="LTV">
              <SummaryValue
                :before="collateral.swapCurrentLtv.value !== null ? formatNumber(collateral.swapCurrentLtv.value) : undefined"
                :after="collateral.swapNextLtv.value !== null && (collateral.quotes.quote.value || collateral.swapIsSameAsset.value) ? formatNumber(collateral.swapNextLtv.value) : undefined"
                suffix="%"
              />
            </SummaryRow>
            <SummaryRow label="Health score">
              <SummaryValue
                :before="collateral.swapCurrentHealth.value !== null ? formatHealthScore(collateral.swapCurrentHealth.value) : undefined"
                :after="collateral.swapNextHealth.value !== null && (collateral.quotes.quote.value || collateral.swapIsSameAsset.value) ? formatHealthScore(collateral.swapNextHealth.value) : undefined"
              />
            </SummaryRow>
            <template v-if="!collateral.swapIsSameAsset.value">
              <SummaryRow label="Swap" align-top>
                <p class="text-p2 text-right flex flex-col items-end">
                  <span>{{ collateral.swapSummary.value ? collateral.swapSummary.value.from : '-' }}</span>
                  <span
                    v-if="collateral.swapSummary.value"
                    class="text-content-tertiary text-p3"
                  >
                    {{ collateral.swapSummary.value.to }}
                  </span>
                </p>
              </SummaryRow>
              <SummaryRow label="Price impact">
                <p class="text-p2">
                  {{ collateral.swapPriceImpact.value !== null ? `${formatNumber(collateral.swapPriceImpact.value, 2, 2)}%` : '-' }}
                </p>
              </SummaryRow>
              <SummaryRow label="Leveraged price impact">
                <p class="text-p2">
                  {{ collateral.swapLeveragedPriceImpact.value !== null ? `${formatNumber(collateral.swapLeveragedPriceImpact.value, 2, 2)}%` : '-' }}
                </p>
              </SummaryRow>
              <SummaryRow label="Slippage tolerance">
                <button
                  type="button"
                  class="flex items-center gap-6 text-p2"
                  @click="openSlippageSettings"
                >
                  <span>{{ formatNumber(slippage, 2, 0) }}%</span>
                  <SvgIcon
                    name="edit"
                    class="!w-16 !h-16 text-accent-600"
                  />
                </button>
              </SummaryRow>
              <SummaryRow label="Routed via">
                <p class="text-p2 text-right">
                  {{ collateral.swapRoutedVia.value || '-' }}
                </p>
              </SummaryRow>
            </template>
          </VaultFormInfoBlock>

          <div class="flex flex-col gap-8 laptop:col-start-1 laptop:row-start-2">
            <VaultFormInfoButton
              :pair="position"
              :disabled="isLoading || isSubmitting"
            >
              Pair information
            </VaultFormInfoButton>
            <VaultFormSubmit
              :disabled="reviewRepayDisabled"
              :loading="isSubmitting || isPreparing"
            >
              {{ reviewRepayLabel }}
            </VaultFormSubmit>
          </div>
        </div>
      </template>

      <template v-else-if="formTab === 'savings'">
        <div class="grid gap-16 laptop:grid-cols-[minmax(0,1fr)_360px] laptop:items-start">
          <div class="flex flex-col gap-16 w-full">
            <AssetInput
              v-if="savings.savingsVault.value"
              v-model="savings.savingsAmount.value"
              label="Savings to use"
              :desc="savings.savingsProduct.name"
              :asset="savings.savingsVault.value.asset"
              :vault="savings.savingsVault.value"
              :collateral-options="savings.savingsOptions.value"
              :balance="savings.savingsBalance.value"
              maxable
              @input="savings.onSavingsAmountInput"
              @change-collateral="savings.onSavingsVaultChange"
            />
            <AssetInput
              v-if="borrowVault"
              v-model="savings.savingsDebtAmount.value"
              label="Debt to repay"
              :desc="name"
              :asset="borrowVault.asset"
              :vault="borrowVault"
              :balance="savings.savingsDebtBalance.value"
              maxable
              @input="savings.onSavingsDebtInput"
            />
            <UiRange
              v-if="borrowVault"
              v-model="savings.savingsDebtPercent.value"
              label="Percent of debt to repay"
              :min="0"
              :max="100"
              :step="1"
              :number-filter="(n: number) => `${n}%`"
              @update:model-value="savings.onSavingsPercentInput"
            />

            <SwapRouteSelector
              v-if="!savings.savingsIsSameAsset.value"
              :items="savings.savingsRouteItems.value"
              :selected-provider="savings.quotes.selectedProvider.value"
              :status-label="savings.quotes.statusLabel.value"
              :is-loading="savings.quotes.isLoading.value"
              :empty-message="savings.quotes.providersCount.value ? 'No quotes found' : 'Enter amount to fetch quotes'"
              @select="savings.quotes.selectProvider"
              @refresh="savings.onRefreshSavingsQuotes"
            />

            <UiToast
              v-if="savings.quotes.quoteError.value && !savings.savingsIsSameAsset.value"
              title="Swap quote"
              variant="warning"
              :description="savings.quotes.quoteError.value"
              size="compact"
            />
            <UiToast
              v-if="savings.savingsDisabledReason.value"
              title="Cannot submit"
              variant="warning"
              :description="savings.savingsDisabledReason.value"
              size="compact"
            />
            <UiToast
              v-if="simulationError"
              title="Error"
              variant="error"
              :description="simulationError"
              size="compact"
            />
          </div>

          <VaultFormInfoBlock
            :loading="!savings.savingsIsSameAsset.value && savings.quotes.isLoading.value"
            variant="card"
            class="w-full laptop:max-w-[360px]"
          >
            <SummaryRow label="ROE">
              <SummaryValue
                :before="savings.savingsRoeBefore.value !== null ? formatNumber(savings.savingsRoeBefore.value) : undefined"
                :after="savings.savingsRoeAfter.value !== null && (savings.quotes.quote.value || savings.savingsIsSameAsset.value) ? formatNumber(savings.savingsRoeAfter.value) : undefined"
                suffix="%"
              />
            </SummaryRow>
            <template v-if="!savings.savingsIsSameAsset.value">
              <SummaryRow label="Swap price" align-top>
                <SummaryPriceValue
                  :value="savings.savingsSwapCurrentPrice.value ? formatSmartAmount(savings.savingsPriceInvert.invertValue(savings.savingsSwapCurrentPrice.value.value)) : undefined"
                  :symbol="savings.savingsPriceInvert.displaySymbol"
                  invertible
                  @invert="savings.savingsPriceInvert.toggle"
                />
              </SummaryRow>
            </template>
            <template v-else>
              <SummaryRow label="Transfer">
                <p class="text-p2">
                  1:1 (same asset, no slippage)
                </p>
              </SummaryRow>
            </template>
            <SummaryRow label="Liquidation price">
              <SummaryPriceValue
                :before="savings.savingsCurrentLiquidationPrice.value !== null ? formatSmartAmount(walletPriceInvert.invertValue(savings.savingsCurrentLiquidationPrice.value)) : undefined"
                :after="savings.savingsNextLiquidationPrice.value !== null && (savings.quotes.quote.value || savings.savingsIsSameAsset.value) ? formatSmartAmount(walletPriceInvert.invertValue(savings.savingsNextLiquidationPrice.value)) : undefined"
                :symbol="walletPriceInvert.displaySymbol"
                invertible
                @invert="walletPriceInvert.toggle"
              />
            </SummaryRow>
            <SummaryRow label="LTV">
              <SummaryValue
                :before="savings.savingsCurrentLtv.value !== null ? formatNumber(savings.savingsCurrentLtv.value) : undefined"
                :after="savings.savingsNextLtv.value !== null && (savings.quotes.quote.value || savings.savingsIsSameAsset.value) ? formatNumber(savings.savingsNextLtv.value) : undefined"
                suffix="%"
              />
            </SummaryRow>
            <SummaryRow label="Health score">
              <SummaryValue
                :before="savings.savingsCurrentHealth.value !== null ? formatHealthScore(savings.savingsCurrentHealth.value) : undefined"
                :after="savings.savingsNextHealth.value !== null && (savings.quotes.quote.value || savings.savingsIsSameAsset.value) ? formatHealthScore(savings.savingsNextHealth.value) : undefined"
              />
            </SummaryRow>
            <template v-if="!savings.savingsIsSameAsset.value">
              <SummaryRow label="Swap" align-top>
                <p class="text-p2 text-right flex flex-col items-end">
                  <span>{{ savings.savingsSwapSummary.value ? savings.savingsSwapSummary.value.from : '-' }}</span>
                  <span
                    v-if="savings.savingsSwapSummary.value"
                    class="text-content-tertiary text-p3"
                  >
                    {{ savings.savingsSwapSummary.value.to }}
                  </span>
                </p>
              </SummaryRow>
              <SummaryRow label="Price impact">
                <p class="text-p2">
                  {{ savings.savingsPriceImpact.value !== null ? `${formatNumber(savings.savingsPriceImpact.value, 2, 2)}%` : '-' }}
                </p>
              </SummaryRow>
              <SummaryRow label="Leveraged price impact">
                <p class="text-p2">
                  {{ savings.savingsLeveragedPriceImpact.value !== null ? `${formatNumber(savings.savingsLeveragedPriceImpact.value, 2, 2)}%` : '-' }}
                </p>
              </SummaryRow>
              <SummaryRow label="Slippage tolerance">
                <button
                  type="button"
                  class="flex items-center gap-6 text-p2"
                  @click="openSlippageSettings"
                >
                  <span>{{ formatNumber(slippage, 2, 0) }}%</span>
                  <SvgIcon
                    name="edit"
                    class="!w-16 !h-16 text-accent-600"
                  />
                </button>
              </SummaryRow>
              <SummaryRow label="Routed via">
                <p class="text-p2 text-right">
                  {{ savings.savingsRoutedVia.value || '-' }}
                </p>
              </SummaryRow>
            </template>
          </VaultFormInfoBlock>

          <div class="flex flex-col gap-8 laptop:col-start-1 laptop:row-start-2">
            <VaultFormInfoButton
              :pair="position"
              :disabled="isLoading || isSubmitting"
            >
              Pair information
            </VaultFormInfoButton>
            <VaultFormSubmit
              :disabled="reviewRepayDisabled"
              :loading="isSubmitting || isPreparing"
            >
              {{ reviewRepayLabel }}
            </VaultFormSubmit>
          </div>
        </div>
      </template>
    </template>
  </VaultForm>
</template>
