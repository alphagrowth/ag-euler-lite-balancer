<script setup lang="ts">
import { useAccount } from '@wagmi/vue'
import { getAddress, formatUnits, isAddress, zeroAddress, type Address } from 'viem'
import { OperationReviewModal, SlippageSettingsModal } from '#components'
import { useTermsOfUseGate } from '~/composables/useTermsOfUseGate'
import { type Vault, type SecuritizeVault, isSecuritizeVault, fetchSecuritizeVault } from '~/entities/vault'
import { getSubAccountAddress } from '~/entities/account'
import { getAssetUsdValue } from '~/services/pricing/priceProvider'
import { useEulerProductOfVault } from '~/composables/useEulerLabels'
import { isVaultBlockedByCountry, getVaultTags } from '~/composables/useGeoBlock'
import { useSwapCollateralOptions } from '~/composables/useSwapCollateralOptions'
import { useSwapQuotesParallel } from '~/composables/useSwapQuotesParallel'
import { SwapperMode } from '~/entities/swap'
import { getQuoteAmount } from '~/utils/swapQuotes'
import type { TxPlan } from '~/entities/txPlan'
import { useModal } from '~/components/ui/composables/useModal'
import { useToast } from '~/components/ui/composables/useToast'
import { useIntrinsicApy } from '~/composables/useIntrinsicApy'
import { formatNumber, formatSmartAmount } from '~/utils/string-utils'
import { nanoToValue } from '~/utils/crypto-utils'
import { isSameUnderlyingAsset, isSameVault as isSameVaultCheck } from '~/utils/vault-utils'

const route = useRoute()
const router = useRouter()
const { getVault } = useVaults()
const { isConnected, address } = useAccount()
const { depositPositions } = useEulerAccount()
const { buildSwapPlan, buildSameAssetSwapPlan, executeTxPlan } = useEulerOperations()
const modal = useModal()
const { error: showError } = useToast()
const { getSubmitLabel, getSubmitDisabled, guardWithTerms } = useTermsOfUseGate()
const reviewSwapLabel = getSubmitLabel(computed(() => {
  if (isSameAsset.value) return 'Review Transfer'
  return selectedQuote.value ? 'Review Swap' : 'Select a Quote'
}))
const { withIntrinsicSupplyApy } = useIntrinsicApy()
const { getSupplyRewardApy } = useRewardsApy()
const { runSimulation, simulationError, clearSimulationError } = useTxPlanSimulation()
const openSlippageSettings = () => {
  modal.open(SlippageSettingsModal)
}

const subAccountIndex = Number(route.params.subAccount)
const subAccount = computed(() => {
  if (!address.value || isNaN(subAccountIndex)) return undefined
  return getSubAccountAddress(address.value, subAccountIndex)
})

const isLoading = ref(false)
const isSubmitting = ref(false)
const isPreparing = ref(false)
const plan = ref<TxPlan | null>(null)
const fromAmount = ref('')
const toAmount = ref('')
const { slippage } = useSlippage()
const {
  sortedQuoteCards: quoteCardsSorted,
  selectedProvider,
  selectedQuote,
  effectiveQuote,
  providersCount,
  isLoading: isQuoteLoading,
  quoteError,
  statusLabel: quotesStatusLabel,
  getQuoteDiffPct,
  reset: resetQuoteStateInternal,
  requestQuotes,
  selectProvider,
} = useSwapQuotesParallel({ amountField: 'amountOut', compare: 'max' })

const fromVault: Ref<Vault | SecuritizeVault | undefined> = ref()
const toVault: Ref<Vault | undefined> = ref()

