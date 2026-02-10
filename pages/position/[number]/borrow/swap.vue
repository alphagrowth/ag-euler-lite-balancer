<script setup lang="ts">
import { useAccount } from '@wagmi/vue'
import { getAddress, formatUnits, isAddress, zeroAddress, type Address } from 'viem'
import { OperationReviewModal, SlippageSettingsModal } from '#components'
import { useTermsOfUseGate } from '~/composables/useTermsOfUseGate'
import type { AccountBorrowPosition } from '~/entities/account'
import { type Vault } from '~/entities/vault'
import { getAssetUsdValue, getAssetOraclePrice, getCollateralOraclePrice } from '~/services/pricing/priceProvider'
import { useEulerProductOfVault } from '~/composables/useEulerLabels'
import { isAnyVaultBlockedByCountry } from '~/composables/useGeoBlock'
import { useSwapDebtOptions } from '~/composables/useSwapDebtOptions'
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
const { isConnected, address } = useAccount()
const { isPositionsLoaded, isPositionsLoading, getPositionBySubAccountIndex } = useEulerAccount()
const { buildSwapPlan, executeTxPlan } = useEulerOperations()
const modal = useModal()
const { error: showError } = useToast()
const { getSubmitLabel, getSubmitDisabled, guardWithTerms } = useTermsOfUseGate()
const reviewSwapLabel = getSubmitLabel(computed(() => selectedQuote.value ? 'Review Swap' : 'Select a Quote'))
const { getOpportunityOfBorrowVault, getOpportunityOfLendVault } = useMerkl()
const { withIntrinsicBorrowApy, withIntrinsicSupplyApy } = useIntrinsicApy()
const { runSimulation, simulationError, clearSimulationError } = useTxPlanSimulation()
const openSlippageSettings = () => {
  modal.open(SlippageSettingsModal)
}

const positionIndex = route.params.number as string

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
} = useSwapQuotesParallel({ amountField: 'amountIn', compare: 'min' })

const position: Ref<AccountBorrowPosition | null> = ref(null)

const fromVault = computed(() => position.value?.borrow)
const collateralVault = computed(() => position.value?.collateral)
const toVault: Ref<Vault | undefined> = ref()

const fromProduct = useEulerProductOfVault(computed(() => fromVault.value?.address || ''))
const toProduct = useEulerProductOfVault(computed(() => toVault.value?.address || ''))
const { borrowOptions, borrowVaults } = useSwapDebtOptions({
  collateralVault: computed(() => collateralVault.value as Vault | undefined),
  currentBorrowVault: computed(() => fromVault.value as Vault | undefined),
})

const quote = computed(() => effectiveQuote.value || null)
watch([quote, toVault], () => {
  if (!quote.value || !toVault.value) {
    toAmount.value = ''
    return
  }
  const amountIn = getQuoteAmount(quote.value, 'amountIn')
  if (amountIn <= 0n) {
    toAmount.value = ''
    return
  }
  const formatted = formatUnits(amountIn, Number(toVault.value.decimals))
  const numericValue = Number(formatted)
  toAmount.value = numericValue < 0.01
    ? formatSignificant(formatted, 3)
    : formatSignificant(formatted)
}, { immediate: true })
const currentDebt = computed(() => position.value?.borrowed || 0n)
const balance = computed(() => currentDebt.value)

const setFromAmountToMax = () => {
  if (!fromVault.value) {
    fromAmount.value = ''
    return
  }
  const exact = formatUnits(currentDebt.value, fromVault.value.decimals)
  const [intPart, decPart = ''] = exact.split('.')
  const sigDigitsInInt = intPart.replace(/^0+/, '').length
  if (sigDigitsInInt >= 6) {
    fromAmount.value = intPart
  }
  else {
    const decLen = Math.max(0, 6 - sigDigitsInInt)
    fromAmount.value = decPart.length > 0
      ? `${intPart}.${decPart.slice(0, decLen)}`
      : intPart
  }
}

