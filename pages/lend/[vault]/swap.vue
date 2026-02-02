<script setup lang="ts">
import { useAccount } from '@wagmi/vue'
import { ethers } from 'ethers'
import { type Address, zeroAddress } from 'viem'
import { OperationReviewModal, SlippageSettingsModal } from '#components'
import { useTermsOfUseGate } from '~/composables/useTermsOfUseGate'
import { type Vault, getVaultPrice } from '~/entities/vault'
import { useEulerProductOfVault } from '~/composables/useEulerLabels'
import { useSwapCollateralOptions } from '~/composables/useSwapCollateralOptions'
import { useSwapQuotesParallel } from '~/composables/useSwapQuotesParallel'
import { SwapperMode } from '~/entities/swap'
import { getQuoteAmount } from '~/utils/swapQuotes'
import type { TxPlan } from '~/entities/txPlan'
import { useModal } from '~/components/ui/composables/useModal'
import { useToast } from '~/components/ui/composables/useToast'
import { useMerkl } from '~/composables/useMerkl'
import { useIntrinsicApy } from '~/composables/useIntrinsicApy'

const route = useRoute()
const router = useRouter()
const { getVault } = useVaults()
const { isConnected, address } = useAccount()
const { depositPositions } = useEulerAccount()
const { swap: executeSwap, buildSwapPlan } = useEulerOperations()
const modal = useModal()
const { error: showError } = useToast()
const { getSubmitLabel, getSubmitDisabled, guardWithTerms } = useTermsOfUseGate()
const reviewSwapLabel = getSubmitLabel('Review Swap')
const { getOpportunityOfLendVault } = useMerkl()
const { withIntrinsicSupplyApy } = useIntrinsicApy()
const { runSimulation, simulationError, clearSimulationError } = useTxPlanSimulation()
const openSlippageSettings = () => {
  modal.open(SlippageSettingsModal)
}

const isLoading = ref(false)
const isSubmitting = ref(false)
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

const fromVault: Ref<Vault | undefined> = ref()
const toVault: Ref<Vault | undefined> = ref()

const fromProduct = useEulerProductOfVault(computed(() => fromVault.value?.address || ''))
const toProduct = useEulerProductOfVault(computed(() => toVault.value?.address || ''))
const { collateralOptions, collateralVaults } = useSwapCollateralOptions({ currentVault: fromVault })

const getVaultAddress = () => route.params.vault as string
const getTargetAddress = () => (typeof route.query.to === 'string' ? route.query.to : '')