const fromProduct = useEulerProductOfVault(computed(() => fromVault.value?.address || ''))
const toProduct = useEulerProductOfVault(computed(() => toVault.value?.address || ''))
// Check if from vault is securitize type
const isFromSecuritizeVault = computed(() => fromVault.value && 'type' in fromVault.value && fromVault.value.type === 'securitize')
// For swap options, treat securitize as regular vault (has compatible fields now)
const fromVaultAsRegular = computed(() => fromVault.value as Vault | undefined)
const { collateralOptions, collateralVaults } = useSwapCollateralOptions({ currentVault: fromVaultAsRegular })

const getVaultAddress = () => route.params.vault as string
const getTargetAddress = () => (typeof route.query.to === 'string' ? route.query.to : '')

const normalizeAddress = (addr?: string) => {
  if (!addr) {
    return ''
  }
  try {
    return getAddress(addr)
  }
  catch {
    return ''
  }
}

const loadVaults = async () => {
  isLoading.value = true
  try {
    const baseAddress = getVaultAddress()
    const targetAddress = getTargetAddress()

    // Check if from vault is securitize
    const isFromSecuritize = await isSecuritizeVault(baseAddress)
    if (isFromSecuritize) {
      fromVault.value = await fetchSecuritizeVault(baseAddress)
    }
    else {
      fromVault.value = await getVault(baseAddress)
    }

    if (targetAddress && isAddress(targetAddress) && getAddress(targetAddress) !== getAddress(baseAddress)) {
      toVault.value = await getVault(targetAddress)
    }
    else if (!isFromSecuritize) {
      toVault.value = fromVault.value as Vault
    }
  }
  catch (e) {
    console.warn('[lend swap] failed to load vaults', e)
  }
  finally {
    isLoading.value = false
  }
}

await loadVaults()

watch([() => route.params.vault, () => route.query.to], () => {
  loadVaults()
})

const syncToVault = () => {
  if (!fromVault.value) {
    return
  }
  if (!collateralVaults.value.length) {
    if (!toVault.value) {
      toVault.value = fromVault.value as Vault | undefined
    }
    return
  }

  const currentAddress = toVault.value ? normalizeAddress(toVault.value.address) : ''
  const nextVault = collateralVaults.value.find(vault => normalizeAddress(vault.address) === currentAddress)
    || collateralVaults.value.find(v => !getVaultTags(v.address, 'swap-target').disabled)
    || collateralVaults.value[0]

  if (!toVault.value || normalizeAddress(toVault.value.address) !== normalizeAddress(nextVault.address)) {
    toVault.value = nextVault
  }
}

watch([collateralVaults, fromVault], () => {
  syncToVault()
}, { immediate: true })

const quote = computed(() => effectiveQuote.value || null)
watch([quote, toVault], () => {
  if (!quote.value || !toVault.value) {
    if (!isSameUnderlyingAsset(fromVault.value, toVault.value)) {
      toAmount.value = ''
    }
    return
  }
  const amountOut = getQuoteAmount(quote.value, 'amountOut')
  if (amountOut <= 0n) {
    toAmount.value = ''
    return
  }
  const formatted = formatUnits(amountOut, Number(toVault.value.decimals))
  const numericValue = Number(formatted)
  toAmount.value = numericValue < 0.01
    ? formatSignificant(formatted, 3)
    : formatSignificant(formatted)
}, { immediate: true })

const resetQuoteState = () => {
  resetQuoteStateInternal()
  toAmount.value = ''
}

const onRefreshQuotes = () => {
  resetQuoteState()
  isQuoteLoading.value = true
  requestQuote()
}

const savingPosition = computed(() => {
  if (!fromVault.value) {
    return null
  }
  const currentAddress = normalizeAddress(fromVault.value.address)
  if (!currentAddress) {
    return null
  }
  return depositPositions.value.find(position =>
    normalizeAddress(position.vault.address) === currentAddress
    && (!subAccount.value || normalizeAddress(position.subAccount) === normalizeAddress(subAccount.value)),
  ) || null
})

const balance = computed(() => {
  return savingPosition.value?.assets || 0n
})