const loadPosition = async () => {
  if (!isConnected.value) {
    position.value = null
    return
  }
  isLoading.value = true
  await until(isPositionsLoaded).toBe(true)

  position.value = getPositionBySubAccountIndex(+positionIndex) || null
  if (position.value) {
    setFromAmountToMax()
  }
  isLoading.value = false
}

watch([isPositionsLoaded, () => route.params.number], ([loaded]) => {
  if (loaded) {
    loadPosition()
  }
}, { immediate: true })

const normalizeAddress = (address?: string) => {
  if (!address) {
    return ''
  }
  try {
    return getAddress(address)
  }
  catch {
    return ''
  }
}

const getTargetAddress = () => (typeof route.query.to === 'string' ? route.query.to : '')

const syncToVault = () => {
  if (!fromVault.value) {
    return
  }
  if (!borrowVaults.value.length) {
    if (!toVault.value) {
      toVault.value = fromVault.value
    }
    return
  }

  const targetAddress = normalizeAddress(getTargetAddress())
  const currentAddress = toVault.value ? normalizeAddress(toVault.value.address) : ''
  const nextVault = borrowVaults.value.find(vault => normalizeAddress(vault.address) === targetAddress)
    || borrowVaults.value.find(vault => normalizeAddress(vault.address) === currentAddress)
    || borrowVaults.value[0]

  if (!toVault.value || normalizeAddress(toVault.value.address) !== normalizeAddress(nextVault.address)) {
    toVault.value = nextVault
  }
}