const loadVaults = async () => {
  isLoading.value = true
  try {
    const baseAddress = getVaultAddress()
    const targetAddress = getTargetAddress()

    fromVault.value = await getVault(baseAddress)
    if (targetAddress && ethers.isAddress(targetAddress) && ethers.getAddress(targetAddress) !== ethers.getAddress(baseAddress)) {
      toVault.value = await getVault(targetAddress)
    }
    else {
      toVault.value = fromVault.value
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

const normalizeAddress = (address?: string) => {
  if (!address) {
    return ''
  }
  try {
    return ethers.getAddress(address)
  }
  catch {
    return ''
  }
}

const syncToVault = () => {
  if (!fromVault.value) {
    return
  }
  if (!collateralVaults.value.length) {
    if (!toVault.value) {
      toVault.value = fromVault.value
    }
    return
  }

  const currentAddress = toVault.value ? normalizeAddress(toVault.value.address) : ''
  const nextVault = collateralVaults.value.find(vault => normalizeAddress(vault.address) === currentAddress)
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
    toAmount.value = ''
    return
  }
  const amountOut = getQuoteAmount(quote.value, 'amountOut')
  toAmount.value = amountOut > 0n
    ? formatSignificant(ethers.formatUnits(amountOut, Number(toVault.value.decimals)))
    : ''
}, { immediate: true })

const resetQuoteState = () => {
  resetQuoteStateInternal()
  toAmount.value = ''
}

const savingPosition = computed(() => {
  if (!fromVault.value) {
    return null
  }
  const currentAddress = normalizeAddress(fromVault.value.address)
  if (!currentAddress) {
    return null
  }
  return depositPositions.value.find(position => normalizeAddress(position.vault.address) === currentAddress) || null
})

const balance = computed(() => {
  return savingPosition.value?.assets || 0n
})

const fromOpportunity = computed(() => {
  return fromVault.value ? getOpportunityOfLendVault(fromVault.value.address) : null
})
const toOpportunity = computed(() => {
  return toVault.value ? getOpportunityOfLendVault(toVault.value.address) : null
})
const fromSupplyApy = computed(() => {
  if (!fromVault.value) {
    return null
  }
  const base = nanoToValue(fromVault.value.interestRateInfo.supplyAPY || 0n, 25)
  return withIntrinsicSupplyApy(base, fromVault.value.asset.symbol) + (fromOpportunity.value?.apr || 0)
})
const toSupplyApy = computed(() => {
  if (!toVault.value) {
    return null
  }
  const base = nanoToValue(toVault.value.interestRateInfo.supplyAPY || 0n, 25)
  return withIntrinsicSupplyApy(base, toVault.value.asset.symbol) + (toOpportunity.value?.apr || 0)
})

const currentPrice = computed(() => {
  if (!quote.value || !fromVault.value || !toVault.value) {
    return null
  }
  const amountIn = Number(ethers.formatUnits(BigInt(quote.value.amountIn), Number(fromVault.value.asset.decimals)))
  const amountOut = Number(ethers.formatUnits(BigInt(quote.value.amountOut), Number(toVault.value.asset.decimals)))
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
  const amountIn = ethers.formatUnits(BigInt(quote.value.amountIn), Number(fromVault.value.asset.decimals))
  const amountOut = ethers.formatUnits(BigInt(quote.value.amountOut), Number(toVault.value.asset.decimals))
  return {
    from: `${formatNumber(amountIn)} ${fromVault.value.asset.symbol}`,
    to: `${formatSignificant(amountOut)} ${toVault.value.asset.symbol}`,
  }
})

const priceImpact = computed(() => {
  if (!quote.value || !fromVault.value || !toVault.value) {
    return null
  }
  const amountInUsd = getVaultPrice(BigInt(quote.value.amountIn), fromVault.value)
  const amountOutUsd = getVaultPrice(BigInt(quote.value.amountOut), toVault.value)
  if (!amountInUsd || !amountOutUsd) {
    return null
  }
  const impact = (amountOutUsd / amountInUsd - 1) * 100
  if (!Number.isFinite(impact)) {
    return null
  }
  return impact
})

const routedVia = computed(() => {
  if (!quote.value?.route?.length) {
    return null
  }
  return quote.value.route.map(route => route.providerName).join(', ')
})
const swapRouteItems = computed(() => {
  if (!toVault.value) {
    return []
  }
  const bestProvider = quoteCardsSorted.value[0]?.provider
  return quoteCardsSorted.value.map((card) => {
    const amountOut = getQuoteAmount(card.quote, 'amountOut')
    const amount = formatSignificant(
      ethers.formatUnits(amountOut, Number(toVault.value.decimals)),
    )
    const diffPct = getQuoteDiffPct(card.quote)
    const badge = card.provider === bestProvider
      ? { label: 'Best', tone: 'best' as const }
      : diffPct !== null
        ? { label: `-${diffPct.toFixed(2)}%`, tone: 'worse' as const }
        : undefined
    return {
      provider: card.provider,
      amount,
      symbol: toVault.value.asset.symbol,
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
  return null
})
const isSameVault = computed(() => {
  if (!fromVault.value || !toVault.value) {
    return false
  }
  return normalizeAddress(fromVault.value.address) === normalizeAddress(toVault.value.address)
})
const sameVaultError = computed(() => {
  return isSameVault.value ? 'Select a different vault' : null
})

const isSubmitDisabled = computed(() => {
  if (!isConnected.value) return false
  if (!fromVault.value?.asset || !toVault.value?.asset || !selectedQuote.value) {
    return true
  }
  return isLoading.value
    || balance.value < valueToNano(fromAmount.value, fromVault.value.asset.decimals)
    || !(+fromAmount.value)
    || !toAmount.value
    || isSameVault.value
})
const reviewSwapDisabled = getSubmitDisabled(isSubmitDisabled)

const onFromInput = async () => {
  clearSimulationError()
  if (!fromVault.value || !toVault.value || !fromAmount.value || isSameVault.value) {
    toAmount.value = ''
    resetQuoteState()
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

const submit = async () => {
  await guardWithTerms(async () => {
    if (isSubmitting.value || !fromVault.value || !selectedQuote.value) {
      return
    }

    try {
      plan.value = await buildSwapPlan({
        quote: selectedQuote.value,
        swapperMode: SwapperMode.EXACT_IN,
        isRepay: false,
        targetDebt: 0n,
        currentDebt: 0n,
      })
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
        type: 'swap',
        asset: fromVault.value.asset,
        amount: fromAmount.value,
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
  if (!fromVault.value || !selectedQuote.value) {
    return
  }

  isSubmitting.value = true
  try {
    await executeSwap({
      quote: selectedQuote.value,
      swapperMode: SwapperMode.EXACT_IN,
      isRepay: false,
      targetDebt: 0n,
      currentDebt: 0n,
    })
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
      <template v-if="fromVault && toVault">
        <div class="grid gap-16 laptop:grid-cols-[minmax(0,1fr)_360px] laptop:items-start">
          <div class="flex flex-col gap-16 w-full">
            <AssetInput
              v-model="fromAmount"
              :desc="fromProduct.name"
              label="From"
              :asset="fromVault.asset"
              :vault="fromVault"
              :balance="balance"
              maxable
              @input="onFromInput"
            />

            <SwapRouteSelector
              :items="swapRouteItems"
              :selected-provider="selectedProvider"
              :status-label="quotesStatusLabel"
              :is-loading="isQuoteLoading"
              :empty-message="swapRouteEmptyMessage"
              @select="selectProvider"
            />

            <AssetInput
              v-model="toAmount"
              :desc="toProduct.name"
              label="To"
              :asset="toVault.asset"
              :vault="toVault"
              :collateral-options="collateralOptions"
              :readonly="true"
              @change-collateral="onToVaultChange"
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
            :loading="isQuoteLoading"
            class="bg-euler-dark-400 p-16 rounded-16 flex flex-col gap-16 w-full laptop:max-w-[360px]"
          >
            <div class="flex justify-between items-center">
              <p class="text-euler-dark-900">
                {{ fromVault.asset.symbol || 'Token1' }} supply APY
              </p>
              <p class="text-p2">
                {{ fromSupplyApy !== null ? `${formatNumber(fromSupplyApy)}%` : '-' }}
              </p>
            </div>
            <div class="flex justify-between items-center">
              <p class="text-euler-dark-900">
                {{ toVault.asset.symbol || 'Token2' }} supply APY
              </p>
              <p class="text-p2">
                {{ toSupplyApy !== null ? `${formatNumber(toSupplyApy)}%` : '-' }}
              </p>
            </div>
            <div class="flex justify-between items-center">
              <p class="text-euler-dark-900">
                Current price
              </p>
              <p class="text-p2">
                {{ currentPrice ? `${formatNumber(currentPrice.value)} ${currentPrice.symbol}` : '-' }}
              </p>
            </div>
            <div class="flex justify-between items-start">
              <p class="text-euler-dark-900">
                Swap
              </p>
              <p class="text-p2 text-right flex flex-col items-end">
                <span>{{ swapSummary ? swapSummary.from : '-' }}</span>
                <span
                  v-if="swapSummary"
                  class="text-euler-dark-900 text-p3"
                >
                  {{ swapSummary.to }}
                </span>
              </p>
            </div>
            <div class="flex justify-between items-center">
              <p class="text-euler-dark-900">
                Price impact
              </p>
              <p class="text-p2">
                {{ priceImpact !== null ? `${formatNumber(priceImpact, 2, 2)}%` : '-' }}
              </p>
            </div>
            <div class="flex justify-between items-center">
              <p class="text-euler-dark-900">
                Slippage tolerance
              </p>
              <button
                type="button"
                class="flex items-center gap-6 text-p2"
                @click="openSlippageSettings"
              >
                <span>{{ formatNumber(slippage, 2, 0) }}%</span>
                <SvgIcon
                  name="edit"
                  class="!w-16 !h-16 text-aquamarine-700"
                />
              </button>
            </div>
            <div class="flex justify-between items-center">
              <p class="text-euler-dark-900">
                Routed via
              </p>
              <p class="text-p2 text-right">
              {{ routedVia || '-' }}
            </p>
          </div>
          </VaultFormInfoBlock>

          <div class="flex flex-col gap-8 laptop:col-start-1 laptop:row-start-2">
            <VaultFormSubmit
              :disabled="reviewSwapDisabled"
              :loading="isSubmitting"
            >
              {{ reviewSwapLabel }}
            </VaultFormSubmit>
          </div>
        </div>
      </template>
    </VaultForm>
  </div>
</template>