const fromSupplyApy = computed(() => {
  if (!fromVault.value) {
    return null
  }
  const base = nanoToValue(fromVault.value.interestRateInfo.supplyAPY || 0n, 25)
  return withIntrinsicSupplyApy(base, fromVault.value.asset.symbol) + getSupplyRewardApy(fromVault.value.address)
})
const toSupplyApy = computed(() => {
  if (!toVault.value) {
    return null
  }
  const base = nanoToValue(toVault.value.interestRateInfo.supplyAPY || 0n, 25)
  return withIntrinsicSupplyApy(base, toVault.value.asset.symbol) + getSupplyRewardApy(toVault.value.address)
})

const currentPrice = computed(() => {
  if (!quote.value || !fromVault.value || !toVault.value) {
    return null
  }
  const amountIn = Number(formatUnits(BigInt(quote.value.amountIn), Number(fromVault.value.asset.decimals)))
  const amountOut = Number(formatUnits(BigInt(quote.value.amountOut), Number(toVault.value.asset.decimals)))
  if (!amountIn || !amountOut) {
    return null
  }
  return {
    value: amountIn / amountOut,
    symbol: `${fromVault.value.asset.symbol}/${toVault.value.asset.symbol}`,
  }
})

const swapSummary = computed(() => {
  if (!quote.value || !fromVault.value || !toVault.value) {
    return null
  }
  const amountIn = formatUnits(BigInt(quote.value.amountIn), Number(fromVault.value.asset.decimals))
  const amountOut = formatUnits(BigInt(quote.value.amountOut), Number(toVault.value.asset.decimals))
  return {
    from: `${formatNumber(amountIn)} ${fromVault.value.asset.symbol}`,
    to: `${formatSignificant(amountOut)} ${toVault.value.asset.symbol}`,
  }
})

// Price impact computed asynchronously
const priceImpact = ref<number | null>(null)

watchEffect(async () => {
  if (!quote.value || !fromVault.value || !toVault.value) {
    priceImpact.value = null
    return
  }
  const amountInUsd = await getAssetUsdValue(BigInt(quote.value.amountIn), fromVault.value, 'off-chain')
  const amountOutUsd = await getAssetUsdValue(BigInt(quote.value.amountOut), toVault.value, 'off-chain')
  if (!amountInUsd || !amountOutUsd) {
    priceImpact.value = null
    return
  }
  const impact = (amountOutUsd / amountInUsd - 1) * 100
  if (!Number.isFinite(impact)) {
    priceImpact.value = null
    return
  }
  priceImpact.value = impact
})

const routedVia = computed(() => {
  if (!quote.value?.route?.length) {
    return null
  }
  return quote.value.route.map(route => route.providerName).join(', ')
})
const formatSmallAmount = (value: bigint, decimals: number) => {
  const formatted = formatUnits(value, decimals)
  const numericValue = Number(formatted)
  return numericValue < 0.01 && numericValue > 0
    ? formatSignificant(formatted, 3)
    : formatSignificant(formatted)
}

const swapRouteItems = computed(() => {
  if (!toVault.value) {
    return []
  }
  const bestProvider = quoteCardsSorted.value[0]?.provider
  return quoteCardsSorted.value.map((card) => {
    const amountOut = getQuoteAmount(card.quote, 'amountOut')
    const amount = formatSmallAmount(amountOut, Number(toVault.value!.decimals))
    const diffPct = getQuoteDiffPct(card.quote)
    const badge = card.provider === bestProvider
      ? { label: 'Best', tone: 'best' as const }
      : diffPct !== null
        ? { label: `-${diffPct.toFixed(2)}%`, tone: 'worse' as const }
        : undefined
    return {
      provider: card.provider,
      amount,
      symbol: toVault.value!.asset.symbol,
      routeLabel: card.quote.route?.length
        ? `via ${card.quote.route.map(route => route.providerName).join(', ')}`
        : '-',
      badge,
    }
  })
})
const swapRouteEmptyMessage = computed(() => {
  if (!providersCount.value) {
    return 'Enter amount to fetch quotes'
  }
  return 'No quotes found'
})