watch([borrowVaults, fromVault, () => route.query.to], () => {
  syncToVault()
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

const fromOpportunity = computed(() => {
  return fromVault.value ? getOpportunityOfBorrowVault(fromVault.value.asset.address) : null
})
const toOpportunity = computed(() => {
  return toVault.value ? getOpportunityOfBorrowVault(toVault.value.asset.address) : null
})
const collateralOpportunity = computed(() => {
  return collateralVault.value ? getOpportunityOfLendVault(collateralVault.value.address) : null
})
const collateralSupplyApy = computed(() => {
  if (!collateralVault.value) {
    return null
  }
  const base = nanoToValue(collateralVault.value.interestRateInfo.supplyAPY || 0n, 25)
  return withIntrinsicSupplyApy(base, collateralVault.value.asset.symbol) + (collateralOpportunity.value?.apr || 0)
})
const fromBorrowApy = computed(() => {
  if (!fromVault.value) {
    return null
  }
  const base = nanoToValue(fromVault.value.interestRateInfo.borrowAPY || 0n, 25)
  return withIntrinsicBorrowApy(base, fromVault.value.asset.symbol) - (fromOpportunity.value?.apr || 0)
})
const toBorrowApy = computed(() => {
  if (!toVault.value) {
    return null
  }
  const base = nanoToValue(toVault.value.interestRateInfo.borrowAPY || 0n, 25)
  return withIntrinsicBorrowApy(base, toVault.value.asset.symbol) - (toOpportunity.value?.apr || 0)
})

const supplyValueUsd = ref<number | null>(null)
watchEffect(async () => {
  if (!collateralVault.value || !position.value) {
    supplyValueUsd.value = null
    return
  }
  supplyValueUsd.value = (await getAssetUsdValue(position.value.supplied, collateralVault.value, 'off-chain')) ?? null
})
const currentBorrowValueUsd = ref<number | null>(null)
watchEffect(async () => {
  if (!fromVault.value || !position.value) {
    currentBorrowValueUsd.value = null
    return
  }
  currentBorrowValueUsd.value = (await getAssetUsdValue(position.value.borrowed, fromVault.value, 'off-chain')) ?? null
})
const nextBorrowValueUsd = ref<number | null>(null)
watchEffect(async () => {
  if (!quote.value || !toVault.value) {
    nextBorrowValueUsd.value = null
    return
  }
  nextBorrowValueUsd.value = (await getAssetUsdValue(BigInt(quote.value.amountIn), toVault.value, 'off-chain')) ?? null
})

const calculateRoe = (
  supplyUsd: number | null,
  borrowUsd: number | null,
  supplyApy: number | null,
  borrowApy: number | null,
) => {
  if (supplyUsd === null || borrowUsd === null || supplyApy === null || borrowApy === null) {
    return null
  }
  const equity = supplyUsd - borrowUsd
  if (!Number.isFinite(equity) || equity <= 0) {
    return null
  }
  const net = supplyUsd * supplyApy - borrowUsd * borrowApy
  if (!Number.isFinite(net)) {
    return null
  }
  return net / equity
}

const roeBefore = computed(() => {
  return calculateRoe(supplyValueUsd.value, currentBorrowValueUsd.value, collateralSupplyApy.value, fromBorrowApy.value)
})
const roeAfter = computed(() => {
  return calculateRoe(supplyValueUsd.value, nextBorrowValueUsd.value, collateralSupplyApy.value, toBorrowApy.value)
})

const priceRatio = computed(() => {
  if (!collateralVault.value || !toVault.value) {
    return null
  }
  const collateralPrice = getCollateralOraclePrice(toVault.value, collateralVault.value)
  const borrowPrice = getAssetOraclePrice(toVault.value)
  const ask = collateralPrice?.amountOutAsk || 0n
  const bid = borrowPrice?.amountOutBid || 0n
  if (!ask || !bid) {
    return null
  }
  return nanoToValue(ask, 18) / nanoToValue(bid, 18)
})

const collateralAmount = computed(() => {
  if (!collateralVault.value || !position.value) {
    return null
  }
  return nanoToValue(position.value.supplied, collateralVault.value.decimals)
})
const nextBorrowAmount = computed(() => {
  if (!quote.value || !toVault.value) {
    return null
  }
  return nanoToValue(BigInt(quote.value.amountIn), toVault.value.decimals)
})

const currentLtv = computed(() => {
  if (!position.value) {
    return null
  }
  return nanoToValue(position.value.userLTV, 18)
})
const currentLiquidationLtv = computed(() => {
  if (!position.value) {
    return null
  }
  return nanoToValue(position.value.liquidationLTV, 2)
})
const nextLiquidationLtv = computed(() => {
  if (!toVault.value || !collateralVault.value) {
    return null
  }
  const match = toVault.value.collateralLTVs.find(
    ltv => normalizeAddress(ltv.collateral) === normalizeAddress(collateralVault.value?.address),
  )
  return match ? nanoToValue(match.liquidationLTV, 2) : null
})
const nextLtv = computed(() => {
  if (!nextBorrowAmount.value || !collateralAmount.value || !priceRatio.value) {
    return null
  }
  if (priceRatio.value <= 0 || collateralAmount.value <= 0) {
    return null
  }
  return (nextBorrowAmount.value / (collateralAmount.value * priceRatio.value)) * 100
})
const currentHealth = computed(() => {
  if (!position.value) {
    return null
  }
  return nanoToValue(position.value.health, 18)
})
const nextHealth = computed(() => {
  if (!nextLiquidationLtv.value || !nextLtv.value) {
    return null
  }
  if (nextLtv.value <= 0) {
    return null
  }
  return nextLiquidationLtv.value / nextLtv.value
})
const currentLiquidationPrice = computed(() => {
  if (!position.value?.price) {
    return null
  }
  const value = nanoToValue(position.value.price, 18)
  return value > 0 ? value : null
})
const nextLiquidationPrice = computed(() => {
  if (!priceRatio.value || !nextHealth.value) {
    return null
  }
  if (nextHealth.value <= 0) {
    return null
  }
  return priceRatio.value / nextHealth.value
})

const currentPrice = computed(() => {
  if (!quote.value || !fromVault.value || !toVault.value) {
    return null
  }
  const amountOut = Number(formatUnits(BigInt(quote.value.amountOut), Number(fromVault.value.asset.decimals)))
  const amountIn = Number(formatUnits(BigInt(quote.value.amountIn), Number(toVault.value.asset.decimals)))
  if (!amountOut || !amountIn) {
    return null
  }
  return {
    value: amountOut / amountIn,
    symbol: `${fromVault.value.asset.symbol}/${toVault.value.asset.symbol}`,
  }
})

const swapSummary = computed(() => {
  if (!quote.value || !fromVault.value || !toVault.value) {
    return null
  }
  const amountOut = formatUnits(BigInt(quote.value.amountOut), Number(fromVault.value.asset.decimals))
  const amountIn = formatUnits(BigInt(quote.value.amountIn), Number(toVault.value.asset.decimals))
  return {
    from: `${formatNumber(amountOut)} ${fromVault.value.asset.symbol}`,
    to: `${formatSignificant(amountIn)} ${toVault.value.asset.symbol}`,
  }
})

const priceImpact = ref<number | null>(null)
watchEffect(async () => {
  if (!quote.value || !fromVault.value || !toVault.value) {
    priceImpact.value = null
    return
  }
  const amountOutUsd = await getAssetUsdValue(BigInt(quote.value.amountOut), fromVault.value, 'off-chain')
  const amountInUsd = await getAssetUsdValue(BigInt(quote.value.amountIn), toVault.value, 'off-chain')
  if (!amountOutUsd || !amountInUsd) {
    priceImpact.value = null
    return
  }
  const impact = (amountInUsd / amountOutUsd - 1) * 100
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
    const amountIn = getQuoteAmount(card.quote, 'amountIn')
    const amount = formatSmallAmount(amountIn, Number(toVault.value.decimals))
    const diffPct = getQuoteDiffPct(card.quote)
    const badge = card.provider === bestProvider
      ? { label: 'Best', tone: 'best' as const }
      : diffPct !== null
        ? { label: `+${diffPct.toFixed(2)}%`, tone: 'worse' as const }
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
  if (!fromVault.value?.asset || !fromAmount.value) {
    return null
  }
  try {
    const amount = valueToNano(fromAmount.value, fromVault.value.asset.decimals)
    if (amount > currentDebt.value) {
      return 'Amount exceeds current debt'
    }
  }
  catch {
    return null
  }
  if (selectedQuote.value && +fromAmount.value > 0) {
    const amountOut = getQuoteAmount(selectedQuote.value, 'amountOut')
    if (amountOut <= 0n) {
      return 'Output amount is below minimum'
    }
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
const healthError = computed(() => {
  if (!quote.value || nextHealth.value === null) {
    return null
  }
  if (!Number.isFinite(nextHealth.value)) {
    return null
  }
  return nextHealth.value <= 1 ? 'Swap would make position unhealthy' : null
})

const isSubmitDisabled = computed(() => {
  if (!isConnected.value) return false
  if (!fromVault.value?.asset || !toVault.value?.asset || !selectedQuote.value) {
    return true
  }
  const amountOut = getQuoteAmount(selectedQuote.value, 'amountOut')
  return isLoading.value
    || isQuoteLoading.value
    || !(+fromAmount.value)
    || amountOut <= 0n
    || !!errorText.value
    || !!healthError.value
    || isSameVault.value
})
const isGeoBlocked = computed(() => {
  const addresses: string[] = []
  if (fromVault.value) addresses.push(fromVault.value.address)
  if (collateralVault.value) addresses.push(collateralVault.value.address)
  return isAnyVaultBlockedByCountry(...addresses)
})
const reviewSwapDisabled = getSubmitDisabled(computed(() => isGeoBlocked.value || isSubmitDisabled.value))

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

  if (!fromVault.value || !toVault.value || !fromAmount.value || !position.value || isSameVault.value) {
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
  if (amount > currentDebt.value) {
    resetQuoteState()
    return
  }

  toAmount.value = ''
  const accountIn = (address.value || zeroAddress) as Address
  const accountOut = (position.value.subAccount || accountIn) as Address
  await requestQuotes({
    tokenIn: toVault.value.asset.address as Address,
    tokenOut: fromVault.value.asset.address as Address,
    accountIn,
    accountOut,
    amount,
    vaultIn: toVault.value.address as Address,
    receiver: fromVault.value.address as Address,
    slippage: slippage.value,
    swapperMode: SwapperMode.TARGET_DEBT,
    isRepay: true,
    targetDebt: 0n,
    currentDebt: 0n,
  }, {
    logContext: {
      fromVault: fromVault.value?.address,
      toVault: toVault.value?.address,
      amount: fromAmount.value,
      slippage: slippage.value,
      swapperMode: SwapperMode.TARGET_DEBT,
      isRepay: true,
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

watch([currentDebt, fromVault], () => {
  clearSimulationError()
  if (!position.value) {
    return
  }
  setFromAmountToMax()
  if (toVault.value) {
    requestQuote()
  }
})

const onToVaultChange = (selectedIndex: number) => {
  clearSimulationError()
  const nextVault = borrowVaults.value[selectedIndex]
  if (!nextVault) {
    return
  }
  if (!toVault.value || normalizeAddress(toVault.value.address) !== normalizeAddress(nextVault.address)) {
    toVault.value = nextVault
  }
}

const submit = async () => {
  if (isGeoBlocked.value) return
  await guardWithTerms(async () => {
    if (isSubmitting.value || !fromVault.value || !selectedQuote.value) {
      return
    }

    try {
      plan.value = await buildSwapPlan({
        quote: selectedQuote.value,
        swapperMode: SwapperMode.TARGET_DEBT,
        isRepay: true,
        targetDebt: 0n,
        currentDebt: 0n,
        liabilityVault: fromVault.value?.address,
        enabledCollaterals: position.value?.collaterals,
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

const send = async () => {
  if (!fromVault.value || !selectedQuote.value) {
    return
  }

  isSubmitting.value = true
  try {
    const txPlan = await buildSwapPlan({
      quote: selectedQuote.value,
      swapperMode: SwapperMode.TARGET_DEBT,
      isRepay: true,
      targetDebt: 0n,
      currentDebt: 0n,
      liabilityVault: fromVault.value?.address,
      enabledCollaterals: position.value?.collaterals,
    })
    await executeTxPlan(txPlan)
    modal.close()
    setTimeout(() => {
      router.replace('/portfolio')
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
      title="Debt swap"
      class="flex flex-col gap-16 w-full"
      :loading="isLoading || isPositionsLoading"
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
              :readonly="true"
            />

            <SwapRouteSelector
              :items="swapRouteItems"
              :selected-provider="selectedProvider"
              :status-label="quotesStatusLabel"
              :is-loading="isQuoteLoading"
              :empty-message="swapRouteEmptyMessage"
              @select="selectProvider"
              @refresh="onRefreshQuotes"
            />

            <AssetInput
              v-model="toAmount"
              :desc="toProduct.name"
              label="To"
              :asset="toVault.asset"
              :vault="toVault"
              :collateral-options="borrowOptions"
              :readonly="true"
              @change-collateral="onToVaultChange"
            />

            <UiToast
              v-if="isGeoBlocked"
              title="Region restricted"
              description="This operation is not available in your region. You can still repay existing debt."
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
              v-if="healthError"
              title="Unhealthy position"
              variant="error"
              :description="healthError"
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

            <div class="flex flex-col gap-8 laptop:col-start-1 laptop:row-start-2">
              <VaultFormSubmit
                :disabled="reviewSwapDisabled"
                :loading="isSubmitting"
              >
                {{ reviewSwapLabel }}
              </VaultFormSubmit>
            </div>
          </div>

          <VaultFormInfoBlock
            :loading="isQuoteLoading"
            class="bg-surface-secondary p-16 rounded-16 flex flex-col gap-16 w-full laptop:max-w-[360px] shadow-card"
          >
            <div class="flex justify-between items-center">
              <p class="text-content-tertiary">
                ROE
              </p>
              <p class="text-p2">
                <template v-if="roeBefore !== null && roeAfter !== null && quote">
                  <span class="text-content-tertiary">{{ formatNumber(roeBefore) }}%</span>
                  → <span class="text-content-primary">{{ formatNumber(roeAfter) }}%</span>
                </template>
                <template v-else>
                  {{ roeBefore !== null ? `${formatNumber(roeBefore)}%` : '-' }}
                </template>
              </p>
            </div>
            <div class="flex justify-between items-start">
              <p class="text-content-tertiary shrink-0 mr-12">
                Current price
              </p>
              <p class="text-p2 text-right">
                {{ currentPrice ? `${formatNumber(currentPrice.value)} ${currentPrice.symbol}` : '-' }}
              </p>
            </div>
            <div class="flex justify-between items-center">
              <p class="text-content-tertiary">
                Liquidation price
              </p>
              <p class="text-p2">
                <template v-if="currentLiquidationPrice !== null && nextLiquidationPrice !== null && quote">
                  <span class="text-content-tertiary">{{ formatNumber(currentLiquidationPrice, 4) }}</span>
                  → <span class="text-content-primary">{{ formatNumber(nextLiquidationPrice, 4) }}</span>
                </template>
                <template v-else>
                  {{ currentLiquidationPrice !== null ? `${formatNumber(currentLiquidationPrice, 4)} ` : '-' }}
                </template>
                <span class="text-content-tertiary text-p3">
                  {{ collateralVault?.asset.symbol }}
                </span>
              </p>
            </div>
            <div class="flex justify-between items-center">
              <p class="text-content-tertiary">
                Your LTV (LLTV)
              </p>
              <p class="text-p2 text-right">
                <template v-if="currentLtv !== null && currentLiquidationLtv !== null && nextLtv !== null && nextLiquidationLtv !== null && quote">
                  <span class="text-content-tertiary">
                    {{ formatNumber(currentLtv) }}%
                    <span class="text-content-tertiary text-p3">
                      ({{ formatNumber(currentLiquidationLtv) }}%)
                    </span>
                  </span>
                  → <span class="text-content-primary">
                    {{ formatNumber(nextLtv) }}%
                    <span class="text-content-tertiary text-p3">
                      ({{ formatNumber(nextLiquidationLtv) }}%)
                    </span>
                  </span>
                </template>
                <template v-else>
                  <span v-if="currentLtv !== null && currentLiquidationLtv !== null">
                    {{ formatNumber(currentLtv) }}%
                    <span class="text-content-tertiary text-p3">
                      ({{ formatNumber(currentLiquidationLtv) }}%)
                    </span>
                  </span>
                  <span v-else>-</span>
                </template>
              </p>
            </div>
            <div class="flex justify-between items-center">
              <p class="text-content-tertiary">
                Your health
              </p>
              <p class="text-p2">
                <template v-if="currentHealth !== null && nextHealth !== null && quote">
                  <span class="text-content-tertiary">{{ formatNumber(currentHealth, 2) }}</span>
                  → <span class="text-content-primary">{{ formatNumber(nextHealth, 2) }}</span>
                </template>
                <template v-else>
                  {{ currentHealth !== null ? formatNumber(currentHealth, 2) : '-' }}
                </template>
              </p>
            </div>
            <div class="flex justify-between items-start">
              <p class="text-content-tertiary">
                Swap
              </p>
              <p class="text-p2 text-right flex flex-col items-end">
                <span>{{ swapSummary ? swapSummary.from : '-' }}</span>
                <span
                  v-if="swapSummary"
                  class="text-content-tertiary text-p3"
                >
                  {{ swapSummary.to }}
                </span>
              </p>
            </div>
            <div class="flex justify-between items-center">
              <p class="text-content-tertiary">
                Price impact
              </p>
              <p class="text-p2">
                {{ priceImpact !== null ? `${formatNumber(priceImpact, 2, 2)}%` : '-' }}
              </p>
            </div>
            <div class="flex justify-between items-center">
              <p class="text-content-tertiary">
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
                  class="!w-16 !h-16 text-accent-600"
                />
              </button>
            </div>
            <div class="flex justify-between items-center">
              <p class="text-content-tertiary">
                Routed via
              </p>
              <p class="text-p2 text-right">
                {{ routedVia || '-' }}
              </p>
            </div>
          </VaultFormInfoBlock>
        </div>
      </template>
    </VaultForm>
  </div>
</template>
