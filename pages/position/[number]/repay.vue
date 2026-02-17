<script setup lang="ts">
import { useAccount } from '@wagmi/vue'
import { getAddress, formatUnits, zeroAddress, type Address, type Abi } from 'viem'
import { FixedPoint } from '~/utils/fixed-point'
import { getPublicClient } from '~/utils/public-client'
import { useModal } from '~/components/ui/composables/useModal'
import { OperationReviewModal, SlippageSettingsModal } from '#components'
import { useToast } from '~/components/ui/composables/useToast'
import { useEulerProductOfVault } from '~/composables/useEulerLabels'
import { getNetAPY, type VaultAsset, type Vault } from '~/entities/vault'
import { getAssetUsdValue, getAssetUsdValueOrZero, getAssetOraclePrice, getCollateralOraclePrice, conservativePriceRatioNumber } from '~/services/pricing/priceProvider'
import { type AccountBorrowPosition, isPositionEligibleForLiquidation } from '~/entities/account'
import type { TxPlan } from '~/entities/txPlan'
import { SwapperMode } from '~/entities/swap'
import { eulerAccountLensABI } from '~/entities/euler/abis'
import { useSwapCollateralOptions } from '~/composables/useSwapCollateralOptions'
import { useRepaySavingsOptions } from '~/composables/useRepaySavingsOptions'
import { useSwapQuotesParallel } from '~/composables/useSwapQuotesParallel'
import { useTermsOfUseGate } from '~/composables/useTermsOfUseGate'
import { getQuoteAmount } from '~/utils/swapQuotes'
import { formatNumber, formatSmartAmount, formatHealthScore, trimTrailingZeros } from '~/utils/string-utils'
import { nanoToValue } from '~/utils/crypto-utils'

const route = useRoute()
const router = useRouter()
const modal = useModal()
const { error } = useToast()
const { buildRepayPlan, buildFullRepayPlan, buildSwapPlan, buildSameAssetRepayPlan, buildSameAssetFullRepayPlan, buildSwapCollateralFullRepayPlan, buildSavingsRepayPlan, buildSavingsFullRepayPlan, buildSwapSavingsFullRepayPlan, executeTxPlan } = useEulerOperations()
const { isConnected, address } = useAccount()
const positionIndex = route.params.number as string
const { isPositionsLoading, isPositionsLoaded, isDepositsLoaded, refreshAllPositions, getPositionBySubAccountIndex } = useEulerAccount()
const { getSupplyRewardApy, getBorrowRewardApy } = useRewardsApy()
const { withIntrinsicBorrowApy, withIntrinsicSupplyApy } = useIntrinsicApy()
const { eulerLensAddresses, isReady: isEulerAddressesReady, loadEulerConfig } = useEulerAddresses()
const { EVM_PROVIDER_URL } = useEulerConfig()
const { fetchSingleBalance } = useWallets()
const walletBalance = ref(0n)
const { runSimulation, simulationError, clearSimulationError } = useTxPlanSimulation()
const { slippage } = useSlippage()
const { getSubmitLabel, getSubmitDisabled, guardWithTerms } = useTermsOfUseGate()

const walletPriceInvert = usePriceInvert(
  () => collateralVault.value?.asset.symbol,
  () => borrowVault.value?.asset.symbol,
)
const swapPriceInvert = usePriceInvert(
  () => swapCollateralVault.value?.asset.symbol,
  () => borrowVault.value?.asset.symbol,
)

const isLoading = ref(false)
const isSubmitting = ref(false)
const isPreparing = ref(false)
const isEstimatesLoading = ref(false)
const amount = ref('')
const formTab = ref<'wallet' | 'collateral' | 'savings'>('wallet')
const collateralAmount = ref('')
const debtAmount = ref('')
const repaySwapDirection = ref(SwapperMode.EXACT_IN)
const repayDebtPercent = ref(0)
const walletRepayPercent = ref(0)
const plan = ref<TxPlan | null>(null)
const balance = ref(0n)
const position: Ref<AccountBorrowPosition | undefined> = ref()
const estimateNetAPY = ref(0)
const estimateUserLTV = ref(0n)
const estimateHealth = ref(0n)
const estimatesError = ref('')

const { savingsPositions, savingsVaults, savingsOptions, getSavingsPosition } = useRepaySavingsOptions()

const formTabs = computed(() => {
  const tabs = [
    { label: 'From wallet', value: 'wallet' },
    { label: 'Swap collateral', value: 'collateral' },
  ]
  if (savingsPositions.value.length > 0) {
    tabs.push({ label: 'From savings', value: 'savings' })
  }
  return tabs
})

const borrowVault = computed(() => position.value?.borrow)
const collateralVault = computed(() => position.value?.collateral)
const assets = computed(() => [collateralVault.value?.asset, borrowVault.value?.asset])
const swapCollateralVault: Ref<Vault | undefined> = ref()
const swapCollateralAssets = ref(0n)
const swapCollateralBalance = computed(() => swapCollateralAssets.value)
const swapDebtBalance = computed(() => position.value?.borrowed || 0n)
const isEligibleForLiquidation = computed(() => isPositionEligibleForLiquidation(position.value))

// --- Savings tab state ---
const savingsVault: Ref<Vault | undefined> = ref()
const savingsAmount = ref('')
const savingsDebtAmount = ref('')
const savingsSwapDirection = ref(SwapperMode.EXACT_IN)
const savingsDebtPercent = ref(0)
const savingsAssets = ref(0n)
const savingsBalance = computed(() => savingsAssets.value)
const savingsDebtBalance = computed(() => position.value?.borrowed || 0n)
const savingsPriceInvert = usePriceInvert(
  () => savingsVault.value?.asset.symbol,
  () => borrowVault.value?.asset.symbol,
)
const savingsProduct = useEulerProductOfVault(computed(() => savingsVault.value?.address || ''))

const savingsIsSameAsset = computed(() => {
  if (!savingsVault.value || !borrowVault.value) {
    return false
  }
  return normalizeAddress(savingsVault.value.asset.address) === normalizeAddress(borrowVault.value.asset.address)
})

const savingsExactInQuotes = useSwapQuotesParallel({ amountField: 'amountOut', compare: 'max' })
const savingsTargetDebtQuotes = useSwapQuotesParallel({ amountField: 'amountIn', compare: 'min' })

const savingsSwapQuoteCardsSorted = computed(() => savingsSwapDirection.value === SwapperMode.EXACT_IN
  ? savingsExactInQuotes.sortedQuoteCards.value
  : savingsTargetDebtQuotes.sortedQuoteCards.value)
const savingsSelectedProvider = computed(() => savingsSwapDirection.value === SwapperMode.EXACT_IN
  ? savingsExactInQuotes.selectedProvider.value
  : savingsTargetDebtQuotes.selectedProvider.value)
const savingsSelectedQuote = computed(() => savingsSwapDirection.value === SwapperMode.EXACT_IN
  ? savingsExactInQuotes.selectedQuote.value
  : savingsTargetDebtQuotes.selectedQuote.value)
const savingsEffectiveQuote = computed(() => savingsSwapDirection.value === SwapperMode.EXACT_IN
  ? savingsExactInQuotes.effectiveQuote.value
  : savingsTargetDebtQuotes.effectiveQuote.value)
const savingsProvidersCount = computed(() => savingsSwapDirection.value === SwapperMode.EXACT_IN
  ? savingsExactInQuotes.providersCount.value
  : savingsTargetDebtQuotes.providersCount.value)