const errorText = computed(() => {
  if (!fromVault.value?.asset) {
    return null
  }
  if (balance.value < valueToNano(fromAmount.value, fromVault.value.asset.decimals)) {
    return 'Not enough balance'
  }
  if (selectedQuote.value && +fromAmount.value > 0) {
    const amountOut = getQuoteAmount(selectedQuote.value, 'amountOut')
    if (amountOut <= 0n) {
      return 'Output amount is below minimum'
    }
  }
  return null
})
const isSameVault = computed(() => isSameVaultCheck(fromVault.value, toVault.value))
const isSameAsset = computed(() => {
  if (isSameVault.value) return false
  return isSameUnderlyingAsset(fromVault.value, toVault.value)
})
const sameVaultError = computed(() => {
  return isSameVault.value ? 'Select a different vault' : null
})

const isSubmitDisabled = computed(() => {
  if (!isConnected.value) return false
  if (!fromVault.value?.asset || !toVault.value?.asset) {
    return true
  }
  if (isSameAsset.value) {
    return isLoading.value
      || !(+fromAmount.value)
      || balance.value < valueToNano(fromAmount.value, fromVault.value.asset.decimals)
      || isSameVault.value
  }
  if (!selectedQuote.value) {
    return true
  }
  const amountOut = getQuoteAmount(selectedQuote.value, 'amountOut')
  return isLoading.value
    || isQuoteLoading.value
    || balance.value < valueToNano(fromAmount.value, fromVault.value.asset.decimals)
    || !(+fromAmount.value)
    || !toAmount.value
    || isSameVault.value
    || amountOut <= 0n
})
const isGeoBlocked = computed(() => isVaultBlockedByCountry(getVaultAddress()))
const reviewSwapDisabled = getSubmitDisabled(computed(() => isGeoBlocked.value || isSubmitDisabled.value))

const onFromInput = async () => {
  clearSimulationError()
  if (!fromVault.value || !toVault.value || !fromAmount.value || isSameVault.value) {
    toAmount.value = ''
    resetQuoteState()
    return
  }
  if (isSameAsset.value) {
    resetQuoteState()
    toAmount.value = fromAmount.value
    return
  }
  toAmount.value = ''
  requestQuote()
}

const requestQuote = useDebounceFn(async () => {
  quoteError.value = null

  if (!fromVault.value || !toVault.value || !fromAmount.value || isSameVault.value) {
    resetQuoteState()
    return
  }

  let amount: bigint
  try {
    amount = valueToNano(fromAmount.value, fromVault.value.asset.decimals)
  }
  catch {
    resetQuoteState()
    return
  }
  if (!amount || amount <= 0n) {
    resetQuoteState()
    return
  }

  toAmount.value = ''
  await requestQuotes({
    tokenIn: fromVault.value.asset.address as Address,
    tokenOut: toVault.value.asset.address as Address,
    accountIn: (address.value || zeroAddress) as Address,
    accountOut: (address.value || zeroAddress) as Address,
    amount,
    vaultIn: fromVault.value.address as Address,
    receiver: toVault.value.address as Address,
    slippage: slippage.value,
    swapperMode: SwapperMode.EXACT_IN,
    isRepay: false,
    targetDebt: 0n,
    currentDebt: 0n,
  }, {
    logContext: {
      fromVault: fromVault.value?.address,
      toVault: toVault.value?.address,
      amount: fromAmount.value,
      slippage: slippage.value,
      swapperMode: SwapperMode.EXACT_IN,
      isRepay: false,
    },
  })
}, 500)

