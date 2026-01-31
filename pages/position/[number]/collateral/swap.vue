<script setup lang="ts">
import { useAccount } from '@wagmi/vue'
import { ethers } from 'ethers'
import { type Address, zeroAddress } from 'viem'
import { OperationReviewModal, SlippageSettingsModal } from '#components'
import { useTermsOfUseGate } from '~/composables/useTermsOfUseGate'
import type { AccountBorrowPosition } from '~/entities/account'
import { eulerAccountLensABI } from '~/entities/euler/abis'
import {
  type Vault,
  type SecuritizeVault,
  getVaultPrice,
  getVaultPriceInfo,
  getCollateralAssetPriceFromLiability,
  isSecuritizeVault,
  fetchSecuritizeVault,
} from '~/entities/vault'
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
const { isConnected, address } = useAccount()
const { isPositionsLoaded, isPositionsLoading, getPositionBySubAccountIndex } = useEulerAccount()
const { swap: executeSwap, buildSwapPlan } = useEulerOperations()
const modal = useModal()
const { error: showError } = useToast()
const { getSubmitLabel, getSubmitDisabled, guardWithTerms } = useTermsOfUseGate()
const reviewSwapLabel = getSubmitLabel('Review Swap')
const { getOpportunityOfBorrowVault, getOpportunityOfLendVault } = useMerkl()
const { withIntrinsicBorrowApy, withIntrinsicSupplyApy } = useIntrinsicApy()
const { runSimulation, simulationError, clearSimulationError } = useTxPlanSimulation()
const { map, getVault, isReady: isVaultsReady } = useVaults()
const { eulerLensAddresses, isReady: isEulerAddressesReady, loadEulerConfig } = useEulerAddresses()
const { EVM_PROVIDER_URL } = useEulerConfig()

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
} = useSwapQuotesParallel({ amountField: 'amountOut', compare: 'max' })

const position: Ref<AccountBorrowPosition | null> = ref(null)
const selectedCollateral = ref<Vault | SecuritizeVault | null>(null)
const selectedCollateralAssets = ref(0n)
const lastCollateralAddress = ref('')

const fromVault = computed(() => selectedCollateral.value || position.value?.collateral)
const borrowVault = computed(() => position.value?.borrow)
const toVault: Ref<Vault | undefined> = ref()
// Securitize collateral cannot be swapped
const isFromSecuritize = computed(() => fromVault.value && 'type' in fromVault.value && fromVault.value.type === 'securitize')
// For swap options, we need a regular vault - securitize cannot be current vault
const fromVaultAsRegular = computed(() => {
  if (!fromVault.value || isFromSecuritize.value) return undefined
  return fromVault.value as Vault
})

const fromProduct = useEulerProductOfVault(computed(() => fromVault.value?.address || ''))
const toProduct = useEulerProductOfVault(computed(() => toVault.value?.address || ''))
const { collateralOptions, collateralVaults } = useSwapCollateralOptions({
  currentVault: fromVaultAsRegular,
  liabilityVault: computed(() => borrowVault.value as Vault | undefined),
})

const loadPosition = async () => {
  isLoading.value = true
  await until(isPositionsLoaded).toBe(true)

  position.value = getPositionBySubAccountIndex(+positionIndex) || null
  await loadSelectedCollateral()
  isLoading.value = false
}

watch([isPositionsLoaded, () => route.params.number], ([loaded]) => {
  if (loaded) {
    loadPosition()
  }
}, { immediate: true })
watch(() => route.query.collateral, async () => {
  if (!position.value) {
    return
  }
  await loadSelectedCollateral()
})

const normalizeAddress = (addr?: string) => {
  if (!addr) {
    return ''
  }
  try {
    return ethers.getAddress(addr)
  }
  catch {
    return ''
  }
}

const getSelectedCollateralAddress = () =>
  (typeof route.query.collateral === 'string' ? route.query.collateral : '')

