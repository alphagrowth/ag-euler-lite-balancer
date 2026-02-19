import type { Ref, ComputedRef } from 'vue'
import { useAccount } from '@wagmi/vue'
import { getAddress, formatUnits, zeroAddress, type Address } from 'viem'
import { useModal } from '~/components/ui/composables/useModal'
import { OperationReviewModal } from '#components'
import { useToast } from '~/components/ui/composables/useToast'
import type { Vault } from '~/entities/vault'
import { getAssetUsdValue } from '~/services/pricing/priceProvider'
import type { AccountBorrowPosition } from '~/entities/account'
import type { TxPlan } from '~/entities/txPlan'
import { SwapperMode } from '~/entities/swap'
import { useRepaySavingsOptions } from '~/composables/useRepaySavingsOptions'
import { useSwapRepayQuotes } from '~/composables/repay/useSwapRepayQuotes'
import { useEulerProductOfVault } from '~/composables/useEulerLabels'
import { getQuoteAmount } from '~/utils/swapQuotes'
import { nanoToValue, valueToNano } from '~/utils/crypto-utils'
import { formatNumber, trimTrailingZeros } from '~/utils/string-utils'
import { calculateRoe, amountToPercent, percentToAmountNano, computeNextLtv, computeNextHealth, computeLiquidationPrice } from '~/utils/repayUtils'

interface UseSavingsRepayOptions {
  position: Ref<AccountBorrowPosition | undefined>
  borrowVault: ComputedRef<AccountBorrowPosition['borrow'] | undefined>
  collateralVault: ComputedRef<AccountBorrowPosition['collateral'] | undefined>
  formTab: Ref<string>
  plan: Ref<TxPlan | null>
  isSubmitting: Ref<boolean>
  isPreparing: Ref<boolean>
  slippage: Ref<number>
  oraclePriceRatio: ComputedRef<number | null>
  clearSimulationError: () => void
  runSimulation: (plan: TxPlan) => Promise<boolean>
  getCurrentDebt: () => bigint
  collateralSupplyApy: ComputedRef<number>
  borrowApy: ComputedRef<number>
}

const normalizeAddress = (address?: string) => {
  if (!address) return ''
  try {
    return getAddress(address)
  }
  catch {
    return ''
  }
}