watch(toVault, () => {
  clearSimulationError()
  if (!toVault.value) {
    toAmount.value = ''
    resetQuoteState()
    return
  }
  if (isSameVault.value) {
    toAmount.value = ''
    resetQuoteState()
    return
  }
  if (isSameAsset.value) {
    resetQuoteState()
    toAmount.value = fromAmount.value
    return
  }
  if (fromAmount.value) {
    onFromInput()
  }
})

watch([fromVault, slippage], () => {
  clearSimulationError()
  if (fromAmount.value) {
    requestQuote()
  }
})
watch(selectedQuote, () => {
  clearSimulationError()
})

const onToVaultChange = (selectedIndex: number) => {
  const nextVault = collateralVaults.value[selectedIndex]
  if (!nextVault) {
    return
  }
  if (!toVault.value || normalizeAddress(toVault.value.address) !== normalizeAddress(nextVault.address)) {
    toVault.value = nextVault
  }
}

const buildPlan = async (): Promise<TxPlan> => {
  if (isSameAsset.value) {
    if (!fromVault.value || !toVault.value) {
      throw new Error('Vaults not loaded')
    }
    const amount = valueToNano(fromAmount.value, fromVault.value.asset.decimals)
    const isMax = balance.value > 0n && amount >= balance.value
    return buildSameAssetSwapPlan({
      fromVaultAddress: fromVault.value.address,
      toVaultAddress: toVault.value.address,
      amount,
      isMax,
      maxShares: isMax ? savingPosition.value?.shares : undefined,
    })
  }
  if (!selectedQuote.value) {
    throw new Error('No quote selected')
  }
  return buildSwapPlan({
    quote: selectedQuote.value,
    swapperMode: SwapperMode.EXACT_IN,
    isRepay: false,
    targetDebt: 0n,
    currentDebt: 0n,
  })
}

