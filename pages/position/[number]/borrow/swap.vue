<script setup lang="ts">
import { useAccount } from '@wagmi/vue'
import { ethers } from 'ethers'
import { type Address, zeroAddress } from 'viem'
import { OperationReviewModal } from '#components'
import type { AccountBorrowPosition } from '~/entities/account'
import { type Vault, getVaultPrice, getVaultPriceInfo } from '~/entities/vault'
import { useEulerProductOfVault } from '~/composables/useEulerLabels'
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
const { borrowPositions, isPositionsLoaded, isPositionsLoading } = useEulerAccount()
const { swap: executeSwap, buildSwapPlan } = useEulerOperations()
const modal = useModal()
const { error: showError } = useToast()
const { getOpportunityOfBorrowVault, getOpportunityOfLendVault } = useMerkl()
const { withIntrinsicBorrowApy, withIntrinsicSupplyApy } = useIntrinsicApy()
const { runSimulation, simulationError, clearSimulationError } = useTxPlanSimulation()

const positionIndex = route.params.number as string

const isLoading = ref(false)
const isSubmitting = ref(false)
const plan = ref<TxPlan | null>(null)
const fromAmount = ref('')
const toAmount = ref('')
const slippage = ref(0.5)
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
  toAmount.value = amountIn > 0n
    ? ethers.formatUnits(amountIn, Number(toVault.value.decimals))
    : ''
}, { immediate: true })
const currentDebt = computed(() => position.value?.borrowed || 0n)
const balance = computed(() => currentDebt.value)

const setFromAmountToMax = () => {
  if (!fromVault.value) {
    fromAmount.value = ''
    return
  }
  fromAmount.value = `${nanoToValue(currentDebt.value, fromVault.value.decimals)}`
}