const loadSelectedCollateral = async () => {
  if (!position.value) {
    selectedCollateral.value = null
    selectedCollateralAssets.value = 0n
    return
  }

  const primaryAddress = normalizeAddress(position.value.collateral.address)
  const targetAddress = normalizeAddress(getSelectedCollateralAddress()) || primaryAddress

  if (targetAddress !== lastCollateralAddress.value) {
    fromAmount.value = ''
    lastCollateralAddress.value = targetAddress
    resetQuoteState()
  }

  selectedCollateralAssets.value = targetAddress === primaryAddress ? position.value.supplied : 0n

  try {
    if (!isEulerAddressesReady.value) {
      await loadEulerConfig()
    }

    await until(isVaultsReady).toBe(true)

    // Try loading as regular vault first, then as securitize
    let vault: Vault | SecuritizeVault | undefined = map.value.get(targetAddress)
    if (!vault) {
      const isSecuritize = await isSecuritizeVault(targetAddress)
      if (isSecuritize) {
        vault = await fetchSecuritizeVault(targetAddress)
      }
      else {
        vault = await getVault(targetAddress)
      }
    }
    selectedCollateral.value = vault

    const lensAddress = eulerLensAddresses.value?.accountLens
    if (!lensAddress) {
      throw new Error('Account lens address is not available')
    }

    const provider = ethers.getDefaultProvider(EVM_PROVIDER_URL)
    const accountLensContract = new ethers.Contract(lensAddress, eulerAccountLensABI, provider)
    const res = await accountLensContract.getAccountInfo(position.value.subAccount, targetAddress)
    selectedCollateralAssets.value = res.vaultAccountInfo.assets
  }
  catch (e) {
    console.warn('[Collateral swap] failed to load collateral', e)
    if (!selectedCollateral.value) {
      selectedCollateral.value = position.value.collateral
    }
  }

  if (!fromAmount.value && selectedCollateral.value) {
    fromAmount.value = `${nanoToValue(selectedCollateralAssets.value || 0n, selectedCollateral.value.decimals)}`
  }
}

const getTargetAddress = () => (typeof route.query.to === 'string' ? route.query.to : '')

const syncToVault = () => {
  if (!fromVault.value) {
    return
  }
  if (!collateralVaults.value.length) {
    // Set toVault to first available or fromVault to allow form to render
    // (swap will show "no quotes" if not possible)
    if (!toVault.value && !isFromSecuritize.value) {
      toVault.value = fromVault.value as Vault
    }
    // For securitize, we can't set toVault to itself - form won't render which is fine
    // as there's nothing to swap
    return
  }

  const targetAddress = normalizeAddress(getTargetAddress())
  const currentAddress = toVault.value ? normalizeAddress(toVault.value.address) : ''
  const nextVault = collateralVaults.value.find(vault => normalizeAddress(vault.address) === targetAddress)
    || collateralVaults.value.find(vault => normalizeAddress(vault.address) === currentAddress)
    || collateralVaults.value[0]

  if (!toVault.value || normalizeAddress(toVault.value.address) !== normalizeAddress(nextVault.address)) {
    toVault.value = nextVault
  }
}