const submit = async () => {
  if (isPreparing.value || isGeoBlocked.value) return
  isPreparing.value = true
  try {
    await guardWithTerms(async () => {
      if (isSubmitting.value || !fromVault.value) {
        return
      }
      if (!isSameAsset.value && !selectedQuote.value) {
        return
      }

      try {
        plan.value = await buildPlan()
      }
      catch (e) {
        console.warn('[OperationReviewModal] failed to build plan', e)
        showError('Failed to build transaction')
        plan.value = null
        return
      }

      if (plan.value) {
        const ok = await runSimulation(plan.value)
        if (!ok) {
          return
        }
      }

      modal.open(OperationReviewModal, {
        props: {
          type: isSameAsset.value ? 'transfer' : 'swap',
          asset: fromVault.value.asset,
          amount: fromAmount.value,
          swapToAsset: toVault.value?.asset,
          swapToAmount: toAmount.value,
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
  finally {
    isPreparing.value = false
  }
}

const send = async () => {
  if (!fromVault.value) {
    return
  }
  if (!isSameAsset.value && !selectedQuote.value) {
    return
  }

  isSubmitting.value = true
  try {
    const txPlan = await buildPlan()
    await executeTxPlan(txPlan)
    modal.close()
    setTimeout(() => {
      router.replace('/portfolio/saving')
    }, 400)
  }
  catch (e) {
    showError('Transaction failed')
    console.warn(e)
  }
  finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <div class="flex gap-32">
    <VaultForm
      title="Asset swap"
      class="flex flex-col gap-16 w-full"
      :loading="isLoading"
      @submit.prevent="submit"
    >
      <template v-if="fromVault">
        <VaultLabelsAndAssets
          :vault="fromVault"
          :assets="[fromVault.asset]"
          size="large"
        />
        <div class="grid gap-16 laptop:grid-cols-[minmax(0,1fr)_360px] laptop:items-start">
          <div class="flex flex-col gap-16 w-full">
            <AssetInput
              v-model="fromAmount"
              :desc="fromProduct.name"
              label="From"
              :asset="fromVault.asset"
              :vault="isFromSecuritizeVault ? undefined : (fromVault as Vault)"
              :balance="balance"
              maxable
              @input="onFromInput"
            />

            <SwapRouteSelector
              v-if="!isSameAsset"
              :items="swapRouteItems"
              :selected-provider="selectedProvider"
              :status-label="quotesStatusLabel"
              :is-loading="isQuoteLoading"
              :empty-message="swapRouteEmptyMessage"
              @select="selectProvider"
              @refresh="onRefreshQuotes"
            />

            <AssetInput
              v-if="toVault"
              v-model="toAmount"
              :desc="toProduct.name"
              label="To"
              :asset="toVault.asset"
              :vault="toVault"
              :collateral-options="collateralOptions"
              collateral-modal-title="Select vault"
              :readonly="true"
              @change-collateral="onToVaultChange"
            />
            <div
              v-else
              class="bg-euler-dark-400 rounded-16 p-16 text-euler-dark-900"
            >
              No asset swap options available
            </div>

            <UiToast
              v-if="isGeoBlocked"
              title="Region restricted"
              description="This operation is not available in your region. You can still withdraw existing deposits."
              variant="warning"
              size="compact"
            />
            <UiToast
              v-show="errorText"
              title="Error"
              variant="error"
              :description="errorText || ''"
              size="compact"
            />
            <UiToast
              v-if="sameVaultError"
              title="Error"
              variant="error"
              :description="sameVaultError"
              size="compact"
            />
            <UiToast
              v-if="simulationError"
              title="Error"
              variant="error"
              :description="simulationError"
              size="compact"
            />

            <UiToast
              v-if="quoteError"
              title="Swap quote"
              variant="warning"
              :description="quoteError"
              size="compact"
            />
          </div>

          <VaultFormInfoBlock
            :loading="!isSameAsset && isQuoteLoading"
            variant="card"
            class="w-full laptop:max-w-[360px]"
          >
            <SummaryRow :label="`${fromVault.asset.symbol || 'Token1'} supply APY`">
              <p class="text-p2">
                {{ fromSupplyApy !== null ? `${formatNumber(fromSupplyApy)}%` : '-' }}
              </p>
            </SummaryRow>
            <SummaryRow :label="`${toVault?.asset?.symbol || 'Token2'} supply APY`">
              <p class="text-p2">
                {{ toSupplyApy !== null ? `${formatNumber(toSupplyApy)}%` : '-' }}
              </p>
            </SummaryRow>
            <template v-if="!isSameAsset">
              <SummaryRow label="Swap price" align-top>
                <p class="text-p2 text-right">
                  {{ currentPrice ? `${formatSmartAmount(currentPrice.value)} ${currentPrice.symbol}` : '-' }}
                </p>
              </SummaryRow>
              <SummaryRow label="Swap" align-top>
                <p class="text-p2 text-right flex flex-col items-end">
                  <span>{{ swapSummary ? swapSummary.from : '-' }}</span>
                  <span
                    v-if="swapSummary"
                    class="text-content-tertiary text-p3"
                  >
                    {{ swapSummary.to }}
                  </span>
                </p>
              </SummaryRow>
              <SummaryRow label="Price impact">
                <p class="text-p2">
                  {{ priceImpact !== null ? `${formatNumber(priceImpact, 2, 2)}%` : '-' }}
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
                  {{ routedVia || '-' }}
                </p>
              </SummaryRow>
            </template>
            <SummaryRow v-else label="Transfer">
              <p class="text-p2">
                1:1 (same asset, no slippage)
              </p>
            </SummaryRow>
          </VaultFormInfoBlock>

          <div class="flex flex-col gap-8 laptop:col-start-1 laptop:row-start-2">
            <VaultFormSubmit
              :disabled="reviewSwapDisabled"
              :loading="isSubmitting || isPreparing"
            >
              {{ reviewSwapLabel }}
            </VaultFormSubmit>
          </div>
        </div>
      </template>
    </VaultForm>
  </div>
</template>
