import type { Ref, ComputedRef } from 'vue'
import { useAccount } from '@wagmi/vue'
import { getAddress, formatUnits, zeroAddress, type Address, type Abi } from 'viem'
import { useModal } from '~/components/ui/composables/useModal'
import { OperationReviewModal } from '#components'
import { useToast } from '~/components/ui/composables/useToast'
import type { Vault } from '~/entities/vault'
import { getAssetUsdValue, getAssetOraclePrice, conservativePriceRatioNumber } from '~/services/pricing/priceProvider'
import type { AccountBorrowPosition } from '~/entities/account'
import type { TxPlan } from '~/entities/txPlan'
import { SwapperMode } from '~/entities/swap'
import { eulerAccountLensABI } from '~/entities/euler/abis'
import { useSwapCollateralOptions } from '~/composables/useSwapCollateralOptions'
import { useSwapRepayQuotes } from '~/composables/repay/useSwapRepayQuotes'
import { useEulerProductOfVault } from '~/composables/useEulerLabels'
import { getPublicClient } from '~/utils/public-client'
import { getQuoteAmount } from '~/utils/swapQuotes'
import { nanoToValue, valueToNano } from '~/utils/crypto-utils'
import { formatNumber, formatSmartAmount, trimTrailingZeros } from '~/utils/string-utils'
import { calculateRoe, amountToPercent, percentToAmountNano, computeNextLtv, computeNextHealth, computeLiquidationPrice } from '~/utils/repayUtils'