const savingsIsQuoteLoading = computed(() => savingsSwapDirection.value === SwapperMode.EXACT_IN
  ? savingsExactInQuotes.isLoading.value
  : savingsTargetDebtQuotes.isLoading.value)
const savingsQuoteError = computed(() => savingsSwapDirection.value === SwapperMode.EXACT_IN
  ? savingsExactInQuotes.quoteError.value
  : savingsTargetDebtQuotes.quoteError.value)
const savingsQuotesStatusLabel = computed(() => savingsSwapDirection.value === SwapperMode.EXACT_IN
  ? savingsExactInQuotes.statusLabel.value
  : savingsTargetDebtQuotes.statusLabel.value)
const savingsQuote = computed(() => savingsEffectiveQuote.value || null)

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
  if (!savingsQuote.value) {
    return null
  }
  try {
    return BigInt(savingsQuote.value.amountIn || 0)
  }
  catch {
    return null
  }
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
  if (!savingsQuote.value) {
    return null
  }
  try {
    return BigInt(savingsQuote.value.amountOut || 0)
  }
  catch {
    return null
  }
})

// Savings summary computeds (async values)
const savingsValueUsd = ref<number | null>(null)
watchEffect(async () => {
  if (!savingsVault.value) {
    savingsValueUsd.value = null
    return
  }
  savingsValueUsd.value = (await getAssetUsdValue(savingsAssets.value, savingsVault.value, 'off-chain')) ?? null
})

const savingsBorrowValueUsd = ref<number | null>(null)
watchEffect(async () => {
  if (!borrowVault.value || !position.value) {
    savingsBorrowValueUsd.value = null
    return
  }
  savingsBorrowValueUsd.value = (await getAssetUsdValue(position.value.borrowed, borrowVault.value, 'off-chain')) ?? null
})

const savingsNextBorrowValueUsd = ref<number | null>(null)
watchEffect(async () => {
  if (!borrowVault.value || !position.value || savingsDebtRepaid.value === null) {
    savingsNextBorrowValueUsd.value = null
    return
  }
  const nextBorrow = position.value.borrowed - savingsDebtRepaid.value
  savingsNextBorrowValueUsd.value = (await getAssetUsdValue(nextBorrow > 0n ? nextBorrow : 0n, borrowVault.value, 'off-chain')) ?? null
})

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
  // Collateral is unchanged when repaying from savings
  if (!collateralVault.value || !position.value) return null
  return nanoToValue(position.value.supplied || 0n, collateralVault.value.decimals)
})
const savingsNextLtv = computed(() => {
  if (savingsBorrowAmountAfter.value === null || savingsCollateralAmountAfter.value === null || !oraclePriceRatio.value) return null
  if (savingsBorrowAmountAfter.value === 0) return 0
  if (oraclePriceRatio.value <= 0 || savingsCollateralAmountAfter.value <= 0) return null
  return (savingsBorrowAmountAfter.value / (savingsCollateralAmountAfter.value * oraclePriceRatio.value)) * 100
})
const savingsNextHealth = computed(() => {
  if (!savingsCurrentLiquidationLtv.value || savingsNextLtv.value === null) return null
  if (savingsNextLtv.value <= 0) return Infinity
  return savingsCurrentLiquidationLtv.value / savingsNextLtv.value
})

const savingsSwapCurrentPrice = computed(() => {
  if (!savingsQuote.value || !savingsVault.value || !borrowVault.value) return null
  const amountOut = Number(formatUnits(BigInt(savingsQuote.value.amountOut), Number(borrowVault.value.asset.decimals)))
  const amountIn = Number(formatUnits(BigInt(savingsQuote.value.amountIn), Number(savingsVault.value.asset.decimals)))
  if (!amountOut || !amountIn) return null
  return {
    value: amountOut / amountIn,
    symbol: `${borrowVault.value.asset.symbol}/${savingsVault.value.asset.symbol}`,
  }
})
const savingsSwapSummary = computed(() => {
  if (!savingsQuote.value || !savingsVault.value || !borrowVault.value) return null
  const amountIn = formatUnits(BigInt(savingsQuote.value.amountIn), Number(savingsVault.value.asset.decimals))
  const amountOut = formatUnits(BigInt(savingsQuote.value.amountOut), Number(borrowVault.value.asset.decimals))
  return {
    from: `${formatNumber(amountIn)} ${savingsVault.value.asset.symbol}`,
    to: `${formatSignificant(amountOut)} ${borrowVault.value.asset.symbol}`,
  }
})
const savingsPriceImpact = ref<number | null>(null)
watchEffect(async () => {
  if (!savingsQuote.value || !savingsVault.value || !borrowVault.value) {
    savingsPriceImpact.value = null
    return
  }
  const [amountInUsd, amountOutUsd] = await Promise.all([
    getAssetUsdValue(BigInt(savingsQuote.value.amountIn), savingsVault.value, 'off-chain'),
    getAssetUsdValue(BigInt(savingsQuote.value.amountOut), borrowVault.value, 'off-chain'),
  ])
  if (!amountInUsd || !amountOutUsd) {
    savingsPriceImpact.value = null
    return
  }
  const impact = (amountOutUsd / amountInUsd - 1) * 100
  savingsPriceImpact.value = Number.isFinite(impact) ? impact : null
})
const savingsRoutedVia = computed(() => {
  if (!savingsQuote.value?.route?.length) return null
  return savingsQuote.value.route.map(route => route.providerName).join(', ')
})