watch([collateralVaults, fromVault, () => route.query.to], () => {
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
const balance = computed(() => selectedCollateralAssets.value)

const resetQuoteState = () => {
  resetQuoteStateInternal()
  toAmount.value = ''
}

const fromOpportunity = computed(() => {
  return fromVault.value ? getOpportunityOfLendVault(fromVault.value.address) : null
})
const toOpportunity = computed(() => {
  return toVault.value ? getOpportunityOfLendVault(toVault.value.address) : null
})
const borrowOpportunity = computed(() => {
  return borrowVault.value ? getOpportunityOfBorrowVault(borrowVault.value.asset.address) : null
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
const borrowApy = computed(() => {
  if (!borrowVault.value) {
    return null
  }
  const base = nanoToValue(borrowVault.value.interestRateInfo.borrowAPY || 0n, 25)
  return withIntrinsicBorrowApy(base, borrowVault.value.asset.symbol) - (borrowOpportunity.value?.apr || 0)
})

// Get collateral USD value using liability vault's price perspective
const getCollateralValueUsd = (amount: bigint) => {
  if (!borrowVault.value || !fromVault.value) return 0
  const priceInfo = getCollateralAssetPriceFromLiability(borrowVault.value, fromVault.value)
  if (!priceInfo?.amountOutMid) return 0
  return nanoToValue(amount, fromVault.value.decimals) * nanoToValue(priceInfo.amountOutMid, 18)
}
// Price per unit for collateral (from liability vault's perspective)
const collateralPricePerUnit = computed(() => {
  if (!borrowVault.value || !fromVault.value) return undefined
  const priceInfo = getCollateralAssetPriceFromLiability(borrowVault.value, fromVault.value)
  if (!priceInfo?.amountOutMid) return undefined
  return nanoToValue(priceInfo.amountOutMid, 18)
})
const supplyValueUsd = computed(() => {
  if (!fromVault.value || !position.value || !borrowVault.value) {
    return null
  }
  return getCollateralValueUsd(selectedCollateralAssets.value)
})
const nextSupplyValueUsd = computed(() => {
  if (!quote.value || !toVault.value) {
    return null
  }
  return getVaultPrice(BigInt(quote.value.amountOut), toVault.value)
})
const borrowValueUsd = computed(() => {
  if (!borrowVault.value || !position.value) {
    return null
  }
  return getVaultPrice(position.value.borrowed, borrowVault.value)
})

const calculateRoe = (
  supplyUsd: number | null,
  borrowUsd: number | null,
  supplyApy: number | null,
  borrowApyValue: number | null,
) => {
  if (supplyUsd === null || borrowUsd === null || supplyApy === null || borrowApyValue === null) {
    return null
  }
  const equity = supplyUsd - borrowUsd
  if (!Number.isFinite(equity) || equity <= 0) {
    return null
  }
  const net = supplyUsd * supplyApy - borrowUsd * borrowApyValue
  if (!Number.isFinite(net)) {
    return null
  }
  return net / equity
}

const roeBefore = computed(() => {
  return calculateRoe(supplyValueUsd.value, borrowValueUsd.value, fromSupplyApy.value, borrowApy.value)
})
const roeAfter = computed(() => {
  return calculateRoe(nextSupplyValueUsd.value, borrowValueUsd.value, toSupplyApy.value, borrowApy.value)
})

const priceRatio = computed(() => {
  if (!toVault.value || !borrowVault.value) {
    return null
  }
  const collateralPrice = getCollateralAssetPriceFromLiability(borrowVault.value, toVault.value)
  const borrowPrice = getVaultPriceInfo(borrowVault.value)
  const ask = collateralPrice?.amountOutAsk || 0n
  const bid = borrowPrice?.amountOutBid || 0n
  if (!ask || !bid) {
    return null
  }
  return nanoToValue(ask, 18) / nanoToValue(bid, 18)
})
const nextCollateralAmount = computed(() => {
  if (!quote.value || !toVault.value) {
    return null
  }
  return nanoToValue(BigInt(quote.value.amountOut), toVault.value.decimals)
})
const borrowAmount = computed(() => {
  if (!borrowVault.value || !position.value) {
    return null
  }
  return nanoToValue(position.value.borrowed, borrowVault.value.decimals)
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
  if (!borrowVault.value || !toVault.value) {
    return null
  }
  const match = borrowVault.value.collateralLTVs.find(
    ltv => normalizeAddress(ltv.collateral) === normalizeAddress(toVault.value?.address),
  )
  return match ? nanoToValue(match.liquidationLTV, 2) : null
})
const nextLtv = computed(() => {
  if (!borrowAmount.value || !nextCollateralAmount.value || !priceRatio.value) {
    return null
  }
  if (priceRatio.value <= 0 || nextCollateralAmount.value <= 0) {
    return null
  }
  return (borrowAmount.value / (nextCollateralAmount.value * priceRatio.value)) * 100
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
  if (!quote.value || !fromVault.value || !toVault.value || !borrowVault.value) {
    return null
  }
  const amountInUsd = getCollateralValueUsd(BigInt(quote.value.amountIn))
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

const isSubmitDisabled = computed(() => {
  if (!isConnected.value) return false
  if (!fromVault.value?.asset || !toVault.value?.asset || !selectedQuote.value) {
    return true
  }
  return isLoading.value
    || isQuoteLoading.value
    || balance.value < valueToNano(fromAmount.value, fromVault.value.asset.decimals)
    || !(+fromAmount.value)
    || !toAmount.value
})
const reviewSwapDisabled = getSubmitDisabled(isSubmitDisabled)

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

  toAmount.value = ''
  const account = (position.value.subAccount || address.value || zeroAddress) as Address
  await requestQuotes({
    tokenIn: fromVault.value.asset.address as Address,
    tokenOut: toVault.value.asset.address as Address,
    accountIn: account,
    accountOut: account,
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
  clearSimulationError()
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
        enableCollateral: true,
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
      enableCollateral: true,
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
      title="Collateral swap"
      class="flex flex-col gap-16 w-full"
      :loading="isLoading || isPositionsLoading"
      @submit.prevent="submit"
    >
      <template v-if="fromVault">
        <div class="grid gap-16 laptop:grid-cols-[minmax(0,1fr)_360px] laptop:items-start">
          <div class="flex flex-col gap-16 w-full">
            <AssetInput
              v-model="fromAmount"
              :desc="fromProduct.name"
              label="From"
              :asset="fromVault.asset"
              :vault="isFromSecuritize ? undefined : (fromVault as Vault)"
              :balance="balance"
              :price-override="isFromSecuritize ? collateralPricePerUnit : undefined"
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
              v-if="toVault"
              v-model="toAmount"
              :desc="toProduct.name"
              label="To"
              :asset="toVault.asset"
              :vault="toVault"
              :collateral-options="collateralOptions"
              :readonly="true"
              @change-collateral="onToVaultChange"
            />
            <div
              v-else
              class="bg-euler-dark-400 rounded-16 p-16 text-euler-dark-900"
            >
              No collateral swap options available
            </div>

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
                :disabled="reviewSwapDisabled"
                :loading="isSubmitting"
              >
                {{ reviewSwapLabel }}
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
                  {{ currentLiquidationPrice !== null ? formatNumber(currentLiquidationPrice, 4) : '-' }}
                </template>
                <span class="text-euler-dark-900 text-p3">
                  {{ fromVault?.asset.symbol }}
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
        </div>
      </template>
    </VaultForm>
  </div>
</template>
