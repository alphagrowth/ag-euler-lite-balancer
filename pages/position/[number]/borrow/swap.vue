<script setup lang="ts">
import { useAccount } from '@wagmi/vue'
import { getAddress, formatUnits, isAddress, zeroAddress, type Address } from 'viem'
import { OperationReviewModal, SlippageSettingsModal } from '#components'
import { useTermsOfUseGate } from '~/composables/useTermsOfUseGate'
import type { AccountBorrowPosition } from '~/entities/account'
import { type Vault, type VaultAsset } from '~/entities/vault'
import { getAssetUsdValue, getAssetOraclePrice, getCollateralOraclePrice, conservativePriceRatioNumber } from '~/services/pricing/priceProvider'
import { useEulerProductOfVault } from '~/composables/useEulerLabels'
import { isAnyVaultBlockedByCountry, getVaultTags } from '~/composables/useGeoBlock'
import { useSwapDebtOptions } from '~/composables/useSwapDebtOptions'
import { useSwapQuotesParallel } from '~/composables/useSwapQuotesParallel'
import { SwapperMode } from '~/entities/swap'
import { getQuoteAmount } from '~/utils/swapQuotes'
import type { TxPlan } from '~/entities/txPlan'
import { useModal } from '~/components/ui/composables/useModal'
import { useToast } from '~/components/ui/composables/useToast'
import { useIntrinsicApy } from '~/composables/useIntrinsicApy'
import { formatNumber, formatSmartAmount, formatHealthScore } from '~/utils/string-utils'
import { nanoToValue } from '~/utils/crypto-utils'
import { isSameUnderlyingAsset, isSameVault as isSameVaultCheck } from '~/utils/vault-utils'

const route = useRoute()
const router = useRouter()
const { isConnected, address } = useAccount()
const { isPositionsLoaded, isPositionsLoading, getPositionBySubAccountIndex } = useEulerAccount()
const { buildSwapPlan, buildSameAssetDebtSwapPlan, executeTxPlan } = useEulerOperations()
const modal = useModal()
const { error: showError } = useToast()
const { getSubmitLabel, getSubmitDisabled, guardWithTerms } = useTermsOfUseGate()
const reviewSwapLabel = getSubmitLabel(computed(() => {
  if (isSameAsset.value) return 'Review Transfer'
  return selectedQuote.value ? 'Review Swap' : 'Select a Quote'
}))
const { withIntrinsicBorrowApy, withIntrinsicSupplyApy } = useIntrinsicApy()
const { getSupplyRewardApy, getBorrowRewardApy } = useRewardsApy()
const { runSimulation, simulationError, clearSimulationError } = useTxPlanSimulation()
const openSlippageSettings = () => {
  modal.open(SlippageSettingsModal)
}

const swapPriceInvert = usePriceInvert(
  () => fromVault.value?.asset.symbol,
  () => toVault.value?.asset.symbol,
)
const liqPriceInvert = usePriceInvert(
  () => collateralVault.value?.asset.symbol,
  () => toVault.value?.asset.symbol,
)
const currentLiqDisplaySymbol = computed(() => {
  const a = collateralVault.value?.asset.symbol || ''
  const b = fromVault.value?.asset.symbol || ''
  return liqPriceInvert.isInverted ? `${b}/${a}` : `${a}/${b}`
})

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
  if (isSameUnderlyingAsset(fromVault.value, toVault.value)) return
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
  const exact = formatUnits(currentDebt.value, Number(fromVault.value.decimals))
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
    || borrowVaults.value.find(v => !getVaultTags(v.address, 'swap-target').disabled)
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