const loadPosition = async () => {
  isLoading.value = true
  await until(isPositionsLoaded).toBe(true)

  position.value = borrowPositions.value[+positionIndex - 1] || null
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
    return ethers.getAddress(address)
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

const supplyValueUsd = computed(() => {
  if (!collateralVault.value || !position.value) {
    return null
  }
  return getVaultPrice(position.value.supplied, collateralVault.value)
})
const currentBorrowValueUsd = computed(() => {
  if (!fromVault.value || !position.value) {
    return null
  }
  return getVaultPrice(position.value.borrowed, fromVault.value)
})
const nextBorrowValueUsd = computed(() => {
  if (!quote.value || !toVault.value) {
    return null
  }
  return getVaultPrice(BigInt(quote.value.amountIn), toVault.value)
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
  const collateralPrice = getVaultPriceInfo(collateralVault.value)
  const borrowPrice = getVaultPriceInfo(toVault.value)
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
  const amountOut = Number(ethers.formatUnits(BigInt(quote.value.amountOut), Number(fromVault.value.asset.decimals)))
  const amountIn = Number(ethers.formatUnits(BigInt(quote.value.amountIn), Number(toVault.value.asset.decimals)))
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
  const amountOut = ethers.formatUnits(BigInt(quote.value.amountOut), Number(fromVault.value.asset.decimals))
  const amountIn = ethers.formatUnits(BigInt(quote.value.amountIn), Number(toVault.value.asset.decimals))
  return {
    from: `${formatNumber(amountOut)} ${fromVault.value.asset.symbol}`,
    to: `${formatNumber(amountIn)} ${toVault.value.asset.symbol}`,
  }
})

const priceImpact = computed(() => {
  if (!quote.value || !fromVault.value || !toVault.value) {
    return null
  }
  const amountOutUsd = getVaultPrice(BigInt(quote.value.amountOut), fromVault.value)
  const amountInUsd = getVaultPrice(BigInt(quote.value.amountIn), toVault.value)
  if (!amountOutUsd || !amountInUsd) {
    return null
  }
  const impact = (amountInUsd / amountOutUsd - 1) * 100
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
    const amountIn = getQuoteAmount(card.quote, 'amountIn')
    const amount = formatNumber(
      ethers.formatUnits(amountIn, Number(toVault.value.decimals)),
    )
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
  return null
})

const isSubmitDisabled = computed(() => {
  if (!isConnected.value) return false
  if (!fromVault.value?.asset || !toVault.value?.asset || !selectedQuote.value) {
    return true
  }
  return isLoading.value
    || isQuoteLoading.value
    || !(+fromAmount.value)
    || !toAmount.value
    || !!errorText.value
})

const onFromInput = async () => {
  clearSimulationError()
  if (!fromVault.value || !toVault.value || !fromAmount.value) {
    toAmount.value = ''
    resetQuoteState()
    return
  }
  toAmount.value = ''
  requestQuote()
}

const requestQuote = useDebounceFn(async () => {
  quoteError.value = null

  if (!fromVault.value || !toVault.value || !fromAmount.value || !position.value) {
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
}

const send = async () => {
  if (!fromVault.value || !selectedQuote.value) {
    return
  }

  isSubmitting.value = true
  try {
    await executeSwap({
      quote: selectedQuote.value,
      swapperMode: SwapperMode.TARGET_DEBT,
      isRepay: true,
      targetDebt: 0n,
      currentDebt: 0n,
    })
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

            <UiRange
              v-model="slippage"
              label="Slippage tolerance"
              :step="0.1"
              :min="0"
              :max="50"
              :number-filter="(n: number) => `${n}%`"
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
              :collateral-options="borrowOptions"
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
                :disabled="isSubmitDisabled"
                :loading="isSubmitting"
              >
                Review Swap
              </VaultFormSubmit>
            </div>
          </div>

          <VaultFormInfoBlock
            :loading="isQuoteLoading"
            class="bg-euler-dark-400 p-16 rounded-16 flex flex-col gap-16 w-full laptop:max-w-[360px]"
          >
            <div class="flex justify-between items-center">
              <p class="text-euler-dark-900">
                ROE
              </p>
              <p class="text-p2">
                <template v-if="roeBefore !== null && roeAfter !== null && quote">
                  <span class="text-euler-dark-900">{{ formatNumber(roeBefore) }}%</span>
                  → <span class="text-white">{{ formatNumber(roeAfter) }}%</span>
                </template>
                <template v-else>
                  {{ roeBefore !== null ? `${formatNumber(roeBefore)}%` : '-' }}
                </template>
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
            <div class="flex justify-between items-center">
              <p class="text-euler-dark-900">
                Liquidation price
              </p>
              <p class="text-p2">
                <template v-if="currentLiquidationPrice !== null && nextLiquidationPrice !== null && quote">
                  <span class="text-euler-dark-900">{{ formatNumber(currentLiquidationPrice, 4) }}</span>
                  → <span class="text-white">{{ formatNumber(nextLiquidationPrice, 4) }}</span>
                </template>
                <template v-else>
                  {{ currentLiquidationPrice !== null ? `${formatNumber(currentLiquidationPrice, 4)} ` : '-' }}
                </template>
                <span class="text-euler-dark-900 text-p3">
                  {{ collateralVault?.asset.symbol }}
                </span>
              </p>
            </div>
            <div class="flex justify-between items-center">
              <p class="text-euler-dark-900">
                Your LTV (LLTV)
              </p>
              <p class="text-p2 text-right">
                <template v-if="currentLtv !== null && currentLiquidationLtv !== null && nextLtv !== null && nextLiquidationLtv !== null && quote">
                  <span class="text-euler-dark-900">
                    {{ formatNumber(currentLtv) }}%
                    <span class="text-euler-dark-900 text-p3">
                      ({{ formatNumber(currentLiquidationLtv) }}%)
                    </span>
                  </span>
                  → <span class="text-white">
                    {{ formatNumber(nextLtv) }}%
                    <span class="text-euler-dark-900 text-p3">
                      ({{ formatNumber(nextLiquidationLtv) }}%)
                    </span>
                  </span>
                </template>
                <template v-else>
                  <span v-if="currentLtv !== null && currentLiquidationLtv !== null">
                    {{ formatNumber(currentLtv) }}%
                    <span class="text-euler-dark-900 text-p3">
                      ({{ formatNumber(currentLiquidationLtv) }}%)
                    </span>
                  </span>
                  <span v-else>-</span>
                </template>
              </p>
            </div>
            <div class="flex justify-between items-center">
              <p class="text-euler-dark-900">
                Your health
              </p>
              <p class="text-p2">
                <template v-if="currentHealth !== null && nextHealth !== null && quote">
                  <span class="text-euler-dark-900">{{ formatNumber(currentHealth, 2) }}</span>
                  → <span class="text-white">{{ formatNumber(nextHealth, 2) }}</span>
                </template>
                <template v-else>
                  {{ currentHealth !== null ? formatNumber(currentHealth, 2) : '-' }}
                </template>
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
              <p class="text-p2">
                {{ formatNumber(slippage, 2, 0) }}%
              </p>
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
        </div>
      </template>
    </VaultForm>
  </div>
</template>