interface UseCollateralSwapRepayOptions {
  position: Ref<AccountBorrowPosition | undefined>
  borrowVault: ComputedRef<AccountBorrowPosition['borrow'] | undefined>
  collateralVault: ComputedRef<AccountBorrowPosition['collateral'] | undefined>
  formTab: Ref<string>
  plan: Ref<TxPlan | null>
  isSubmitting: Ref<boolean>
  isPreparing: Ref<boolean>
  slippage: Ref<number>
  clearSimulationError: () => void
  runSimulation: (plan: TxPlan) => Promise<boolean>
  getCurrentDebt: () => bigint
  isEligibleForLiquidation: ComputedRef<boolean>
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

export const useCollateralSwapRepay = (options: UseCollateralSwapRepayOptions) => {
  const {
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
  } = options

  const router = useRouter()
  const modal = useModal()
  const { error } = useToast()
  const { isConnected, address } = useAccount()
  const { buildSwapPlan, buildSameAssetRepayPlan, buildSameAssetFullRepayPlan, buildSwapFullRepayPlan, executeTxPlan } = useEulerOperations()
  const { refreshAllPositions } = useEulerAccount()
  const { eulerLensAddresses, isReady: isEulerAddressesReady, loadEulerConfig } = useEulerAddresses()
  const { EVM_PROVIDER_URL } = useEulerConfig()
  const { withIntrinsicSupplyApy, withIntrinsicBorrowApy } = useIntrinsicApy()
  const { getSupplyRewardApy, getBorrowRewardApy } = useRewardsApy()

  // --- State ---
  const collateralAmount = ref('')
  const debtAmount = ref('')
  const repaySwapDirection = ref(SwapperMode.EXACT_IN)
  const repayDebtPercent = ref(0)
  const swapCollateralVault: Ref<Vault | undefined> = ref()
  const swapCollateralAssets = ref(0n)

  // --- Derived ---
  const swapCollateralBalance = computed(() => swapCollateralAssets.value)
  const swapDebtBalance = computed(() => position.value?.borrowed || 0n)

  const swapPriceInvert = usePriceInvert(
    () => swapCollateralVault.value?.asset.symbol,
    () => borrowVault.value?.asset.symbol,
  )
  const swapCollateralProduct = useEulerProductOfVault(computed(() => swapCollateralVault.value?.address || ''))

  // --- Collateral options ---
  const { collateralOptions: swapCollateralOptions, collateralVaults: swapCollateralVaults } = useSwapCollateralOptions({
    currentVault: computed(() => undefined),
    liabilityVault: computed(() => borrowVault.value as typeof borrowVault.value),
    tagContext: 'supply-source',
  })

  const repayCollateralVaults = computed(() => {
    if (!position.value) return []
    const allowed = position.value.collaterals?.length
      ? new Set(position.value.collaterals.map(addr => normalizeAddress(addr)))
      : null
    const candidates = swapCollateralVaults.value
    const filtered = allowed
      ? candidates.filter(vault => allowed.has(normalizeAddress(vault.address)))
      : candidates
    if (!filtered.length && collateralVault.value) {
      return [collateralVault.value]
    }
    return filtered
  })

  const repayCollateralOptions = computed(() => {
    const allowed = new Set(repayCollateralVaults.value.map(vault => normalizeAddress(vault.address)))
    return swapCollateralOptions.value.filter(option => allowed.has(normalizeAddress(option.vaultAddress)))
  })

  // --- Swap quotes ---
  const quotes = useSwapRepayQuotes({ direction: repaySwapDirection })

  const swapIsSameAsset = computed(() => {
    if (!swapCollateralVault.value || !borrowVault.value) return false
    return normalizeAddress(swapCollateralVault.value.asset.address) === normalizeAddress(borrowVault.value.asset.address)
  })

  const swapCollateralSpent = computed(() => {
    if (swapIsSameAsset.value && swapCollateralVault.value) {
      if (collateralAmount.value) {
        try { return valueToNano(collateralAmount.value, swapCollateralVault.value.asset.decimals) }
        catch { return null }
      }
      if (debtAmount.value && borrowVault.value) {
        try { return valueToNano(debtAmount.value, borrowVault.value.asset.decimals) }
        catch { return null }
      }
      return null
    }
    if (!quotes.quote.value) return null
    try { return BigInt(quotes.quote.value.amountIn || 0) }
    catch { return null }
  })

  const swapDebtRepaid = computed(() => {
    if (swapIsSameAsset.value && borrowVault.value) {
      if (debtAmount.value) {
        try { return valueToNano(debtAmount.value, borrowVault.value.asset.decimals) }
        catch { return null }
      }
      if (collateralAmount.value && swapCollateralVault.value) {
        try { return valueToNano(collateralAmount.value, swapCollateralVault.value.asset.decimals) }
        catch { return null }
      }
      return null
    }
    if (!quotes.quote.value) return null
    try { return BigInt(quotes.quote.value.amountOut || 0) }
    catch { return null }
  })

  // --- Async USD values ---
  let swapCollateralValueUsdVersion = 0
  const swapCollateralValueUsd = ref<number | null>(null)

  watchEffect(async () => {
    if (!swapCollateralVault.value) {
      swapCollateralValueUsd.value = null
      return
    }
    const version = ++swapCollateralValueUsdVersion
    const result = (await getAssetUsdValue(swapCollateralAssets.value, swapCollateralVault.value, 'off-chain')) ?? null
    if (version === swapCollateralValueUsdVersion) swapCollateralValueUsd.value = result
  })

  let swapBorrowValueUsdVersion = 0
  const swapBorrowValueUsd = ref<number | null>(null)

  watchEffect(async () => {
    if (!borrowVault.value || !position.value) {
      swapBorrowValueUsd.value = null
      return
    }
    const version = ++swapBorrowValueUsdVersion
    const result = (await getAssetUsdValue(position.value.borrowed, borrowVault.value, 'off-chain')) ?? null
    if (version === swapBorrowValueUsdVersion) swapBorrowValueUsd.value = result
  })

  let swapNextCollateralValueUsdVersion = 0
  const swapNextCollateralValueUsd = ref<number | null>(null)

  watchEffect(async () => {
    if (!swapCollateralVault.value || swapCollateralSpent.value === null) {
      swapNextCollateralValueUsd.value = null
      return
    }
    const version = ++swapNextCollateralValueUsdVersion
    const nextAssets = swapCollateralAssets.value - swapCollateralSpent.value
    const result = (await getAssetUsdValue(nextAssets > 0n ? nextAssets : 0n, swapCollateralVault.value, 'off-chain')) ?? null
    if (version === swapNextCollateralValueUsdVersion) swapNextCollateralValueUsd.value = result
  })

  let swapNextBorrowValueUsdVersion = 0
  const swapNextBorrowValueUsd = ref<number | null>(null)

  watchEffect(async () => {
    if (!borrowVault.value || !position.value || swapDebtRepaid.value === null) {
      swapNextBorrowValueUsd.value = null
      return
    }
    const version = ++swapNextBorrowValueUsdVersion
    const nextBorrow = position.value.borrowed - swapDebtRepaid.value
    const result = (await getAssetUsdValue(nextBorrow > 0n ? nextBorrow : 0n, borrowVault.value, 'off-chain')) ?? null
    if (version === swapNextBorrowValueUsdVersion) swapNextBorrowValueUsd.value = result
  })

  // --- APYs ---
  const swapCollateralSupplyApy = computed(() => {
    if (!swapCollateralVault.value) return null
    const base = nanoToValue(swapCollateralVault.value.interestRateInfo.supplyAPY || 0n, 25)
    return withIntrinsicSupplyApy(base, swapCollateralVault.value.asset.address) + getSupplyRewardApy(swapCollateralVault.value.address)
  })

  const swapBorrowApy = computed(() => {
    if (!borrowVault.value) return null
    const base = nanoToValue(borrowVault.value.interestRateInfo.borrowAPY || 0n, 25)
    return withIntrinsicBorrowApy(base, borrowVault.value.asset.address) - getBorrowRewardApy(borrowVault.value.address, collateralVault.value?.address)
  })

  // --- ROE ---
  const swapRoeBefore = computed(() =>
    calculateRoe(swapCollateralValueUsd.value, swapBorrowValueUsd.value, swapCollateralSupplyApy.value, swapBorrowApy.value))
  const swapRoeAfter = computed(() =>
    calculateRoe(swapNextCollateralValueUsd.value, swapNextBorrowValueUsd.value, swapCollateralSupplyApy.value, swapBorrowApy.value))

  // --- Price ratio / Health / LTV ---
  const swapPriceRatio = computed(() => {
    if (!swapCollateralVault.value || !borrowVault.value) return null
    const collateralPrice = getAssetOraclePrice(swapCollateralVault.value)
    const borrowPrice = getAssetOraclePrice(borrowVault.value)
    return conservativePriceRatioNumber(collateralPrice, borrowPrice)
  })

  const swapCollateralAmountAfter = computed(() => {
    if (!swapCollateralVault.value || swapCollateralSpent.value === null) return null
    const nextAssets = swapCollateralAssets.value - swapCollateralSpent.value
    return nanoToValue(nextAssets > 0n ? nextAssets : 0n, swapCollateralVault.value.decimals)
  })

  const swapBorrowAmountAfter = computed(() => {
    if (!borrowVault.value || !position.value || swapDebtRepaid.value === null) return null
    const nextBorrow = position.value.borrowed - swapDebtRepaid.value
    return nanoToValue(nextBorrow > 0n ? nextBorrow : 0n, borrowVault.value.decimals)
  })

  const swapCurrentLtv = computed(() => {
    if (!position.value) return null
    return nanoToValue(position.value.userLTV, 18)
  })

  const swapCurrentLiquidationLtv = computed(() => {
    if (!position.value) return null
    return nanoToValue(position.value.liquidationLTV, 2)
  })

  const swapNextLiquidationLtv = computed(() => {
    if (!borrowVault.value || !swapCollateralVault.value) return null
    const match = borrowVault.value.collateralLTVs.find(
      ltv => normalizeAddress(ltv.collateral) === normalizeAddress(swapCollateralVault.value?.address),
    )
    if (match) return nanoToValue(match.liquidationLTV, 2)
    return swapCurrentLiquidationLtv.value
  })

  const swapNextLtv = computed(() => {
    if (swapBorrowAmountAfter.value === null || swapCollateralAmountAfter.value === null || !swapPriceRatio.value) return null
    return computeNextLtv(swapBorrowAmountAfter.value, swapCollateralAmountAfter.value, swapPriceRatio.value)
  })

  const swapCurrentHealth = computed(() => {
    if (!position.value) return null
    return nanoToValue(position.value.health, 18)
  })

  const swapNextHealth = computed(() =>
    computeNextHealth(swapNextLiquidationLtv.value, swapNextLtv.value))

  const isSwapHealthInsufficient = computed(() => {
    if (!isEligibleForLiquidation.value) return false
    if (swapNextHealth.value === null) return false
    return swapNextHealth.value < 1
  })

  const swapCurrentLiquidationPrice = computed(() =>
    computeLiquidationPrice(swapPriceRatio.value, swapCurrentHealth.value))

  const swapNextLiquidationPrice = computed(() =>
    computeLiquidationPrice(swapPriceRatio.value, swapNextHealth.value))

  // --- Swap detail computeds ---
  const swapCurrentPrice = computed(() => {
    if (!quotes.quote.value || !swapCollateralVault.value || !borrowVault.value) return null
    const amountOut = Number(formatUnits(BigInt(quotes.quote.value.amountOut), Number(borrowVault.value.asset.decimals)))
    const amountIn = Number(formatUnits(BigInt(quotes.quote.value.amountIn), Number(swapCollateralVault.value.asset.decimals)))
    if (!amountOut || !amountIn) return null
    return {
      value: amountOut / amountIn,
      symbol: `${borrowVault.value.asset.symbol}/${swapCollateralVault.value.asset.symbol}`,
    }
  })

  const swapSummary = computed(() => {
    if (!quotes.quote.value || !swapCollateralVault.value || !borrowVault.value) return null
    const amountIn = formatUnits(BigInt(quotes.quote.value.amountIn), Number(swapCollateralVault.value.asset.decimals))
    const amountOut = formatUnits(BigInt(quotes.quote.value.amountOut), Number(borrowVault.value.asset.decimals))
    return {
      from: `${formatNumber(amountIn)} ${swapCollateralVault.value.asset.symbol}`,
      to: `${formatSignificant(amountOut)} ${borrowVault.value.asset.symbol}`,
    }
  })

  let swapPriceImpactVersion = 0
  const swapPriceImpact = ref<number | null>(null)

  watchEffect(async () => {
    if (!quotes.quote.value || !swapCollateralVault.value || !borrowVault.value) {
      swapPriceImpact.value = null
      return
    }
    const version = ++swapPriceImpactVersion
    const [amountInUsd, amountOutUsd] = await Promise.all([
      getAssetUsdValue(BigInt(quotes.quote.value.amountIn), swapCollateralVault.value, 'off-chain'),
      getAssetUsdValue(BigInt(quotes.quote.value.amountOut), borrowVault.value, 'off-chain'),
    ])
    if (version !== swapPriceImpactVersion) return
    if (!amountInUsd || !amountOutUsd) {
      swapPriceImpact.value = null
      return
    }
    const impact = (amountOutUsd / amountInUsd - 1) * 100
    swapPriceImpact.value = Number.isFinite(impact) ? impact : null
  })

  const swapLeveragedPriceImpact = computed(() => swapPriceImpact.value)

  const swapRoutedVia = computed(() => {
    if (!quotes.quote.value?.route?.length) return null
    return quotes.quote.value.route.map(route => route.providerName).join(', ')
  })

  const swapRouteEmptyMessage = computed(() => {
    if (!quotes.providersCount.value) return 'Enter amount to fetch quotes'
    return 'No quotes found'
  })

  const swapRouteItems = computed(() => {
    if (!borrowVault.value || !swapCollateralVault.value) return []
    const bestProvider = quotes.sortedQuoteCards.value[0]?.provider
    const isExactIn = repaySwapDirection.value === SwapperMode.EXACT_IN
    return quotes.sortedQuoteCards.value.map((card) => {
      const amount = getQuoteAmount(card.quote, isExactIn ? 'amountOut' : 'amountIn')
      const symbol = isExactIn ? borrowVault.value!.asset.symbol : swapCollateralVault.value!.asset.symbol
      const amountLabel = formatSignificant(
        formatUnits(amount, Number(isExactIn ? borrowVault.value!.asset.decimals : swapCollateralVault.value!.asset.decimals)),
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
  const isSwapSubmitDisabled = computed(() => {
    if (!isConnected.value) return false
    if (!swapCollateralVault.value || !borrowVault.value) return true
    if (!debtAmount.value && !collateralAmount.value) return true
    if (swapIsSameAsset.value) {
      if (isSwapHealthInsufficient.value) return true
      return false
    }
    if (quotes.quoteError.value) return true
    if (!quotes.selectedQuote.value) return true
    if (isSwapHealthInsufficient.value) return true
    return false
  })

  const swapDisabledReason = computed(() => {
    if (isSwapHealthInsufficient.value) {
      return 'This swap will not restore account health. Repay the full debt from your wallet instead.'
    }
    return undefined
  })

  // --- Input handlers ---
  const onCollateralInput = () => {
    clearSimulationError()
    debtAmount.value = ''
    repaySwapDirection.value = SwapperMode.EXACT_IN
    requestSwapQuote()
  }

  const onDebtInput = () => {
    clearSimulationError()
    collateralAmount.value = ''
    repaySwapDirection.value = SwapperMode.TARGET_DEBT
    const currentDebt = getCurrentDebt()
    let amountNano = 0n
    try {
      amountNano = valueToNano(debtAmount.value || '0', borrowVault.value?.asset.decimals)
    }
    catch {
      amountNano = 0n
    }
    repayDebtPercent.value = amountToPercent(amountNano, currentDebt)
    requestSwapQuote()
  }

  const onRepayPercentInput = () => {
    clearSimulationError()
    collateralAmount.value = ''
    repaySwapDirection.value = SwapperMode.TARGET_DEBT
    const currentDebt = getCurrentDebt()
    if (!borrowVault.value || currentDebt <= 0n) {
      debtAmount.value = ''
      repayDebtPercent.value = 0
      quotes.reset()
      return
    }
    const amountNano = percentToAmountNano(repayDebtPercent.value, currentDebt)
    debtAmount.value = trimTrailingZeros(formatUnits(amountNano, Number(borrowVault.value.asset.decimals)))
    requestSwapQuote()
  }

  const onSwapCollateralChange = (selectedIndex: number) => {
    clearSimulationError()
    const nextVault = repayCollateralVaults.value[selectedIndex]
    if (!nextVault) return
    if (!swapCollateralVault.value || normalizeAddress(swapCollateralVault.value.address) !== normalizeAddress(nextVault.address)) {
      swapCollateralVault.value = nextVault as Vault
      collateralAmount.value = ''
      debtAmount.value = ''
      quotes.reset()
    }
  }

  const onRefreshSwapQuotes = () => {
    quotes.reset()
    const activeQuotes = repaySwapDirection.value === SwapperMode.EXACT_IN
      ? quotes.exactInQuotes
      : quotes.targetDebtQuotes
    activeQuotes.isLoading.value = true
    requestSwapQuote()
  }

  // --- Quote request ---
  const requestSwapQuote = useDebounceFn(async () => {
    if (!position.value || !swapCollateralVault.value || !borrowVault.value) {
      quotes.reset()
      return
    }

    if (swapIsSameAsset.value) {
      const currentDebt = position.value.borrowed || 0n
      if (repaySwapDirection.value === SwapperMode.EXACT_IN && collateralAmount.value) {
        try {
          const collateralNano = valueToNano(collateralAmount.value, swapCollateralVault.value.asset.decimals)
          if (collateralNano > currentDebt && currentDebt > 0n) {
            collateralAmount.value = trimTrailingZeros(formatUnits(currentDebt, Number(borrowVault.value.asset.decimals)))
          }
        }
        catch { /* ignore parse errors */ }
        debtAmount.value = collateralAmount.value
      }
      if (repaySwapDirection.value === SwapperMode.TARGET_DEBT && debtAmount.value) {
        collateralAmount.value = debtAmount.value
      }
      quotes.reset()
      return
    }

    const currentDebt = position.value.borrowed || 0n
    const subAccount = (position.value.subAccount || address.value || zeroAddress) as Address
    const accountIn = subAccount
    const accountOut = subAccount

    if (repaySwapDirection.value === SwapperMode.EXACT_IN) {
      if (!collateralAmount.value) {
        quotes.reset()
        return
      }
      let amount: bigint
      try {
        amount = valueToNano(collateralAmount.value, swapCollateralVault.value.asset.decimals)
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
        tokenIn: swapCollateralVault.value.asset.address as Address,
        tokenOut: borrowVault.value.asset.address as Address,
        accountIn,
        accountOut,
        amount,
        vaultIn: swapCollateralVault.value.address as Address,
        receiver: borrowVault.value.address as Address,
        slippage: slippage.value,
        swapperMode: SwapperMode.EXACT_IN,
        isRepay: true,
        targetDebt: 0n,
        currentDebt,
      })
      return
    }

    if (!debtAmount.value) {
      quotes.reset()
      return
    }
    let amount: bigint
    try {
      amount = valueToNano(debtAmount.value, borrowVault.value.asset.decimals)
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
      tokenIn: swapCollateralVault.value.asset.address as Address,
      tokenOut: borrowVault.value.asset.address as Address,
      accountIn,
      accountOut,
      amount,
      vaultIn: swapCollateralVault.value.address as Address,
      receiver: borrowVault.value.address as Address,
      slippage: slippage.value,
      swapperMode: SwapperMode.TARGET_DEBT,
      isRepay: true,
      targetDebt,
      currentDebt,
    })
  }, 500)

  // --- Balance ---
  const updateSwapCollateralBalance = async () => {
    if (!position.value || !swapCollateralVault.value) {
      swapCollateralAssets.value = 0n
      return
    }
    const primaryAddress = normalizeAddress(position.value.collateral.address)
    const targetAddress = normalizeAddress(swapCollateralVault.value.address)
    swapCollateralAssets.value = targetAddress === primaryAddress ? (position.value.supplied || 0n) : 0n

    try {
      if (!isEulerAddressesReady.value) {
        await loadEulerConfig()
      }
      const lensAddress = eulerLensAddresses.value?.accountLens
      if (!lensAddress) {
        throw new Error('Account lens address is not available')
      }
      const client = getPublicClient(EVM_PROVIDER_URL)
      const res = await client.readContract({
        address: lensAddress as Address,
        abi: eulerAccountLensABI as Abi,
        functionName: 'getVaultAccountInfo',
        args: [position.value.subAccount, swapCollateralVault.value.address],
      }) as Record<string, any>
      swapCollateralAssets.value = res.assets
    }
    catch (e) {
      console.warn('[Repay swap] failed to load collateral balance', e)
    }
  }

  // --- Watchers ---
  watch([quotes.effectiveQuote, repaySwapDirection], () => {
    if (!quotes.effectiveQuote.value || !swapCollateralVault.value || !borrowVault.value) return
    if (repaySwapDirection.value === SwapperMode.EXACT_IN) {
      debtAmount.value = formatSignificant(formatUnits(
        BigInt(quotes.effectiveQuote.value.amountOut || 0),
        Number(borrowVault.value.asset.decimals),
      ))
    }
    else {
      collateralAmount.value = formatSignificant(formatUnits(
        BigInt(quotes.effectiveQuote.value.amountIn || 0),
        Number(swapCollateralVault.value.asset.decimals),
      ))
    }
  })

  watch([swapCollateralVault, slippage], () => {
    clearSimulationError()
    if (collateralAmount.value || debtAmount.value) {
      requestSwapQuote()
    }
  })

  watch([swapCollateralVault, position], () => {
    void updateSwapCollateralBalance()
  }, { immediate: true })

  watch(debtAmount, () => {
    if (formTab.value !== 'collateral') return
    const currentDebt = getCurrentDebt()
    if (!borrowVault.value || currentDebt <= 0n) {
      repayDebtPercent.value = 0
      return
    }
    let amountNano = 0n
    try {
      amountNano = valueToNano(debtAmount.value || '0', borrowVault.value.asset.decimals)
    }
    catch {
      amountNano = 0n
    }
    repayDebtPercent.value = amountToPercent(amountNano, currentDebt)
  })

  // --- Build / Submit / Send ---
  const buildSwapRepayPlan = async (): Promise<TxPlan> => {
    if (!position.value || !borrowVault.value || !swapCollateralVault.value) {
      throw new Error('Position or vaults not loaded')
    }

    if (swapIsSameAsset.value) {
      const debtNano = debtAmount.value
        ? valueToNano(debtAmount.value, borrowVault.value.asset.decimals)
        : valueToNano(collateralAmount.value, swapCollateralVault.value.asset.decimals)
      const currentDebtVal = getCurrentDebt()
      const isFullRepay = debtNano >= currentDebtVal

      if (isFullRepay) {
        return buildSameAssetFullRepayPlan({
          collateralVaultAddress: swapCollateralVault.value.address,
          borrowVaultAddress: borrowVault.value.address,
          amount: currentDebtVal,
          subAccount: position.value.subAccount,
          enabledCollaterals: position.value.collaterals,
        })
      }
      return buildSameAssetRepayPlan({
        collateralVaultAddress: swapCollateralVault.value.address,
        borrowVaultAddress: borrowVault.value.address,
        amount: debtNano,
        subAccount: position.value.subAccount,
        enabledCollaterals: position.value.collaterals,
      })
    }

    if (!quotes.selectedQuote.value) {
      throw new Error('No quote selected')
    }

    const currentDebt = getCurrentDebt()
    const swapMode = repaySwapDirection.value
    let targetDebt = 0n
    if (swapMode === SwapperMode.TARGET_DEBT && debtAmount.value) {
      const debtAmountNano = valueToNano(debtAmount.value, borrowVault.value.asset.decimals)
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
        source: 'collateral',
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

  const submitSwap = async () => {
    if (isPreparing.value || isSubmitting.value || !position.value || !borrowVault.value || !swapCollateralVault.value) return
    if (!swapIsSameAsset.value && !quotes.selectedQuote.value) return

    isPreparing.value = true
    try {
      try {
        plan.value = await buildSwapRepayPlan()
      }
      catch (e) {
        console.warn('[OperationReviewModal] failed to build plan', e)
        plan.value = null
      }

      if (plan.value) {
        const ok = await runSimulation(plan.value)
        if (!ok) return
      }

      modal.open(OperationReviewModal, {
        props: {
          type: 'repay',
          asset: swapCollateralVault.value.asset,
          amount: collateralAmount.value,
          plan: plan.value || undefined,
          subAccount: position.value?.subAccount,
          hasBorrows: (position.value?.borrowed || 0n) > 0n,
          onConfirm: () => {
            setTimeout(() => {
              sendSwap()
            }, 400)
          },
        },
      })
    }
    finally {
      isPreparing.value = false
    }
  }

  const sendSwap = async () => {
    if (!position.value || !borrowVault.value) return
    if (!swapIsSameAsset.value && !quotes.selectedQuote.value) return
    try {
      isSubmitting.value = true
      const txPlan = await buildSwapRepayPlan()
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

  const initVault = (vault: Vault | undefined) => {
    swapCollateralVault.value = vault
  }

  const resetOnTabSwitch = () => {
    collateralAmount.value = ''
    debtAmount.value = ''
    repaySwapDirection.value = SwapperMode.EXACT_IN
    quotes.reset()
  }

  return {
    collateralAmount,
    debtAmount,
    repaySwapDirection,
    repayDebtPercent,
    swapCollateralVault,
    swapCollateralAssets,
    swapCollateralBalance,
    swapDebtBalance,
    swapPriceInvert,
    swapCollateralProduct,
    repayCollateralOptions,
    repayCollateralVaults,
    quotes,
    swapIsSameAsset,
    swapCollateralSpent,
    swapDebtRepaid,
    swapRoeBefore,
    swapRoeAfter,
    swapPriceRatio,
    swapCurrentLtv,
    swapCurrentLiquidationLtv,
    swapNextLtv,
    swapCurrentHealth,
    swapNextHealth,
    isSwapHealthInsufficient,
    swapCurrentLiquidationPrice,
    swapNextLiquidationPrice,
    swapCurrentPrice,
    swapSummary,
    swapPriceImpact,
    swapLeveragedPriceImpact,
    swapRoutedVia,
    swapRouteEmptyMessage,
    swapRouteItems,
    isSwapSubmitDisabled,
    swapDisabledReason,
    onCollateralInput,
    onDebtInput,
    onRepayPercentInput,
    onSwapCollateralChange,
    onRefreshSwapQuotes,
    submitSwap,
    sendSwap,
    updateSwapCollateralBalance,
    initVault,
    resetOnTabSwitch,
  }
}