export const useSavingsRepay = (options: UseSavingsRepayOptions) => {
  const {
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
  } = options

  const router = useRouter()
  const modal = useModal()
  const { error } = useToast()
  const { isConnected, address } = useAccount()
  const { buildSwapPlan, buildSavingsRepayPlan, buildSavingsFullRepayPlan, buildSwapFullRepayPlan, executeTxPlan } = useEulerOperations()
  const { refreshAllPositions } = useEulerAccount()
  const { eulerLensAddresses } = useEulerAddresses()

  // --- Savings options ---
  const { savingsPositions, savingsVaults, savingsOptions, getSavingsPosition } = useRepaySavingsOptions()

  // --- State ---
  const savingsVault: Ref<Vault | undefined> = ref()
  const savingsAmount = ref('')
  const savingsDebtAmount = ref('')
  const savingsSwapDirection = ref(SwapperMode.EXACT_IN)
  const savingsDebtPercent = ref(0)
  const savingsAssets = ref(0n)

  // --- Derived ---
  const savingsBalance = computed(() => savingsAssets.value)
  const savingsDebtBalance = computed(() => position.value?.borrowed || 0n)

  const savingsPriceInvert = usePriceInvert(
    () => savingsVault.value?.asset.symbol,
    () => borrowVault.value?.asset.symbol,
  )
  const savingsProduct = useEulerProductOfVault(computed(() => savingsVault.value?.address || ''))

  // --- Swap quotes ---
  const quotes = useSwapRepayQuotes({ direction: savingsSwapDirection })

  const savingsIsSameAsset = computed(() => {
    if (!savingsVault.value || !borrowVault.value) return false
    return normalizeAddress(savingsVault.value.asset.address) === normalizeAddress(borrowVault.value.asset.address)
  })

  const savingsSpent = computed(() => {
    if (savingsIsSameAsset.value && savingsVault.value) {
      if (savingsAmount.value) {
        try { return valueToNano(savingsAmount.value, savingsVault.value.asset.decimals) }
        catch { return null }
      }
      if (savingsDebtAmount.value && borrowVault.value) {
        try { return valueToNano(savingsDebtAmount.value, borrowVault.value.asset.decimals) }
        catch { return null }
      }
      return null
    }
    if (!quotes.quote.value) return null
    try { return BigInt(quotes.quote.value.amountIn || 0) }
    catch { return null }
  })

  const savingsDebtRepaid = computed(() => {
    if (savingsIsSameAsset.value && borrowVault.value) {
      if (savingsDebtAmount.value) {
        try { return valueToNano(savingsDebtAmount.value, borrowVault.value.asset.decimals) }
        catch { return null }
      }
      if (savingsAmount.value && savingsVault.value) {
        try { return valueToNano(savingsAmount.value, savingsVault.value.asset.decimals) }
        catch { return null }
      }
      return null
    }
    if (!quotes.quote.value) return null
    try { return BigInt(quotes.quote.value.amountOut || 0) }
    catch { return null }
  })

  // --- Async USD values ---
  let savingsValueUsdVersion = 0
  const savingsValueUsd = ref<number | null>(null)
  watchEffect(async () => {
    if (!savingsVault.value) {
      savingsValueUsd.value = null
      return
    }
    const version = ++savingsValueUsdVersion
    const result = (await getAssetUsdValue(savingsAssets.value, savingsVault.value, 'off-chain')) ?? null
    if (version === savingsValueUsdVersion) savingsValueUsd.value = result
  })

  let savingsBorrowValueUsdVersion = 0
  const savingsBorrowValueUsd = ref<number | null>(null)
  watchEffect(async () => {
    if (!borrowVault.value || !position.value) {
      savingsBorrowValueUsd.value = null
      return
    }
    const version = ++savingsBorrowValueUsdVersion
    const result = (await getAssetUsdValue(position.value.borrowed, borrowVault.value, 'off-chain')) ?? null
    if (version === savingsBorrowValueUsdVersion) savingsBorrowValueUsd.value = result
  })

  let savingsNextBorrowValueUsdVersion = 0
  const savingsNextBorrowValueUsd = ref<number | null>(null)
  watchEffect(async () => {
    if (!borrowVault.value || !position.value || savingsDebtRepaid.value === null) {
      savingsNextBorrowValueUsd.value = null
      return
    }
    const version = ++savingsNextBorrowValueUsdVersion
    const nextBorrow = position.value.borrowed - savingsDebtRepaid.value
    const result = (await getAssetUsdValue(nextBorrow > 0n ? nextBorrow : 0n, borrowVault.value, 'off-chain')) ?? null
    if (version === savingsNextBorrowValueUsdVersion) savingsNextBorrowValueUsd.value = result
  })

  let savingsCollateralUsdVersion = 0
  const savingsCollateralUsd = ref<number | null>(null)
  watchEffect(async () => {
    if (!collateralVault.value || !position.value) {
      savingsCollateralUsd.value = null
      return
    }
    const version = ++savingsCollateralUsdVersion
    const result = (await getAssetUsdValue(position.value.supplied || 0n, collateralVault.value, 'off-chain')) ?? null
    if (version === savingsCollateralUsdVersion) savingsCollateralUsd.value = result
  })

  // --- Health / LTV ---
  const savingsCurrentHealth = computed(() => {
    if (!position.value) return null
    return nanoToValue(position.value.health, 18)
  })
  const savingsCurrentLtv = computed(() => {
    if (!position.value) return null
    return nanoToValue(position.value.userLTV, 18)
  })
  const savingsCurrentLiquidationLtv = computed(() => {
    if (!position.value) return null
    return nanoToValue(position.value.liquidationLTV, 2)
  })
  const savingsBorrowAmountAfter = computed(() => {
    if (!borrowVault.value || !position.value || savingsDebtRepaid.value === null) return null
    const nextBorrow = position.value.borrowed - savingsDebtRepaid.value
    return nanoToValue(nextBorrow > 0n ? nextBorrow : 0n, borrowVault.value.decimals)
  })
  const savingsCollateralAmountAfter = computed(() => {
    if (!collateralVault.value || !position.value) return null
    return nanoToValue(position.value.supplied || 0n, collateralVault.value.decimals)
  })
  const savingsNextLtv = computed(() => {
    if (savingsBorrowAmountAfter.value === null || savingsCollateralAmountAfter.value === null || !oraclePriceRatio.value) return null
    return computeNextLtv(savingsBorrowAmountAfter.value, savingsCollateralAmountAfter.value, oraclePriceRatio.value)
  })
  const savingsNextHealth = computed(() =>
    computeNextHealth(savingsCurrentLiquidationLtv.value, savingsNextLtv.value))

  const savingsCurrentLiquidationPrice = computed(() =>
    computeLiquidationPrice(oraclePriceRatio.value, savingsCurrentHealth.value))
  const savingsNextLiquidationPrice = computed(() =>
    computeLiquidationPrice(oraclePriceRatio.value, savingsNextHealth.value))

  // --- ROE ---
  const savingsRoeBefore = computed(() =>
    calculateRoe(savingsCollateralUsd.value, savingsBorrowValueUsd.value, collateralSupplyApy.value, borrowApy.value))
  const savingsRoeAfter = computed(() =>
    calculateRoe(savingsCollateralUsd.value, savingsNextBorrowValueUsd.value, collateralSupplyApy.value, borrowApy.value))

  // --- Swap detail computeds ---
  const savingsSwapCurrentPrice = computed(() => {
    if (!quotes.quote.value || !savingsVault.value || !borrowVault.value) return null
    const amountOut = Number(formatUnits(BigInt(quotes.quote.value.amountOut), Number(borrowVault.value.asset.decimals)))
    const amountIn = Number(formatUnits(BigInt(quotes.quote.value.amountIn), Number(savingsVault.value.asset.decimals)))
    if (!amountOut || !amountIn) return null
    return {
      value: amountOut / amountIn,
      symbol: `${borrowVault.value.asset.symbol}/${savingsVault.value.asset.symbol}`,
    }
  })

  const savingsSwapSummary = computed(() => {
    if (!quotes.quote.value || !savingsVault.value || !borrowVault.value) return null
    const amountIn = formatUnits(BigInt(quotes.quote.value.amountIn), Number(savingsVault.value.asset.decimals))
    const amountOut = formatUnits(BigInt(quotes.quote.value.amountOut), Number(borrowVault.value.asset.decimals))
    return {
      from: `${formatNumber(amountIn)} ${savingsVault.value.asset.symbol}`,
      to: `${formatSignificant(amountOut)} ${borrowVault.value.asset.symbol}`,
    }
  })

  let savingsPriceImpactVersion = 0
  const savingsPriceImpact = ref<number | null>(null)
  watchEffect(async () => {
    if (!quotes.quote.value || !savingsVault.value || !borrowVault.value) {
      savingsPriceImpact.value = null
      return
    }
    const version = ++savingsPriceImpactVersion
    const [amountInUsd, amountOutUsd] = await Promise.all([
      getAssetUsdValue(BigInt(quotes.quote.value.amountIn), savingsVault.value, 'off-chain'),
      getAssetUsdValue(BigInt(quotes.quote.value.amountOut), borrowVault.value, 'off-chain'),
    ])
    if (version !== savingsPriceImpactVersion) return
    if (!amountInUsd || !amountOutUsd) {
      savingsPriceImpact.value = null
      return
    }
    const impact = (amountOutUsd / amountInUsd - 1) * 100
    savingsPriceImpact.value = Number.isFinite(impact) ? impact : null
  })

  const savingsLeveragedPriceImpact = computed(() => savingsPriceImpact.value)

  const savingsRoutedVia = computed(() => {
    if (!quotes.quote.value?.route?.length) return null
    return quotes.quote.value.route.map(route => route.providerName).join(', ')
  })

  const savingsRouteItems = computed(() => {
    if (!borrowVault.value || !savingsVault.value) return []
    const bestProvider = quotes.sortedQuoteCards.value[0]?.provider
    const isExactIn = savingsSwapDirection.value === SwapperMode.EXACT_IN
    return quotes.sortedQuoteCards.value.map((card) => {
      const amount = getQuoteAmount(card.quote, isExactIn ? 'amountOut' : 'amountIn')
      const symbol = isExactIn ? borrowVault.value!.asset.symbol : savingsVault.value!.asset.symbol
      const amountLabel = formatSignificant(
        formatUnits(amount, Number(isExactIn ? borrowVault.value!.asset.decimals : savingsVault.value!.asset.decimals)),
      )
      const diffPct = quotes.getQuoteDiffPct(card.quote)
      const badge = card.provider === bestProvider
        ? { label: 'Best', tone: 'best' as const }
        : diffPct !== null
          ? { label: `-${diffPct.toFixed(2)}%`, tone: 'worse' as const }
          : undefined
      return {
        provider: card.provider,
        amount: amountLabel,
        symbol,
        routeLabel: card.quote.route?.length
          ? `via ${card.quote.route.map(route => route.providerName).join(', ')}`
          : '-',
        badge,
      }
    })
  })

  // --- Submit disabled ---
  const isSavingsSubmitDisabled = computed(() => {
    if (!isConnected.value) return false
    if (!savingsVault.value || !borrowVault.value) return true
    if (!savingsDebtAmount.value && !savingsAmount.value) return true
    if (savingsSpent.value !== null && savingsSpent.value > savingsBalance.value) return true
    if (savingsIsSameAsset.value) return false
    if (quotes.quoteError.value) return true
    if (!quotes.selectedQuote.value) return true
    return false
  })

  const savingsDisabledReason = computed(() => {
    if (savingsSpent.value !== null && savingsSpent.value > savingsBalance.value) {
      return 'Insufficient savings balance to cover the required swap amount.'
    }
    return undefined
  })

  // --- Input handlers ---
  const onSavingsAmountInput = () => {
    clearSimulationError()
    savingsDebtAmount.value = ''
    savingsSwapDirection.value = SwapperMode.EXACT_IN
    requestSavingsQuote()
  }

  const onSavingsDebtInput = () => {
    clearSimulationError()
    savingsAmount.value = ''
    savingsSwapDirection.value = SwapperMode.TARGET_DEBT
    const currentDebt = getCurrentDebt()
    let amountNano = 0n
    try {
      amountNano = valueToNano(savingsDebtAmount.value || '0', borrowVault.value?.asset.decimals)
    }
    catch {
      amountNano = 0n
    }
    savingsDebtPercent.value = amountToPercent(amountNano, currentDebt)
    requestSavingsQuote()
  }

  const onSavingsPercentInput = () => {
    clearSimulationError()
    savingsAmount.value = ''
    savingsSwapDirection.value = SwapperMode.TARGET_DEBT
    const currentDebt = getCurrentDebt()
    if (!borrowVault.value || currentDebt <= 0n) {
      savingsDebtAmount.value = ''
      savingsDebtPercent.value = 0
      quotes.reset()
      return
    }
    const amountNano = percentToAmountNano(savingsDebtPercent.value, currentDebt)
    savingsDebtAmount.value = trimTrailingZeros(formatUnits(amountNano, Number(borrowVault.value.asset.decimals)))
    requestSavingsQuote()
  }

  const onSavingsVaultChange = (selectedIndex: number) => {
    clearSimulationError()
    const nextVault = savingsVaults.value[selectedIndex]
    if (!nextVault) return
    if (!savingsVault.value || normalizeAddress(savingsVault.value.address) !== normalizeAddress(nextVault.address)) {
      savingsVault.value = nextVault as Vault
      savingsAmount.value = ''
      savingsDebtAmount.value = ''
      quotes.reset()
    }
  }

  const onRefreshSavingsQuotes = () => {
    quotes.reset()
    const activeQuotes = savingsSwapDirection.value === SwapperMode.EXACT_IN
      ? quotes.exactInQuotes
      : quotes.targetDebtQuotes
    activeQuotes.isLoading.value = true
    requestSavingsQuote()
  }

  // --- Quote request ---
  const requestSavingsQuote = useDebounceFn(async () => {
    if (!position.value || !savingsVault.value || !borrowVault.value) {
      quotes.reset()
      return
    }

    if (savingsIsSameAsset.value) {
      const currentDebt = position.value.borrowed || 0n
      if (savingsSwapDirection.value === SwapperMode.EXACT_IN && savingsAmount.value) {
        try {
          const savingsNano = valueToNano(savingsAmount.value, savingsVault.value.asset.decimals)
          if (savingsNano > currentDebt && currentDebt > 0n) {
            savingsAmount.value = trimTrailingZeros(formatUnits(currentDebt, Number(borrowVault.value.asset.decimals)))
          }
        }
        catch { /* ignore parse errors */ }
        savingsDebtAmount.value = savingsAmount.value
      }
      if (savingsSwapDirection.value === SwapperMode.TARGET_DEBT && savingsDebtAmount.value) {
        savingsAmount.value = savingsDebtAmount.value
      }
      quotes.reset()
      return
    }

    const savingsPos = getSavingsPosition(savingsVault.value.address)
    const savingsSubAccount = (savingsPos?.subAccount || address.value || zeroAddress) as Address
    const borrowSubAccount = (position.value.subAccount || address.value || zeroAddress) as Address
    const currentDebt = position.value.borrowed || 0n

    if (savingsSwapDirection.value === SwapperMode.EXACT_IN) {
      if (!savingsAmount.value) {
        quotes.reset()
        return
      }
      let amount: bigint
      try {
        amount = valueToNano(savingsAmount.value, savingsVault.value.asset.decimals)
      }
      catch {
        quotes.reset()
        return
      }
      if (!amount || amount <= 0n) {
        quotes.reset()
        return
      }
      await quotes.exactInQuotes.requestQuotes({
        tokenIn: savingsVault.value.asset.address as Address,
        tokenOut: borrowVault.value.asset.address as Address,
        accountIn: savingsSubAccount,
        accountOut: borrowSubAccount,
        amount,
        vaultIn: savingsVault.value.address as Address,
        receiver: borrowVault.value.address as Address,
        slippage: slippage.value,
        swapperMode: SwapperMode.EXACT_IN,
        isRepay: true,
        targetDebt: 0n,
        currentDebt,
      })
      return
    }

    if (!savingsDebtAmount.value) {
      quotes.reset()
      return
    }
    let amount: bigint
    try {
      amount = valueToNano(savingsDebtAmount.value, borrowVault.value.asset.decimals)
    }
    catch {
      quotes.reset()
      return
    }
    if (!amount || amount <= 0n) {
      quotes.reset()
      return
    }
    const targetDebt = amount >= currentDebt ? 0n : currentDebt - amount
    await quotes.targetDebtQuotes.requestQuotes({
      tokenIn: savingsVault.value.asset.address as Address,
      tokenOut: borrowVault.value.asset.address as Address,
      accountIn: savingsSubAccount,
      accountOut: borrowSubAccount,
      amount,
      vaultIn: savingsVault.value.address as Address,
      receiver: borrowVault.value.address as Address,
      slippage: slippage.value,
      swapperMode: SwapperMode.TARGET_DEBT,
      isRepay: true,
      targetDebt,
      currentDebt,
    })
  }, 500)

  // --- Watchers ---
  watch([quotes.effectiveQuote, savingsSwapDirection], () => {
    if (!quotes.effectiveQuote.value || !savingsVault.value || !borrowVault.value) return
    if (savingsSwapDirection.value === SwapperMode.EXACT_IN) {
      const amountOut = BigInt(quotes.effectiveQuote.value.amountOut || 0)
      const currentDebt = position.value?.borrowed || 0n
      // If savings more than covers the debt, switch to TARGET_DEBT 100%
      if (amountOut >= currentDebt && currentDebt > 0n) {
        savingsSwapDirection.value = SwapperMode.TARGET_DEBT
        savingsDebtPercent.value = 100
        savingsDebtAmount.value = trimTrailingZeros(formatUnits(currentDebt, Number(borrowVault.value.asset.decimals)))
        requestSavingsQuote()
        return
      }
      savingsDebtAmount.value = formatSignificant(formatUnits(
        amountOut,
        Number(borrowVault.value.asset.decimals),
      ))
    }
    else {
      savingsAmount.value = formatSignificant(formatUnits(
        BigInt(quotes.effectiveQuote.value.amountIn || 0),
        Number(savingsVault.value.asset.decimals),
      ))
    }
  })

  watch([savingsVault, slippage], () => {
    clearSimulationError()
    if (savingsAmount.value || savingsDebtAmount.value) {
      requestSavingsQuote()
    }
  })

  watch(savingsVault, () => {
    updateSavingsBalance()
  })

  watch(savingsDebtAmount, () => {
    if (formTab.value !== 'savings') return
    const currentDebt = getCurrentDebt()
    if (!borrowVault.value || currentDebt <= 0n) {
      savingsDebtPercent.value = 0
      return
    }
    let amountNano = 0n
    try {
      amountNano = valueToNano(savingsDebtAmount.value || '0', borrowVault.value.asset.decimals)
    }
    catch {
      amountNano = 0n
    }
    savingsDebtPercent.value = amountToPercent(amountNano, currentDebt)
  })

  // --- Balance ---
  const updateSavingsBalance = () => {
    if (!savingsVault.value) {
      savingsAssets.value = 0n
      return
    }
    const pos = getSavingsPosition(savingsVault.value.address)
    savingsAssets.value = pos?.assets || 0n
  }

  // --- Build / Submit / Send ---
  const buildSavingsRepay = async (): Promise<TxPlan> => {
    if (!position.value || !borrowVault.value || !savingsVault.value) {
      throw new Error('Position or vaults not loaded')
    }

    const savingsPos = getSavingsPosition(savingsVault.value.address)
    if (!savingsPos) {
      throw new Error('Savings position not found')
    }

    if (savingsIsSameAsset.value) {
      const debtNano = savingsDebtAmount.value
        ? valueToNano(savingsDebtAmount.value, borrowVault.value.asset.decimals)
        : valueToNano(savingsAmount.value, savingsVault.value.asset.decimals)
      const currentDebtVal = getCurrentDebt()
      const isFullRepay = debtNano >= currentDebtVal

      if (isFullRepay) {
        return buildSavingsFullRepayPlan({
          savingsVaultAddress: savingsVault.value.address,
          borrowVaultAddress: borrowVault.value.address,
          amount: currentDebtVal,
          savingsSubAccount: savingsPos.subAccount,
          borrowSubAccount: position.value.subAccount,
          enabledCollaterals: position.value.collaterals,
        })
      }
      return buildSavingsRepayPlan({
        savingsVaultAddress: savingsVault.value.address,
        borrowVaultAddress: borrowVault.value.address,
        amount: debtNano,
        savingsSubAccount: savingsPos.subAccount,
        borrowSubAccount: position.value.subAccount,
      })
    }

    if (!quotes.selectedQuote.value) {
      throw new Error('No quote selected')
    }

    const currentDebt = getCurrentDebt()
    const swapMode = savingsSwapDirection.value
    let targetDebt = 0n
    if (swapMode === SwapperMode.TARGET_DEBT && savingsDebtAmount.value) {
      const debtAmountNano = valueToNano(savingsDebtAmount.value, borrowVault.value.asset.decimals)
      targetDebt = debtAmountNano >= currentDebt ? 0n : currentDebt - debtAmountNano
    }

    const isFullRepay = targetDebt === 0n && swapMode === SwapperMode.TARGET_DEBT
    if (isFullRepay) {
      return buildSwapFullRepayPlan({
        quote: quotes.selectedQuote.value,
        swapperMode: swapMode,
        targetDebt,
        currentDebt,
        liabilityVault: borrowVault.value.address,
        enabledCollaterals: position.value.collaterals,
        source: 'savings',
      })
    }

    return buildSwapPlan({
      quote: quotes.selectedQuote.value,
      swapperMode: swapMode,
      isRepay: true,
      targetDebt,
      currentDebt,
      liabilityVault: borrowVault.value.address,
      enabledCollaterals: position.value.collaterals,
    })
  }

  const submitSavings = async () => {
    if (isPreparing.value || isSubmitting.value || !position.value || !borrowVault.value || !savingsVault.value) return
    if (!savingsIsSameAsset.value && !quotes.selectedQuote.value) return

    isPreparing.value = true
    try {
      try {
        plan.value = await buildSavingsRepay()
      }
      catch (e) {
        console.warn('[OperationReviewModal] failed to build savings plan', e)
        plan.value = null
      }

      if (plan.value) {
        const ok = await runSimulation(plan.value)
        if (!ok) return
      }

      const transferAmounts: Record<string, string> = {}
      if (collateralVault.value && position.value?.supplied) {
        const addr = collateralVault.value.address.toLowerCase()
        transferAmounts[addr] = nanoToValue(position.value.supplied, collateralVault.value.decimals).toString()
      }

      modal.open(OperationReviewModal, {
        props: {
          type: 'repay',
          asset: savingsVault.value.asset,
          amount: savingsAmount.value,
          swapToAsset: !savingsIsSameAsset.value ? borrowVault.value.asset : undefined,
          swapToAmount: !savingsIsSameAsset.value ? savingsDebtAmount.value : undefined,
          plan: plan.value || undefined,
          subAccount: position.value?.subAccount,
          hasBorrows: (position.value?.borrowed || 0n) > 0n,
          transferAmounts,
          onConfirm: () => {
            setTimeout(() => {
              sendSavings()
            }, 400)
          },
        },
      })
    }
    finally {
      isPreparing.value = false
    }
  }

  const sendSavings = async () => {
    if (!position.value || !borrowVault.value || !savingsVault.value) return
    if (!savingsIsSameAsset.value && !quotes.selectedQuote.value) return
    try {
      isSubmitting.value = true
      const txPlan = await buildSavingsRepay()
      await executeTxPlan(txPlan)

      modal.close()
      refreshAllPositions(eulerLensAddresses.value, address.value as string)
      setTimeout(() => {
        router.replace('/portfolio')
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

  const initVault = () => {
    if (savingsVaults.value.length > 0) {
      savingsVault.value = savingsVaults.value[0] as Vault
      updateSavingsBalance()
    }
  }

  const resetOnTabSwitch = () => {
    savingsAmount.value = ''
    savingsDebtAmount.value = ''
    savingsDebtPercent.value = 0
    quotes.reset()
  }

  return {
    savingsVault,
    savingsAmount,
    savingsDebtAmount,
    savingsSwapDirection,
    savingsDebtPercent,
    savingsAssets,
    savingsBalance,
    savingsDebtBalance,
    savingsPriceInvert,
    savingsProduct,
    savingsPositions,
    savingsVaults,
    savingsOptions,
    quotes,
    savingsIsSameAsset,
    savingsSpent,
    savingsDebtRepaid,
    savingsRoeBefore,
    savingsRoeAfter,
    savingsCurrentHealth,
    savingsCurrentLtv,
    savingsNextLtv,
    savingsNextHealth,
    savingsCurrentLiquidationPrice,
    savingsNextLiquidationPrice,
    savingsSwapCurrentPrice,
    savingsSwapSummary,
    savingsPriceImpact,
    savingsLeveragedPriceImpact,
    savingsRoutedVia,
    savingsRouteItems,
    isSavingsSubmitDisabled,
    savingsDisabledReason,
    onSavingsAmountInput,
    onSavingsDebtInput,
    onSavingsPercentInput,
    onSavingsVaultChange,
    onRefreshSavingsQuotes,
    submitSavings,
    sendSavings,
    updateSavingsBalance,
    initVault,
    resetOnTabSwitch,
  }
}