const savingsRouteItems = computed(() => {
  if (!borrowVault.value || !savingsVault.value) return []
  const bestProvider = savingsSwapQuoteCardsSorted.value[0]?.provider
  const isExactIn = savingsSwapDirection.value === SwapperMode.EXACT_IN
  return savingsSwapQuoteCardsSorted.value.map((card) => {
    const amount = getQuoteAmount(card.quote, isExactIn ? 'amountOut' : 'amountIn')
    const symbol = isExactIn ? borrowVault.value!.asset.symbol : savingsVault.value!.asset.symbol
    const amountLabel = formatSignificant(
      formatUnits(amount, Number(isExactIn ? borrowVault.value!.asset.decimals : savingsVault.value!.asset.decimals)),
    )
    const diffPct = (isExactIn ? savingsExactInQuotes.getQuoteDiffPct : savingsTargetDebtQuotes.getQuoteDiffPct)(card.quote)
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

const isSavingsSubmitDisabled = computed(() => {
  if (!isConnected.value) return false
  if (!savingsVault.value || !borrowVault.value) return true
  if (!savingsDebtAmount.value && !savingsAmount.value) return true
  if (savingsIsSameAsset.value) return false
  if (savingsQuoteError.value) return true
  if (!savingsSelectedQuote.value) return true
  return false
})

const isSubmitDisabled = computed(() => {
  if (!isConnected.value) return false
  return isLoading.value || !(+amount.value) || !!estimatesError.value || isEstimatesLoading.value
})
const isSwapSubmitDisabled = computed(() => {
  if (!isConnected.value) return false
  if (!swapCollateralVault.value || !borrowVault.value) {
    return true
  }
  if (!debtAmount.value && !collateralAmount.value) {
    return true
  }
  if (swapIsSameAsset.value) {
    // For same-asset, no quote needed — just need a valid amount
    if (isSwapHealthInsufficient.value) {
      return true
    }
    return false
  }
  if (swapQuoteError.value) {
    return true
  }
  if (!swapSelectedQuote.value) {
    return true
  }
  if (isSwapHealthInsufficient.value) {
    return true
  }
  return false
})
const swapDisabledReason = computed(() => {
  if (isSwapHealthInsufficient.value) {
    return 'This swap will not restore account health. Repay the full debt from your wallet instead.'
  }
  return undefined
})
const reviewRepayLabel = getSubmitLabel('Review Repay')
const reviewRepayDisabled = getSubmitDisabled(computed(() => {
  if (formTab.value === 'wallet') return isSubmitDisabled.value
  if (formTab.value === 'savings') return isSavingsSubmitDisabled.value
  return isSwapSubmitDisabled.value
}))
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
// Pre-computed net APY (async)
const netAPY = ref(0)

watchEffect(async () => {
  if (!position.value || !collateralVault.value || !borrowVault.value) {
    netAPY.value = 0
    return
  }

  const [supplyUsd, borrowUsd] = await Promise.all([
    getAssetUsdValueOrZero(position.value.supplied || 0n, collateralVault.value, 'off-chain'),
    getAssetUsdValueOrZero(position.value.borrowed ?? 0n, borrowVault.value, 'off-chain'),
  ])

  netAPY.value = getNetAPY(
    supplyUsd,
    collateralSupplyApy.value,
    borrowUsd,
    borrowApy.value,
    collateralSupplyRewardApy.value || null,
    borrowRewardApy.value || null,
  )
})

const swapperMode = computed(() => repaySwapDirection.value)

const getCurrentDebt = () => position.value?.borrowed || 0n
const amountFixed = computed(() => FixedPoint.fromValue(
  valueToNano(amount.value || '0', borrowVault.value?.decimals),
  Number(borrowVault.value?.decimals),
))
const borrowedFixed = computed(() => FixedPoint.fromValue(position.value?.borrowed || 0n, position.value?.borrow.decimals || 18))
const suppliedFixed = computed(() => FixedPoint.fromValue(position.value?.supplied || 0n, position.value?.collateral.decimals || 18))
const priceFixed = computed(() => FixedPoint.fromValue(position.value?.price || 0n, 18))
const balanceFixed = computed(() => FixedPoint.fromValue(balance.value, borrowVault.value?.decimals || 18))
const oraclePriceRatio = computed(() => {
  if (!borrowVault.value || !collateralVault.value) {
    return null
  }
  const collateralPrice = getCollateralOraclePrice(borrowVault.value, collateralVault.value as Vault)
  const borrowPrice = getAssetOraclePrice(borrowVault.value)
  return conservativePriceRatioNumber(collateralPrice, borrowPrice)
})
const liquidationPrice = computed(() => {
  const health = nanoToValue(position.value?.health || 0n, 18)
  if (!oraclePriceRatio.value || health < 0.1) {
    return null
  }
  return oraclePriceRatio.value / health
})

const { name } = useEulerProductOfVault(borrowVault.value?.address || '')
const swapCollateralProduct = useEulerProductOfVault(computed(() => swapCollateralVault.value?.address || ''))

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
    // Fetch fresh wallet balance for this specific asset
    await fetchWalletBalance()
    await updateBalance()
    estimateNetAPY.value = netAPY.value
    estimateUserLTV.value = position.value?.userLTV || 0n
    estimateHealth.value = position.value?.health || 0n
    swapCollateralVault.value = position.value?.collateral as Vault | undefined
    // Initialize savings vault to first available savings position
    if (savingsVaults.value.length > 0) {
      savingsVault.value = savingsVaults.value[0] as Vault
      updateSavingsBalance()
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

const { collateralOptions: swapCollateralOptions, collateralVaults: swapCollateralVaults } = useSwapCollateralOptions({
  currentVault: computed(() => undefined),
  liabilityVault: computed(() => borrowVault.value as typeof borrowVault.value),
  tagContext: 'supply-source',
})

const repayCollateralVaults = computed(() => {
  if (!position.value) {
    return []
  }
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

const exactInQuotes = useSwapQuotesParallel({ amountField: 'amountOut', compare: 'max' })
const targetDebtQuotes = useSwapQuotesParallel({ amountField: 'amountIn', compare: 'min' })

const swapQuoteCardsSorted = computed(() => repaySwapDirection.value === SwapperMode.EXACT_IN
  ? exactInQuotes.sortedQuoteCards.value
  : targetDebtQuotes.sortedQuoteCards.value)
const swapSelectedProvider = computed(() => repaySwapDirection.value === SwapperMode.EXACT_IN
  ? exactInQuotes.selectedProvider.value
  : targetDebtQuotes.selectedProvider.value)
const swapSelectedQuote = computed(() => repaySwapDirection.value === SwapperMode.EXACT_IN
  ? exactInQuotes.selectedQuote.value
  : targetDebtQuotes.selectedQuote.value)
const swapEffectiveQuote = computed(() => repaySwapDirection.value === SwapperMode.EXACT_IN
  ? exactInQuotes.effectiveQuote.value
  : targetDebtQuotes.effectiveQuote.value)
const swapProvidersCount = computed(() => repaySwapDirection.value === SwapperMode.EXACT_IN
  ? exactInQuotes.providersCount.value
  : targetDebtQuotes.providersCount.value)
const swapIsQuoteLoading = computed(() => repaySwapDirection.value === SwapperMode.EXACT_IN
  ? exactInQuotes.isLoading.value
  : targetDebtQuotes.isLoading.value)
const swapQuoteError = computed(() => repaySwapDirection.value === SwapperMode.EXACT_IN
  ? exactInQuotes.quoteError.value
  : targetDebtQuotes.quoteError.value)
const swapQuotesStatusLabel = computed(() => repaySwapDirection.value === SwapperMode.EXACT_IN
  ? exactInQuotes.statusLabel.value
  : targetDebtQuotes.statusLabel.value)
const swapQuote = computed(() => swapEffectiveQuote.value || null)

const swapCollateralSupplyApy = computed(() => {
  if (!swapCollateralVault.value) {
    return null
  }
  const base = nanoToValue(swapCollateralVault.value.interestRateInfo.supplyAPY || 0n, 25)
  return withIntrinsicSupplyApy(base, swapCollateralVault.value.asset.address) + getSupplyRewardApy(swapCollateralVault.value.address)
})
const swapBorrowApy = computed(() => {
  if (!borrowVault.value) {
    return null
  }
  const base = nanoToValue(borrowVault.value.interestRateInfo.borrowAPY || 0n, 25)
  return withIntrinsicBorrowApy(base, borrowVault.value.asset.address) - getBorrowRewardApy(borrowVault.value.address, collateralVault.value?.address)
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
  if (!swapQuote.value) {
    return null
  }
  try {
    return BigInt(swapQuote.value.amountIn || 0)
  }
  catch {
    return null
  }
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
  if (!swapQuote.value) {
    return null
  }
  try {
    return BigInt(swapQuote.value.amountOut || 0)
  }
  catch {
    return null
  }
})
// Pre-computed swap collateral USD value (async)
const swapCollateralValueUsd = ref<number | null>(null)

watchEffect(async () => {
  if (!swapCollateralVault.value) {
    swapCollateralValueUsd.value = null
    return
  }
  swapCollateralValueUsd.value = (await getAssetUsdValue(swapCollateralAssets.value, swapCollateralVault.value, 'off-chain')) ?? null
})

// Pre-computed swap borrow USD value (async)
const swapBorrowValueUsd = ref<number | null>(null)

watchEffect(async () => {
  if (!borrowVault.value || !position.value) {
    swapBorrowValueUsd.value = null
    return
  }
  swapBorrowValueUsd.value = (await getAssetUsdValue(position.value.borrowed, borrowVault.value, 'off-chain')) ?? null
})

// Pre-computed swap next collateral USD value (async)
const swapNextCollateralValueUsd = ref<number | null>(null)

watchEffect(async () => {
  if (!swapCollateralVault.value || swapCollateralSpent.value === null) {
    swapNextCollateralValueUsd.value = null
    return
  }
  const nextAssets = swapCollateralAssets.value - swapCollateralSpent.value
  swapNextCollateralValueUsd.value = (await getAssetUsdValue(nextAssets > 0n ? nextAssets : 0n, swapCollateralVault.value, 'off-chain')) ?? null
})

// Pre-computed swap next borrow USD value (async)
const swapNextBorrowValueUsd = ref<number | null>(null)

watchEffect(async () => {
  if (!borrowVault.value || !position.value || swapDebtRepaid.value === null) {
    swapNextBorrowValueUsd.value = null
    return
  }
  const nextBorrow = position.value.borrowed - swapDebtRepaid.value
  swapNextBorrowValueUsd.value = (await getAssetUsdValue(nextBorrow > 0n ? nextBorrow : 0n, borrowVault.value, 'off-chain')) ?? null
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

const swapRoeBefore = computed(() => {
  return calculateRoe(swapCollateralValueUsd.value, swapBorrowValueUsd.value, swapCollateralSupplyApy.value, swapBorrowApy.value)
})
const swapRoeAfter = computed(() => {
  return calculateRoe(swapNextCollateralValueUsd.value, swapNextBorrowValueUsd.value, swapCollateralSupplyApy.value, swapBorrowApy.value)
})

const swapPriceRatio = computed(() => {
  if (!swapCollateralVault.value || !borrowVault.value) {
    return null
  }
  const collateralPrice = getAssetOraclePrice(swapCollateralVault.value)
  const borrowPrice = getAssetOraclePrice(borrowVault.value)
  return conservativePriceRatioNumber(collateralPrice, borrowPrice)
})

const swapCollateralAmountAfter = computed(() => {
  if (!swapCollateralVault.value || swapCollateralSpent.value === null) {
    return null
  }
  const nextAssets = swapCollateralAssets.value - swapCollateralSpent.value
  const safeAssets = nextAssets > 0n ? nextAssets : 0n
  return nanoToValue(safeAssets, swapCollateralVault.value.decimals)
})
const swapBorrowAmountAfter = computed(() => {
  if (!borrowVault.value || !position.value || swapDebtRepaid.value === null) {
    return null
  }
  const nextBorrow = position.value.borrowed - swapDebtRepaid.value
  const safeBorrow = nextBorrow > 0n ? nextBorrow : 0n
  return nanoToValue(safeBorrow, borrowVault.value.decimals)
})
const swapCurrentLtv = computed(() => {
  if (!position.value) {
    return null
  }
  return nanoToValue(position.value.userLTV, 18)
})
const swapCurrentLiquidationLtv = computed(() => {
  if (!position.value) {
    return null
  }
  return nanoToValue(position.value.liquidationLTV, 2)
})
const swapNextLiquidationLtv = computed(() => {
  if (!borrowVault.value || !swapCollateralVault.value) {
    return null
  }
  const match = borrowVault.value.collateralLTVs.find(
    ltv => normalizeAddress(ltv.collateral) === normalizeAddress(swapCollateralVault.value?.address),
  )
  if (match) {
    return nanoToValue(match.liquidationLTV, 2)
  }
  return swapCurrentLiquidationLtv.value
})
const swapNextLtv = computed(() => {
  if (swapBorrowAmountAfter.value === null || swapCollateralAmountAfter.value === null || !swapPriceRatio.value) {
    return null
  }
  if (swapBorrowAmountAfter.value === 0) {
    return 0
  }
  if (swapPriceRatio.value <= 0 || swapCollateralAmountAfter.value <= 0) {
    return null
  }
  return (swapBorrowAmountAfter.value / (swapCollateralAmountAfter.value * swapPriceRatio.value)) * 100
})
const swapCurrentHealth = computed(() => {
  if (!position.value) {
    return null
  }
  return nanoToValue(position.value.health, 18)
})
const swapNextHealth = computed(() => {
  if (!swapNextLiquidationLtv.value || swapNextLtv.value === null) {
    return null
  }
  if (swapNextLtv.value <= 0) {
    return Infinity
  }
  return swapNextLiquidationLtv.value / swapNextLtv.value
})
const isSwapHealthInsufficient = computed(() => {
  if (!isEligibleForLiquidation.value) return false
  if (swapNextHealth.value === null) return false
  return swapNextHealth.value < 1
})

const swapCurrentLiquidationPrice = computed(() => {
  if (!swapPriceRatio.value || !swapCurrentHealth.value) {
    return null
  }
  if (swapCurrentHealth.value <= 0) {
    return null
  }
  return swapPriceRatio.value / swapCurrentHealth.value
})
const swapNextLiquidationPrice = computed(() => {
  if (!swapPriceRatio.value || !swapNextHealth.value) {
    return null
  }
  if (swapNextHealth.value <= 0) {
    return null
  }
  return swapPriceRatio.value / swapNextHealth.value
})

const swapCurrentPrice = computed(() => {
  if (!swapQuote.value || !swapCollateralVault.value || !borrowVault.value) {
    return null
  }
  const amountOut = Number(formatUnits(BigInt(swapQuote.value.amountOut), Number(borrowVault.value.asset.decimals)))
  const amountIn = Number(formatUnits(BigInt(swapQuote.value.amountIn), Number(swapCollateralVault.value.asset.decimals)))
  if (!amountOut || !amountIn) {
    return null
  }
  return {
    value: amountOut / amountIn,
    symbol: `${borrowVault.value.asset.symbol}/${swapCollateralVault.value.asset.symbol}`,
  }
})
const swapSummary = computed(() => {
  if (!swapQuote.value || !swapCollateralVault.value || !borrowVault.value) {
    return null
  }
  const amountIn = formatUnits(BigInt(swapQuote.value.amountIn), Number(swapCollateralVault.value.asset.decimals))
  const amountOut = formatUnits(BigInt(swapQuote.value.amountOut), Number(borrowVault.value.asset.decimals))
  return {
    from: `${formatNumber(amountIn)} ${swapCollateralVault.value.asset.symbol}`,
    to: `${formatSignificant(amountOut)} ${borrowVault.value.asset.symbol}`,
  }
})
// Pre-computed swap price impact (async)
const swapPriceImpact = ref<number | null>(null)

watchEffect(async () => {
  if (!swapQuote.value || !swapCollateralVault.value || !borrowVault.value) {
    swapPriceImpact.value = null
    return
  }
  const [amountInUsd, amountOutUsd] = await Promise.all([
    getAssetUsdValue(BigInt(swapQuote.value.amountIn), swapCollateralVault.value, 'off-chain'),
    getAssetUsdValue(BigInt(swapQuote.value.amountOut), borrowVault.value, 'off-chain'),
  ])
  if (!amountInUsd || !amountOutUsd) {
    swapPriceImpact.value = null
    return
  }
  const impact = (amountOutUsd / amountInUsd - 1) * 100
  if (!Number.isFinite(impact)) {
    swapPriceImpact.value = null
    return
  }
  swapPriceImpact.value = impact
})
const swapLeveragedPriceImpact = computed(() => {
  return swapPriceImpact.value
})
const swapRoutedVia = computed(() => {
  if (!swapQuote.value?.route?.length) {
    return null
  }
  return swapQuote.value.route.map(route => route.providerName).join(', ')
})

const swapRouteEmptyMessage = computed(() => {
  if (!swapProvidersCount.value) {
    return 'Enter amount to fetch quotes'
  }
  return 'No quotes found'
})

const openSlippageSettings = () => {
  modal.open(SlippageSettingsModal)
}

const swapIsSameAsset = computed(() => {
  if (!swapCollateralVault.value || !borrowVault.value) {
    return false
  }
  return normalizeAddress(swapCollateralVault.value.asset.address) === normalizeAddress(borrowVault.value.asset.address)
})

const swapRouteItems = computed(() => {
  if (!borrowVault.value || !swapCollateralVault.value) {
    return []
  }
  const bestProvider = swapQuoteCardsSorted.value[0]?.provider
  const isExactIn = repaySwapDirection.value === SwapperMode.EXACT_IN
  return swapQuoteCardsSorted.value.map((card) => {
    const amount = getQuoteAmount(card.quote, isExactIn ? 'amountOut' : 'amountIn')
    const symbol = isExactIn ? borrowVault.value!.asset.symbol : swapCollateralVault.value!.asset.symbol
    const amountLabel = formatSignificant(
      formatUnits(amount, Number(isExactIn ? borrowVault.value!.asset.decimals : swapCollateralVault.value!.asset.decimals)),
    )
    const diffPct = (isExactIn ? exactInQuotes.getQuoteDiffPct : targetDebtQuotes.getQuoteDiffPct)(card.quote)
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

const resetSwapQuoteState = () => {
  exactInQuotes.reset()
  targetDebtQuotes.reset()
}

const onRefreshSwapQuotes = () => {
  resetSwapQuoteState()
  const activeQuotes = repaySwapDirection.value === SwapperMode.EXACT_IN
    ? exactInQuotes
    : targetDebtQuotes
  activeQuotes.isLoading.value = true
  requestSwapQuote()
}

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
  if (currentDebt > 0n && amountNano > 0n) {
    repayDebtPercent.value = Math.min(100, Math.max(0, Math.round(Number(amountNano * 100n / currentDebt))))
  }
  else {
    repayDebtPercent.value = 0
  }
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
    resetSwapQuoteState()
    return
  }
  const percent = Math.min(100, Math.max(0, repayDebtPercent.value || 0))
  const amountNano = (currentDebt * BigInt(Math.round(percent * 100))) / 10_000n
  debtAmount.value = trimTrailingZeros(formatUnits(amountNano, Number(borrowVault.value.asset.decimals)))
  requestSwapQuote()
}

const selectSwapProvider = (provider: string) => {
  if (repaySwapDirection.value === SwapperMode.EXACT_IN) {
    exactInQuotes.selectProvider(provider)
  }
  else {
    targetDebtQuotes.selectProvider(provider)
  }
}

const onSwapCollateralChange = (selectedIndex: number) => {
  clearSimulationError()
  const nextVault = repayCollateralVaults.value[selectedIndex]
  if (!nextVault) {
    return
  }
  if (!swapCollateralVault.value || normalizeAddress(swapCollateralVault.value.address) !== normalizeAddress(nextVault.address)) {
    swapCollateralVault.value = nextVault as Vault
    collateralAmount.value = ''
    debtAmount.value = ''
    resetSwapQuoteState()
  }
}

const requestSwapQuote = useDebounceFn(async () => {
  if (!position.value || !swapCollateralVault.value || !borrowVault.value) {
    resetSwapQuoteState()
    return
  }

  if (swapIsSameAsset.value) {
    const currentDebt = position.value.borrowed || 0n
    if (repaySwapDirection.value === SwapperMode.EXACT_IN && collateralAmount.value) {
      // Cap collateral at current debt — no need to withdraw more than owed
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
    resetSwapQuoteState()
    return
  }

  const currentDebt = position.value.borrowed || 0n
  const subAccount = (position.value.subAccount || address.value || zeroAddress) as Address
  const accountIn = subAccount
  const accountOut = subAccount

  if (repaySwapDirection.value === SwapperMode.EXACT_IN) {
    if (!collateralAmount.value) {
      resetSwapQuoteState()
      return
    }
    let amount: bigint
    try {
      amount = valueToNano(collateralAmount.value, swapCollateralVault.value.asset.decimals)
    }
    catch {
      resetSwapQuoteState()
      return
    }
    if (!amount || amount <= 0n) {
      resetSwapQuoteState()
      return
    }
    await exactInQuotes.requestQuotes({
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
    resetSwapQuoteState()
    return
  }
  let amount: bigint
  try {
    amount = valueToNano(debtAmount.value, borrowVault.value.asset.decimals)
  }
  catch {
    resetSwapQuoteState()
    return
  }
  if (!amount || amount <= 0n) {
    resetSwapQuoteState()
    return
  }
  const targetDebt = amount >= currentDebt ? 0n : currentDebt - amount
  await targetDebtQuotes.requestQuotes({
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

watch([swapEffectiveQuote, repaySwapDirection], () => {
  if (!swapEffectiveQuote.value || !swapCollateralVault.value || !borrowVault.value) {
    return
  }
  if (repaySwapDirection.value === SwapperMode.EXACT_IN) {
    debtAmount.value = formatUnits(
      BigInt(swapEffectiveQuote.value.amountOut || 0),
      Number(borrowVault.value.asset.decimals),
    )
    debtAmount.value = formatSignificant(debtAmount.value)
  }
  else {
    collateralAmount.value = formatUnits(
      BigInt(swapEffectiveQuote.value.amountIn || 0),
      Number(swapCollateralVault.value.asset.decimals),
    )
    collateralAmount.value = formatSignificant(collateralAmount.value)
  }
})

// --- Savings tab handlers ---

const resetSavingsQuoteState = () => {
  savingsExactInQuotes.reset()
  savingsTargetDebtQuotes.reset()
}

const updateSavingsBalance = () => {
  if (!savingsVault.value) {
    savingsAssets.value = 0n
    return
  }
  const pos = getSavingsPosition(savingsVault.value.address)
  savingsAssets.value = pos?.assets || 0n
}

const onSavingsVaultChange = (selectedIndex: number) => {
  clearSimulationError()
  const nextVault = savingsVaults.value[selectedIndex]
  if (!nextVault) return
  if (!savingsVault.value || normalizeAddress(savingsVault.value.address) !== normalizeAddress(nextVault.address)) {
    savingsVault.value = nextVault as Vault
    savingsAmount.value = ''
    savingsDebtAmount.value = ''
    resetSavingsQuoteState()
  }
}

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
  if (currentDebt > 0n && amountNano > 0n) {
    savingsDebtPercent.value = Math.min(100, Math.max(0, Math.round(Number(amountNano * 100n / currentDebt))))
  }
  else {
    savingsDebtPercent.value = 0
  }
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
    resetSavingsQuoteState()
    return
  }
  const percent = Math.min(100, Math.max(0, savingsDebtPercent.value || 0))
  const amountNano = (currentDebt * BigInt(Math.round(percent * 100))) / 10_000n
  savingsDebtAmount.value = trimTrailingZeros(formatUnits(amountNano, Number(borrowVault.value.asset.decimals)))
  requestSavingsQuote()
}

const selectSavingsProvider = (provider: string) => {
  if (savingsSwapDirection.value === SwapperMode.EXACT_IN) {
    savingsExactInQuotes.selectProvider(provider)
  }
  else {
    savingsTargetDebtQuotes.selectProvider(provider)
  }
}

const onRefreshSavingsQuotes = () => {
  resetSavingsQuoteState()
  const activeQuotes = savingsSwapDirection.value === SwapperMode.EXACT_IN
    ? savingsExactInQuotes
    : savingsTargetDebtQuotes
  activeQuotes.isLoading.value = true
  requestSavingsQuote()
}

const requestSavingsQuote = useDebounceFn(async () => {
  if (!position.value || !savingsVault.value || !borrowVault.value) {
    resetSavingsQuoteState()
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
    resetSavingsQuoteState()
    return
  }

  // Cross-asset: get savings sub-account for accountIn
  const savingsPos = getSavingsPosition(savingsVault.value.address)
  const savingsSubAccount = (savingsPos?.subAccount || address.value || zeroAddress) as Address
  const borrowSubAccount = (position.value.subAccount || address.value || zeroAddress) as Address
  const currentDebt = position.value.borrowed || 0n

  if (savingsSwapDirection.value === SwapperMode.EXACT_IN) {
    if (!savingsAmount.value) {
      resetSavingsQuoteState()
      return
    }
    let amount: bigint
    try {
      amount = valueToNano(savingsAmount.value, savingsVault.value.asset.decimals)
    }
    catch {
      resetSavingsQuoteState()
      return
    }
    if (!amount || amount <= 0n) {
      resetSavingsQuoteState()
      return
    }
    await savingsExactInQuotes.requestQuotes({
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
    resetSavingsQuoteState()
    return
  }
  let amount: bigint
  try {
    amount = valueToNano(savingsDebtAmount.value, borrowVault.value.asset.decimals)
  }
  catch {
    resetSavingsQuoteState()
    return
  }
  if (!amount || amount <= 0n) {
    resetSavingsQuoteState()
    return
  }
  const targetDebt = amount >= currentDebt ? 0n : currentDebt - amount
  await savingsTargetDebtQuotes.requestQuotes({
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

watch([savingsEffectiveQuote, savingsSwapDirection], () => {
  if (!savingsEffectiveQuote.value || !savingsVault.value || !borrowVault.value) return
  if (savingsSwapDirection.value === SwapperMode.EXACT_IN) {
    const amountOut = BigInt(savingsEffectiveQuote.value.amountOut || 0)
    const currentDebt = position.value?.borrowed || 0n
    // If savings more than covers the debt, switch to TARGET_DEBT 100% to limit
    // the savings amount to just what's needed for the full debt
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
      BigInt(savingsEffectiveQuote.value.amountIn || 0),
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
  savingsDebtPercent.value = amountNano > 0n
    ? Math.min(100, Math.max(0, Math.round(Number(amountNano * 100n / currentDebt))))
    : 0
})

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

  // Cross-asset swap from savings
  if (!savingsSelectedQuote.value) {
    throw new Error('No quote selected')
  }

  const currentDebt = getCurrentDebt()
  const swapMode = savingsSwapDirection.value
  let targetDebt = 0n
  if (swapMode === SwapperMode.TARGET_DEBT && savingsDebtAmount.value) {
    const debtAmountNano = valueToNano(savingsDebtAmount.value, borrowVault.value.asset.decimals)
    targetDebt = debtAmountNano >= currentDebt ? 0n : currentDebt - debtAmountNano
  }

  // Check if this is a full repay via swap
  const isFullRepay = targetDebt === 0n && swapMode === SwapperMode.TARGET_DEBT
  if (isFullRepay) {
    return buildSwapSavingsFullRepayPlan({
      quote: savingsSelectedQuote.value,
      swapperMode: swapMode,
      targetDebt,
      currentDebt,
      liabilityVault: borrowVault.value.address,
      enabledCollaterals: position.value.collaterals,
    })
  }

  return buildSwapPlan({
    quote: savingsSelectedQuote.value,
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
  if (!savingsIsSameAsset.value && !savingsSelectedQuote.value) return

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

    // Build known transfer amounts for the review modal (collateral is untouched during savings repay)
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
  if (!savingsIsSameAsset.value && !savingsSelectedQuote.value) return
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

const updateBalance = async () => {
  if (!isConnected.value || !position.value || !borrowVault.value) {
    balance.value = 0n
    return
  }

  const borrowedUsd = (await getAssetUsdValue(position.value.borrowed, borrowVault.value, 'off-chain')) ?? 0.01
  const factor = Math.pow(10, 2)
  const borrowedRounded = Math.ceil(borrowedUsd * factor) / factor
  balance.value = FixedPoint.fromValue(valueToNano(borrowedRounded, 4), 4)
    .div(FixedPoint.fromValue(borrowVault.value.liabilityPriceInfo.amountOutMid, Number(borrowVault.value.decimals)))
    .value
}
const submit = async () => {
  if (isPreparing.value || !position.value || !borrowVault.value || !collateralVault.value) {
    return
  }

  isPreparing.value = true
  try {
    const amountNano = valueToNano(amount.value || '0', borrowVault.value.asset.decimals)
    const shouldFullRepay = balance.value <= amountNano

    try {
      plan.value = shouldFullRepay
        ? await buildFullRepayPlan(
          borrowVault.value.address,
          borrowVault.value.asset.address,
          amountNano,
          position.value.subAccount,
          position.value.collaterals ?? [collateralVault.value.address],
          { includePermit2Call: false },
        )
        : await buildRepayPlan(
          borrowVault.value.address,
          borrowVault.value.asset.address,
          amountNano,
          position.value.subAccount,
          { includePermit2Call: false },
        )
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
        type: 'repay',
        asset: position.value!.borrow.asset,
        amount: amount.value,
        plan: plan.value || undefined,
        subAccount: position.value?.subAccount,
        hasBorrows: (position.value?.borrowed || 0n) > 0n,
        onConfirm: () => {
          setTimeout(() => {
            send()
          }, 400)
        },
      },
    })
  }
  finally {
    isPreparing.value = false
  }
}

const onSubmitForm = async () => {
  await guardWithTerms(async () => {
    if (formTab.value === 'wallet') {
      await submit()
    }
    else if (formTab.value === 'savings') {
      await submitSavings()
    }
    else {
      await submitSwap()
    }
  })
}

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

  if (!swapSelectedQuote.value) {
    throw new Error('No quote selected')
  }

  const currentDebt = getCurrentDebt()
  const swapMode = swapperMode.value
  let targetDebt = 0n
  if (swapMode === SwapperMode.TARGET_DEBT && debtAmount.value) {
    const debtAmountNano = valueToNano(debtAmount.value, borrowVault.value.asset.decimals)
    targetDebt = debtAmountNano >= currentDebt ? 0n : currentDebt - debtAmountNano
  }

  const isFullRepay = targetDebt === 0n && swapMode === SwapperMode.TARGET_DEBT
  if (isFullRepay) {
    return buildSwapCollateralFullRepayPlan({
      quote: swapSelectedQuote.value,
      swapperMode: swapMode,
      targetDebt,
      currentDebt,
      liabilityVault: borrowVault.value.address,
      enabledCollaterals: position.value.collaterals,
    })
  }

  return buildSwapPlan({
    quote: swapSelectedQuote.value,
    swapperMode: swapMode,
    isRepay: true,
    targetDebt,
    currentDebt,
    liabilityVault: borrowVault.value.address,
    enabledCollaterals: position.value.collaterals,
  })
}

const submitSwap = async () => {
  if (isPreparing.value || isSubmitting.value || !position.value || !borrowVault.value || !swapCollateralVault.value) {
    return
  }
  if (!swapIsSameAsset.value && !swapSelectedQuote.value) {
    return
  }

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
      if (!ok) {
        return
      }
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
  if (!position.value || !borrowVault.value) {
    return
  }
  if (!swapIsSameAsset.value && !swapSelectedQuote.value) {
    return
  }
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
const send = async () => {
  try {
    isSubmitting.value = true
    if (!position.value || !borrowVault.value || !collateralVault.value) {
      return
    }

    const amountNano = valueToNano(amount.value, borrowVault.value.asset.decimals)
    const isFullRepay = balance.value <= amountNano
    const txPlan = isFullRepay
      ? await buildFullRepayPlan(
        borrowVault.value.address,
        borrowVault.value.asset.address,
        amountNano,
        position.value.subAccount,
        position.value.collaterals ?? [collateralVault.value.address],
        { includePermit2Call: true },
      )
      : await buildRepayPlan(
        borrowVault.value.address,
        borrowVault.value.asset.address,
        amountNano,
        position.value.subAccount,
        { includePermit2Call: true },
      )
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
const updateEstimates = useDebounceFn(async () => {
  clearSimulationError()
  estimatesError.value = ''
  if (!position.value || !collateralVault.value || !borrowVault.value) {
    return
  }
  try {
    if (walletBalance.value < valueToNano(amount.value, borrowVault.value.decimals)) {
      throw new Error('Not enough balance')
    }
    if (borrowedFixed.value.lt(amountFixed.value)) {
      throw new Error('You repaying more than required')
    }
    const [supplyUsd, borrowUsd] = await Promise.all([
      getAssetUsdValueOrZero((position.value.supplied || 0n), collateralVault.value, 'off-chain'),
      getAssetUsdValueOrZero((position.value.borrowed || 0n) - valueToNano(amount.value, borrowVault.value.decimals), borrowVault.value, 'off-chain'),
    ])
    estimateNetAPY.value = getNetAPY(
      supplyUsd,
      collateralSupplyApy.value, // TODO: consider calculated supplyAPY after withdraw
      borrowUsd,
      borrowApy.value,
      collateralSupplyRewardApy.value || null,
      borrowRewardApy.value || null,
    )
    const collateralValue = (suppliedFixed.value).mul(priceFixed.value)
    const userLtvFixed = collateralValue.isZero()
      ? FixedPoint.fromValue(0n, 18)
      : (borrowedFixed.value.sub(amountFixed.value))
          .div(collateralValue)
          .mul(FixedPoint.fromValue(100n, 0))
    estimateUserLTV.value = userLtvFixed.value
    estimateHealth.value = (userLtvFixed.isZero() || userLtvFixed.isNegative())
      ? 0n
      : FixedPoint.fromValue(position.value!.liquidationLTV, 2).div(userLtvFixed).value

    if (userLtvFixed.gte(FixedPoint.fromValue(position.value!.liquidationLTV, 2))) {
      throw new Error('Not enough liquidity for the vault, LTV is too large')
    }
  }
  catch (e: unknown) {
    console.warn(e)
    estimateNetAPY.value = netAPY.value
    estimateUserLTV.value = position.value!.userLTV
    estimateHealth.value = position.value!.health
    estimatesError.value = (e as { message: string }).message
  }
  finally {
    isEstimatesLoading.value = false
  }
}, 500)

watch(isPositionsLoaded, (val) => {
  if (val) {
    load()
  }
}, { immediate: true })
watch(isConnected, () => {
  updateBalance()
})
watch(address, () => {
  fetchWalletBalance()
  updateBalance()
})
const onWalletRepayPercentInput = () => {
  clearSimulationError()
  if (!borrowVault.value || !position.value) {
    amount.value = ''
    walletRepayPercent.value = 0
    return
  }
  const currentDebt = position.value.borrowed || 0n
  if (currentDebt <= 0n) {
    amount.value = ''
    return
  }
  const percent = Math.min(100, Math.max(0, walletRepayPercent.value || 0))
  const amountNano = (currentDebt * BigInt(Math.round(percent * 100))) / 10_000n
  amount.value = trimTrailingZeros(formatUnits(amountNano, Number(borrowVault.value.asset.decimals)))
}

watch(amount, async () => {
  clearSimulationError()
  if (formTab.value !== 'wallet') {
    return
  }
  // Sync wallet repay percent slider
  if (position.value && borrowVault.value) {
    const currentDebt = position.value.borrowed || 0n
    if (currentDebt > 0n) {
      let amountNano = 0n
      try {
        amountNano = valueToNano(amount.value || '0', borrowVault.value.asset.decimals)
      }
      catch {
        amountNano = 0n
      }
      walletRepayPercent.value = amountNano > 0n
        ? Math.min(100, Math.max(0, Math.round(Number(amountNano * 100n / currentDebt))))
        : 0
    }
    else {
      walletRepayPercent.value = 0
    }
  }
  if (!collateralVault.value) {
    return
  }
  if (!isEstimatesLoading.value) {
    isEstimatesLoading.value = true
  }
  updateEstimates()
})

watch(formTab, () => {
  clearSimulationError()
  resetSwapQuoteState()
  resetSavingsQuoteState()
  if (formTab.value === 'wallet') {
    collateralAmount.value = ''
    debtAmount.value = ''
    repaySwapDirection.value = SwapperMode.EXACT_IN
    savingsAmount.value = ''
    savingsDebtAmount.value = ''
    savingsDebtPercent.value = 0
  }
  else if (formTab.value === 'savings') {
    amount.value = ''
    walletRepayPercent.value = 0
    collateralAmount.value = ''
    debtAmount.value = ''
    repaySwapDirection.value = SwapperMode.EXACT_IN
  }
  else {
    amount.value = ''
    walletRepayPercent.value = 0
    savingsAmount.value = ''
    savingsDebtAmount.value = ''
    savingsDebtPercent.value = 0
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
  if (formTab.value !== 'collateral') {
    return
  }
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
  repayDebtPercent.value = amountNano > 0n
    ? Math.min(100, Math.max(0, Math.round(Number(amountNano * 100n / currentDebt))))
    : 0
})

const interval = setInterval(() => {
  updateBalance()
}, 5000)

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
              v-model="amount"
              label="Pay from wallet"
              :desc="name"
              :asset="position.borrow.asset"
              :vault="position.borrow"
              :balance="walletBalance"
              maxable
            />

            <AssetInput
              v-if="position.borrow.asset"
              v-model="amount"
              label="Debt to repay"
              :asset="position.borrow.asset"
              :vault="position.borrow"
              :balance="position.borrowed"
              maxable
            />

            <UiRange
              v-if="borrowVault"
              v-model="walletRepayPercent"
              label="Percent of debt to repay"
              :min="0"
              :max="100"
              :step="1"
              :number-filter="(n: number) => `${n}%`"
              @update:model-value="onWalletRepayPercentInput"
            />

            <UiToast
              v-show="estimatesError"
              title="Error"
              variant="error"
              :description="estimatesError"
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
            :loading="isEstimatesLoading"
            variant="card"
            class="w-full laptop:max-w-[360px]"
          >
            <SummaryRow label="Net APY">
              <SummaryValue
                :before="formatNumber(netAPY)"
                :after="formatNumber(estimateNetAPY)"
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
                :after="formatNumber(nanoToValue(estimateUserLTV, 18))"
                suffix="%"
              />
            </SummaryRow>
            <SummaryRow label="Health score">
              <SummaryValue
                :before="formatHealthScore(nanoToValue(position.health, 18))"
                :after="formatHealthScore(nanoToValue(estimateHealth, 18))"
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
              v-if="swapCollateralVault"
              v-model="collateralAmount"
              label="Collateral to swap"
              :desc="swapCollateralProduct.name"
              :asset="swapCollateralVault.asset"
              :vault="swapCollateralVault"
              :collateral-options="repayCollateralOptions"
              :balance="swapCollateralBalance"
              @input="onCollateralInput"
              @change-collateral="onSwapCollateralChange"
            />
            <AssetInput
              v-if="borrowVault"
              v-model="debtAmount"
              label="Debt to repay"
              :desc="name"
              :asset="borrowVault.asset"
              :vault="borrowVault"
              :balance="swapDebtBalance"
              maxable
              @input="onDebtInput"
            />
            <UiRange
              v-if="borrowVault"
              v-model="repayDebtPercent"
              label="Percent of debt to repay"
              :min="0"
              :max="100"
              :step="1"
              :number-filter="(n: number) => `${n}%`"
              @update:model-value="onRepayPercentInput"
            />

            <SwapRouteSelector
              v-if="!swapIsSameAsset"
              :items="swapRouteItems"
              :selected-provider="swapSelectedProvider"
              :status-label="swapQuotesStatusLabel"
              :is-loading="swapIsQuoteLoading"
              :empty-message="swapRouteEmptyMessage"
              @select="selectSwapProvider"
              @refresh="onRefreshSwapQuotes"
            />

            <UiToast
              v-if="swapQuoteError && !swapIsSameAsset"
              title="Swap quote"
              variant="warning"
              :description="swapQuoteError"
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
            :loading="!swapIsSameAsset && swapIsQuoteLoading"
            variant="card"
            class="w-full laptop:max-w-[360px]"
          >
            <SummaryRow label="ROE">
              <SummaryValue
                :before="swapRoeBefore !== null ? formatNumber(swapRoeBefore) : undefined"
                :after="swapRoeAfter !== null && (swapQuote || swapIsSameAsset) ? formatNumber(swapRoeAfter) : undefined"
                suffix="%"
              />
            </SummaryRow>
            <template v-if="!swapIsSameAsset">
              <SummaryRow label="Swap price" align-top>
                <SummaryPriceValue
                  :value="swapCurrentPrice ? formatSmartAmount(swapPriceInvert.invertValue(swapCurrentPrice.value)) : undefined"
                  :symbol="swapPriceInvert.displaySymbol"
                  invertible
                  @invert="swapPriceInvert.toggle"
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
                :before="swapCurrentLiquidationPrice !== null ? formatSmartAmount(swapPriceInvert.invertValue(swapCurrentLiquidationPrice)) : undefined"
                :after="swapNextLiquidationPrice !== null && (swapQuote || swapIsSameAsset) ? formatSmartAmount(swapPriceInvert.invertValue(swapNextLiquidationPrice)) : undefined"
                :symbol="swapPriceInvert.displaySymbol"
                invertible
                @invert="swapPriceInvert.toggle"
              />
            </SummaryRow>
            <SummaryRow label="LTV">
              <SummaryValue
                :before="swapCurrentLtv !== null ? formatNumber(swapCurrentLtv) : undefined"
                :after="swapNextLtv !== null && (swapQuote || swapIsSameAsset) ? formatNumber(swapNextLtv) : undefined"
                suffix="%"
              />
            </SummaryRow>
            <SummaryRow label="Health score">
              <SummaryValue
                :before="swapCurrentHealth !== null ? formatHealthScore(swapCurrentHealth) : undefined"
                :after="swapNextHealth !== null && (swapQuote || swapIsSameAsset) ? formatHealthScore(swapNextHealth) : undefined"
              />
            </SummaryRow>
            <template v-if="!swapIsSameAsset">
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
                  {{ swapPriceImpact !== null ? `${formatNumber(swapPriceImpact, 2, 2)}%` : '-' }}
                </p>
              </SummaryRow>
              <SummaryRow label="Leveraged price impact">
                <p class="text-p2">
                  {{ swapLeveragedPriceImpact !== null ? `${formatNumber(swapLeveragedPriceImpact, 2, 2)}%` : '-' }}
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
                  {{ swapRoutedVia || '-' }}
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
              :disabled-reason="swapDisabledReason"
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
              v-if="savingsVault"
              v-model="savingsAmount"
              label="Savings to use"
              :desc="savingsProduct.name"
              :asset="savingsVault.asset"
              :vault="savingsVault"
              :collateral-options="savingsOptions"
              :balance="savingsBalance"
              maxable
              @input="onSavingsAmountInput"
              @change-collateral="onSavingsVaultChange"
            />
            <AssetInput
              v-if="borrowVault"
              v-model="savingsDebtAmount"
              label="Debt to repay"
              :desc="name"
              :asset="borrowVault.asset"
              :vault="borrowVault"
              :balance="savingsDebtBalance"
              maxable
              @input="onSavingsDebtInput"
            />
            <UiRange
              v-if="borrowVault"
              v-model="savingsDebtPercent"
              label="Percent of debt to repay"
              :min="0"
              :max="100"
              :step="1"
              :number-filter="(n: number) => `${n}%`"
              @update:model-value="onSavingsPercentInput"
            />

            <SwapRouteSelector
              v-if="!savingsIsSameAsset"
              :items="savingsRouteItems"
              :selected-provider="savingsSelectedProvider"
              :status-label="savingsQuotesStatusLabel"
              :is-loading="savingsIsQuoteLoading"
              :empty-message="savingsProvidersCount ? 'No quotes found' : 'Enter amount to fetch quotes'"
              @select="selectSavingsProvider"
              @refresh="onRefreshSavingsQuotes"
            />

            <UiToast
              v-if="savingsQuoteError && !savingsIsSameAsset"
              title="Swap quote"
              variant="warning"
              :description="savingsQuoteError"
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
            :loading="!savingsIsSameAsset && savingsIsQuoteLoading"
            variant="card"
            class="w-full laptop:max-w-[360px]"
          >
            <template v-if="!savingsIsSameAsset">
              <SummaryRow label="Swap price" align-top>
                <SummaryPriceValue
                  :value="savingsSwapCurrentPrice ? formatSmartAmount(savingsPriceInvert.invertValue(savingsSwapCurrentPrice.value)) : undefined"
                  :symbol="savingsPriceInvert.displaySymbol"
                  invertible
                  @invert="savingsPriceInvert.toggle"
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
            <SummaryRow label="LTV">
              <SummaryValue
                :before="savingsCurrentLtv !== null ? formatNumber(savingsCurrentLtv) : undefined"
                :after="savingsNextLtv !== null && (savingsQuote || savingsIsSameAsset) ? formatNumber(savingsNextLtv) : undefined"
                suffix="%"
              />
            </SummaryRow>
            <SummaryRow label="Health score">
              <SummaryValue
                :before="savingsCurrentHealth !== null ? formatHealthScore(savingsCurrentHealth) : undefined"
                :after="savingsNextHealth !== null && (savingsQuote || savingsIsSameAsset) ? formatHealthScore(savingsNextHealth) : undefined"
              />
            </SummaryRow>
            <template v-if="!savingsIsSameAsset">
              <SummaryRow label="Swap" align-top>
                <p class="text-p2 text-right flex flex-col items-end">
                  <span>{{ savingsSwapSummary ? savingsSwapSummary.from : '-' }}</span>
                  <span
                    v-if="savingsSwapSummary"
                    class="text-content-tertiary text-p3"
                  >
                    {{ savingsSwapSummary.to }}
                  </span>
                </p>
              </SummaryRow>
              <SummaryRow label="Price impact">
                <p class="text-p2">
                  {{ savingsPriceImpact !== null ? `${formatNumber(savingsPriceImpact, 2, 2)}%` : '-' }}
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
                  {{ savingsRoutedVia || '-' }}
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