const collateralSupplyApy = computed(() => {
  if (!collateralVault.value) {
    return null
  }
  const base = nanoToValue(collateralVault.value.interestRateInfo.supplyAPY || 0n, 25)
  return withIntrinsicSupplyApy(base, collateralVault.value.asset.symbol) + getSupplyRewardApy(collateralVault.value.address)
})
const fromBorrowApy = computed(() => {
  if (!fromVault.value) {
    return null
  }
  const base = nanoToValue(fromVault.value.interestRateInfo.borrowAPY || 0n, 25)
  return withIntrinsicBorrowApy(base, fromVault.value.asset.symbol) - getBorrowRewardApy(fromVault.value.asset.address, fromVault.value.address)
})
const toBorrowApy = computed(() => {
  if (!toVault.value) {
    return null
  }
  const base = nanoToValue(toVault.value.interestRateInfo.borrowAPY || 0n, 25)
  return withIntrinsicBorrowApy(base, toVault.value.asset.symbol) - getBorrowRewardApy(toVault.value.asset.address, toVault.value.address)
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
  return conservativePriceRatioNumber(collateralPrice, borrowPrice)
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
const currentPriceRatio = computed(() => {
  if (!collateralVault.value || !fromVault.value) {
    return null
  }
  const collateralPrice = getCollateralOraclePrice(fromVault.value, collateralVault.value)
  const borrowPrice = getAssetOraclePrice(fromVault.value)
  return conservativePriceRatioNumber(collateralPrice, borrowPrice)
})
const currentLiquidationPrice = computed(() => {
  if (!currentPriceRatio.value || !currentHealth.value) {
    return null
  }
  if (currentHealth.value <= 0) {
    return null
  }
  return currentPriceRatio.value / currentHealth.value
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
    from: `${formatSignificant(amountOut)} ${fromVault.value.asset.symbol}`,
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
    const amount = formatSmallAmount(amountIn, Number(toVault.value!.decimals))
    const diffPct = getQuoteDiffPct(card.quote)
    const badge = card.provider === bestProvider
      ? { label: 'Best', tone: 'best' as const }
      : diffPct !== null
        ? { label: `+${diffPct.toFixed(2)}%`, tone: 'worse' as const }
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
const isSameVault = computed(() => isSameVaultCheck(fromVault.value, toVault.value))
const isSameAsset = computed(() => {
  if (isSameVault.value) return false
  return isSameUnderlyingAsset(fromVault.value, toVault.value)
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
  if (!fromVault.value?.asset || !toVault.value?.asset) return true
  if (isSameAsset.value) {
    return isLoading.value || !(+fromAmount.value) || !!errorText.value || isSameVault.value
  }
  if (!selectedQuote.value) return true
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

watch([isSameAsset, fromAmount], ([same, from]) => {
  if (same && from) {
    toAmount.value = from
  }
})

const onFromInput = async () => {
  clearSimulationError()
  if (!fromVault.value || !toVault.value || !fromAmount.value || isSameVault.value) {
    toAmount.value = ''
    resetQuoteState()
    return
  }
  if (isSameAsset.value) {
    resetQuoteStateInternal()
    return
  }
  toAmount.value = ''
  requestQuote()
}

const requestQuote = useDebounceFn(async () => {
  quoteError.value = null

  if (!fromVault.value || !toVault.value || !fromAmount.value || !position.value || isSameVault.value || isSameAsset.value) {
    resetQuoteStateInternal()
    if (!isSameAsset.value) toAmount.value = ''
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
    currentDebt: currentDebt.value,
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
  if (!toVault.value || isSameVault.value) {
    toAmount.value = ''
    resetQuoteState()
    return
  }
  if (isSameAsset.value) {
    resetQuoteStateInternal()
    toAmount.value = fromAmount.value || ''
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

const buildDebtSwapPlan = async (): Promise<TxPlan | null> => {
  if (!fromVault.value || !toVault.value) return null

  if (isSameAsset.value) {
    const amount = valueToNano(fromAmount.value, fromVault.value.asset.decimals)
    return buildSameAssetDebtSwapPlan({
      oldVaultAddress: fromVault.value.address,
      newVaultAddress: toVault.value.address,
      amount,
      subAccount: position.value?.subAccount || address.value!,
      enabledCollaterals: position.value?.collaterals,
    })
  }

  if (!selectedQuote.value) return null
  return buildSwapPlan({
    quote: selectedQuote.value,
    swapperMode: SwapperMode.TARGET_DEBT,
    isRepay: true,
    targetDebt: 0n,
    currentDebt: currentDebt.value,
    liabilityVault: fromVault.value?.address,
    enabledCollaterals: position.value?.collaterals,
  })
}

const submit = async () => {
  if (isGeoBlocked.value) return
  await guardWithTerms(async () => {
    if (isSubmitting.value || !fromVault.value || !toVault.value) return

    try {
      plan.value = await buildDebtSwapPlan()
    }
    catch (e) {
      showError('Failed to build transaction')
      plan.value = null
      return
    }

    if (plan.value) {
      const ok = await runSimulation(plan.value)
      if (!ok) return
    }

    modal.open(OperationReviewModal, {
      props: {
        type: 'swap',
        asset: fromVault.value.asset,
        amount: fromAmount.value,
        // Same-asset: omit swapToAsset/swapToAmount so skim steps show "remaining" instead of amounts
        swapToAsset: isSameAsset.value ? undefined : toVault.value?.asset,
        swapToAmount: isSameAsset.value ? undefined : toAmount.value,
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
  if (!fromVault.value || !toVault.value) return

  isSubmitting.value = true
  try {
    const txPlan = await buildDebtSwapPlan()
    if (!txPlan) return
    await executeTxPlan(txPlan)
    modal.close()
    setTimeout(() => {
      router.replace('/portfolio')
    }, 400)
  }
  catch (e) {
    showError('Transaction failed')
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
        <VaultLabelsAndAssets
          :vault="fromVault"
          :assets="[fromVault.asset] as VaultAsset[]"
          size="large"
        />
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
              class="opacity-60 pointer-events-none"
            />

            <UiToast
              title="Full amount required"
              description="The entire debt amount must be swapped at once. Only one debt is allowed per sub-account."
              variant="info"
              size="compact"
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
              v-model="toAmount"
              :desc="toProduct.name"
              label="To"
              :asset="toVault.asset"
              :vault="toVault"
              :collateral-options="borrowOptions"
              collateral-modal-title="Select debt"
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
              v-if="quoteError && !isSameAsset"
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
            :loading="!isSameAsset && isQuoteLoading"
            variant="card"
            class="w-full laptop:max-w-[360px]"
          >
            <SummaryRow label="ROE">
              <SummaryValue
                :before="roeBefore !== null ? formatNumber(roeBefore) : undefined"
                :after="roeAfter !== null && quote ? formatNumber(roeAfter) : undefined"
                suffix="%"
              />
            </SummaryRow>
            <SummaryRow v-if="!isSameAsset" label="Swap price" align-top>
              <SummaryPriceValue
                :value="currentPrice ? formatSmartAmount(swapPriceInvert.invertValue(currentPrice.value)) : undefined"
                :symbol="swapPriceInvert.displaySymbol"
                invertible
                @invert="swapPriceInvert.toggle"
              />
            </SummaryRow>
            <SummaryRow label="Liquidation price" align-top>
              <!-- Borrow swap changes the borrow vault, so before/after symbols may differ -->
              <p class="text-p2 text-right inline-flex items-center flex-wrap justify-end gap-x-4">
                <template v-if="currentLiquidationPrice !== null && nextLiquidationPrice !== null && quote">
                  <span class="text-content-tertiary">{{ formatSmartAmount(liqPriceInvert.invertValue(currentLiquidationPrice)) }}<span class="text-p3 ml-2">{{ currentLiqDisplaySymbol }}</span></span>
                  &rarr; <span class="text-content-primary">{{ formatSmartAmount(liqPriceInvert.invertValue(nextLiquidationPrice)) }}<span class="text-content-tertiary text-p3 ml-2">{{ liqPriceInvert.displaySymbol }}</span></span>
                </template>
                <template v-else>
                  {{ liqPriceInvert.invertValue(currentLiquidationPrice) != null ? formatSmartAmount(liqPriceInvert.invertValue(currentLiquidationPrice)!) : '-' }}
                  <span v-if="liqPriceInvert.invertValue(currentLiquidationPrice) != null" class="text-content-tertiary text-p3">{{ currentLiqDisplaySymbol }}</span>
                </template>
                <button type="button" class="text-content-tertiary hover:text-content-primary transition-colors inline-flex" @click.stop="liqPriceInvert.toggle">
                  <SvgIcon name="swap-horizontal" class="!w-12 !h-12" />
                </button>
              </p>
            </SummaryRow>
            <SummaryRow label="LTV">
              <SummaryValue
                :before="currentLtv !== null ? formatNumber(currentLtv) : undefined"
                :after="nextLtv !== null && quote ? formatNumber(nextLtv) : undefined"
                suffix="%"
              />
            </SummaryRow>
            <SummaryRow label="Health score">
              <SummaryValue
                :before="currentHealth !== null ? formatHealthScore(currentHealth) : undefined"
                :after="nextHealth !== null && quote ? formatHealthScore(nextHealth) : undefined"
              />
            </SummaryRow>
            <template v-if="!isSameAsset">
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
          </VaultFormInfoBlock>
        </div>
      </template>
    </VaultForm>
  </div>
</template>
