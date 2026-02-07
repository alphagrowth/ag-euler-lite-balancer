<script setup lang="ts">
import { useAccount } from '@wagmi/vue'
import { type Address, zeroAddress } from 'viem'
import { FixedNumber, ethers } from 'ethers'
import { useModal } from '~/components/ui/composables/useModal'
import { OperationReviewModal, SlippageSettingsModal } from '#components'
import { useToast } from '~/components/ui/composables/useToast'
import { useEulerProductOfVault } from '~/composables/useEulerLabels'
import { getNetAPY, type VaultAsset, type Vault } from '~/entities/vault'
import { getAssetUsdValue, getAssetOraclePrice } from '~/services/pricing/priceProvider'
import type { AccountBorrowPosition } from '~/entities/account'
import type { TxPlan } from '~/entities/txPlan'
import { SwapperMode } from '~/entities/swap'
import { eulerAccountLensABI } from '~/entities/euler/abis'
import { useSwapCollateralOptions } from '~/composables/useSwapCollateralOptions'
import { useSwapQuotesParallel } from '~/composables/useSwapQuotesParallel'
import { useTermsOfUseGate } from '~/composables/useTermsOfUseGate'
import { getQuoteAmount } from '~/utils/swapQuotes'

const route = useRoute()
const router = useRouter()
const modal = useModal()
const { error } = useToast()
const { repay, fullRepay, buildRepayPlan, buildFullRepayPlan, buildSwapPlan, swap: executeSwap } = useEulerOperations()
const { isConnected, address } = useAccount()
const positionIndex = route.params.number as string
const { isPositionsLoading, isPositionsLoaded, updateBorrowPositions, getPositionBySubAccountIndex } = useEulerAccount()
const { getOpportunityOfBorrowVault, getOpportunityOfLendVault } = useMerkl()
const { withIntrinsicBorrowApy, withIntrinsicSupplyApy } = useIntrinsicApy()
const { eulerLensAddresses, isReady: isEulerAddressesReady, loadEulerConfig } = useEulerAddresses()
const { EVM_PROVIDER_URL } = useEulerConfig()
const { fetchSingleBalance } = useWallets()
const walletBalance = ref(0n)
const { runSimulation, simulationError, clearSimulationError } = useTxPlanSimulation()
const { slippage } = useSlippage()
const { getSubmitLabel, getSubmitDisabled, guardWithTerms } = useTermsOfUseGate()

const isLoading = ref(false)
const isSubmitting = ref(false)
const isEstimatesLoading = ref(false)
const amount = ref('')
const formTab = ref<'wallet' | 'collateral'>('wallet')
const collateralAmount = ref('')
const debtAmount = ref('')
const repaySwapDirection = ref(SwapperMode.EXACT_IN)
const repayDebtPercent = ref(0)
const plan = ref<TxPlan | null>(null)
const balance = ref(0n)
const position: Ref<AccountBorrowPosition | undefined> = ref()
const estimateNetAPY = ref(0)
const estimateUserLTV = ref(0n)
const estimateHealth = ref(0n)
const estimatesError = ref('')

const formTabs = computed(() => [
  { label: 'From wallet', value: 'wallet' },
  { label: 'Swap collateral', value: 'collateral' },
])

const borrowVault = computed(() => position.value?.borrow)
const collateralVault = computed(() => position.value?.collateral)
const assets = computed(() => [collateralVault.value?.asset, borrowVault.value?.asset])
const swapCollateralVault: Ref<Vault | undefined> = ref()
const swapCollateralAssets = ref(0n)
const swapCollateralBalance = computed(() => swapCollateralAssets.value)
const swapDebtBalance = computed(() => position.value?.borrowed || 0n)
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
  if (swapQuoteError.value) {
    return true
  }
  if (!swapSelectedQuote.value) {
    return true
  }
  return false
})
const reviewRepayLabel = getSubmitLabel('Review Repay')
const reviewRepayDisabled = getSubmitDisabled(computed(() => {
  return formTab.value === 'wallet' ? isSubmitDisabled.value : isSwapSubmitDisabled.value
}))
const opportunityInfoForBorrow = computed(() => getOpportunityOfBorrowVault(borrowVault.value?.asset.address || ''))
const opportunityInfoForCollateral = computed(() => getOpportunityOfLendVault(collateralVault.value?.address || ''))
const collateralSupplyApy = computed(() => withIntrinsicSupplyApy(
  nanoToValue(collateralVault.value?.interestRateInfo.supplyAPY || 0n, 25),
  collateralVault.value?.asset.symbol,
))
const borrowApy = computed(() => withIntrinsicBorrowApy(
  nanoToValue(borrowVault.value?.interestRateInfo.borrowAPY || 0n, 25),
  borrowVault.value?.asset.symbol,
))
// Pre-computed net APY (async)
const netAPY = ref(0)

watchEffect(async () => {
  if (!position.value || !collateralVault.value || !borrowVault.value) {
    netAPY.value = 0
    return
  }

  const [supplyUsdRaw, borrowUsdRaw] = await Promise.all([
    getAssetUsdValue(position.value.supplied || 0n, collateralVault.value, 'off-chain'),
    getAssetUsdValue(position.value.borrowed ?? 0n, borrowVault.value, 'off-chain'),
  ])
  const supplyUsd = supplyUsdRaw ?? 0
  const borrowUsd = borrowUsdRaw ?? 0

  netAPY.value = getNetAPY(
    supplyUsd,
    collateralSupplyApy.value,
    borrowUsd,
    borrowApy.value,
    opportunityInfoForCollateral.value?.apr || null,
    opportunityInfoForBorrow.value?.apr || null,
  )
})

const swapperMode = computed(() => repaySwapDirection.value)

const getCurrentDebt = () => position.value?.borrowed || 0n
const amountFixed = computed(() => FixedNumber.fromValue(
  valueToNano(amount.value || '0', borrowVault.value?.decimals),
  Number(borrowVault.value?.decimals),
))
const borrowedFixed = computed(() => FixedNumber.fromValue(position.value?.borrowed || 0n, position.value?.borrow.decimals || 18))
const suppliedFixed = computed(() => FixedNumber.fromValue(position.value?.supplied || 0n, position.value?.collateral.decimals || 18))
const priceFixed = computed(() => FixedNumber.fromValue(position.value?.price || 0n, 18))
const balanceFixed = computed(() => FixedNumber.fromValue(balance.value, borrowVault.value?.decimals || 18))
const liquidationPrice = computed(() => {
  if (nanoToValue(position.value?.health || 0n, 18) < 0.1) {
    return Infinity
  }
  return nanoToValue(position.value?.price || 0n, 18) / nanoToValue(position.value?.health || 1n, 18)
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

  try {
    position.value = getPositionBySubAccountIndex(+positionIndex)
    // Fetch fresh wallet balance for this specific asset
    await fetchWalletBalance()
    await updateBalance()
    estimateNetAPY.value = netAPY.value
    estimateUserLTV.value = position.value?.userLTV || 0n
    estimateHealth.value = position.value?.health || 0n
    swapCollateralVault.value = position.value?.collateral
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
    const provider = ethers.getDefaultProvider(EVM_PROVIDER_URL)
    const accountLensContract = new ethers.Contract(lensAddress, eulerAccountLensABI, provider)
    const res = await accountLensContract.getVaultAccountInfo(position.value.subAccount, swapCollateralVault.value.address)
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
    return ethers.getAddress(address)
  }
  catch {
    return ''
  }
}

const { collateralOptions: swapCollateralOptions, collateralVaults: swapCollateralVaults } = useSwapCollateralOptions({
  currentVault: computed(() => undefined),
  liabilityVault: computed(() => borrowVault.value as typeof borrowVault.value),
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
  const opportunity = getOpportunityOfLendVault(swapCollateralVault.value.address)
  return withIntrinsicSupplyApy(base, swapCollateralVault.value.asset.symbol) + (opportunity?.apr || 0)
})
const swapBorrowApy = computed(() => {
  if (!borrowVault.value) {
    return null
  }
  const base = nanoToValue(borrowVault.value.interestRateInfo.borrowAPY || 0n, 25)
  const opportunity = getOpportunityOfBorrowVault(borrowVault.value.asset.address || '')
  return withIntrinsicBorrowApy(base, borrowVault.value.asset.symbol) - (opportunity?.apr || 0)
})

const swapCollateralSpent = computed(() => {
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
  const ask = collateralPrice?.amountOutAsk || 0n
  const bid = borrowPrice?.amountOutBid || 0n
  if (!ask || !bid) {
    return null
  }
  return nanoToValue(ask, 18) / nanoToValue(bid, 18)
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
  if (!swapBorrowAmountAfter.value || !swapCollateralAmountAfter.value || !swapPriceRatio.value) {
    return null
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
  if (!swapNextLiquidationLtv.value || !swapNextLtv.value) {
    return null
  }
  if (swapNextLtv.value <= 0) {
    return null
  }
  return swapNextLiquidationLtv.value / swapNextLtv.value
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
  const amountOut = Number(ethers.formatUnits(BigInt(swapQuote.value.amountOut), Number(borrowVault.value.asset.decimals)))
  const amountIn = Number(ethers.formatUnits(BigInt(swapQuote.value.amountIn), Number(swapCollateralVault.value.asset.decimals)))
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
  const amountIn = ethers.formatUnits(BigInt(swapQuote.value.amountIn), Number(swapCollateralVault.value.asset.decimals))
  const amountOut = ethers.formatUnits(BigInt(swapQuote.value.amountOut), Number(borrowVault.value.asset.decimals))
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
    const symbol = isExactIn ? borrowVault.value.asset.symbol : swapCollateralVault.value.asset.symbol
    const amountLabel = formatSignificant(
      ethers.formatUnits(amount, Number(isExactIn ? borrowVault.value.asset.decimals : swapCollateralVault.value.asset.decimals)),
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
  debtAmount.value = ethers.formatUnits(amountNano, Number(borrowVault.value.asset.decimals))
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
    swapCollateralVault.value = nextVault
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
    if (repaySwapDirection.value === SwapperMode.EXACT_IN && collateralAmount.value) {
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
    debtAmount.value = ethers.formatUnits(
      BigInt(swapEffectiveQuote.value.amountOut || 0),
      Number(borrowVault.value.asset.decimals),
    )
    debtAmount.value = formatSignificant(debtAmount.value)
  }
  else {
    collateralAmount.value = ethers.formatUnits(
      BigInt(swapEffectiveQuote.value.amountIn || 0),
      Number(swapCollateralVault.value.asset.decimals),
    )
    collateralAmount.value = formatSignificant(collateralAmount.value)
  }
})
const updateBalance = async () => {
  if (!isConnected.value || !position.value || !borrowVault.value) {
    balance.value = 0n
    return
  }

  const borrowedUsd = (await getAssetUsdValue(position.value.borrowed, borrowVault.value, 'off-chain')) ?? 0.01
  const factor = Math.pow(10, 2)
  const borrowedRounded = Math.ceil(borrowedUsd * factor) / factor
  balance.value = FixedNumber.fromValue(valueToNano(borrowedRounded, 4), 4)
    .div(FixedNumber.fromValue(borrowVault.value.liabilityPriceInfo.amountOutMid, Number(borrowVault.value.decimals)))
    .value
}
const submit = async () => {
  if (!position.value || !borrowVault.value || !collateralVault.value) {
    return
  }

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

const onSubmitForm = async () => {
  await guardWithTerms(async () => {
    if (formTab.value === 'wallet') {
      await submit()
    }
    else {
      await submitSwap()
    }
  })
}

const submitSwap = async () => {
  if (isSubmitting.value || !position.value || !borrowVault.value || !swapCollateralVault.value) {
    return
  }
  if (!swapSelectedQuote.value) {
    return
  }

  const currentDebt = getCurrentDebt()
  const swapMode = swapperMode.value
  let targetDebt = 0n
  if (swapMode === SwapperMode.TARGET_DEBT && debtAmount.value) {
    const debtAmountNano = valueToNano(debtAmount.value, borrowVault.value.asset.decimals)
    targetDebt = debtAmountNano >= currentDebt ? 0n : currentDebt - debtAmountNano
  }

  try {
    plan.value = await buildSwapPlan({
      quote: swapSelectedQuote.value,
      swapperMode: swapMode,
      isRepay: true,
      targetDebt,
      currentDebt,
      liabilityVault: borrowVault.value?.address,
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

const sendSwap = async () => {
  if (!position.value || !borrowVault.value) {
    return
  }
  if (!swapSelectedQuote.value) {
    return
  }
  try {
    isSubmitting.value = true
    const currentDebt = getCurrentDebt()
    const swapMode = swapperMode.value
    let targetDebt = 0n
    if (swapMode === SwapperMode.TARGET_DEBT && debtAmount.value) {
      const debtAmountNano = valueToNano(debtAmount.value, borrowVault.value.asset.decimals)
      targetDebt = debtAmountNano >= currentDebt ? 0n : currentDebt - debtAmountNano
    }

    await executeSwap({
      quote: swapSelectedQuote.value,
      swapperMode: swapMode,
      isRepay: true,
      targetDebt,
      currentDebt,
      liabilityVault: borrowVault.value?.address,
    })

    modal.close()
    updateBorrowPositions(eulerLensAddresses.value, address.value as string)
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

    const method = balance.value <= valueToNano(amount.value, borrowVault.value.asset.decimals)
      ? fullRepay
      : repay

    await method(
      borrowVault.value.address,
      borrowVault.value.asset.address,
      valueToNano(amount.value, borrowVault.value.asset.decimals),
      position.value.subAccount,
      position.value.collaterals ?? [collateralVault.value.address],
    )

    modal.close()
    updateBorrowPositions(eulerLensAddresses.value, address.value as string)
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
    if (balanceFixed.value.lt(amountFixed.value)) {
      throw new Error('You repaying more than required')
    }
    const [supplyUsdRaw, borrowUsdRaw] = await Promise.all([
      getAssetUsdValue((position.value.supplied || 0n), collateralVault.value, 'off-chain'),
      getAssetUsdValue((position.value.borrowed || 0n) - valueToNano(amount.value, borrowVault.value.decimals), borrowVault.value, 'off-chain'),
    ])
    const supplyUsd = supplyUsdRaw ?? 0
    const borrowUsd = borrowUsdRaw ?? 0
    estimateNetAPY.value = getNetAPY(
      supplyUsd,
      collateralSupplyApy.value, // TODO: consider calculated supplyAPY after withdraw
      borrowUsd,
      borrowApy.value,
      opportunityInfoForCollateral.value?.apr || null,
      opportunityInfoForBorrow.value?.apr || null,
    )
    const collateralValue = (suppliedFixed.value).mul(priceFixed.value)
    const userLtvFixed = collateralValue.isZero()
      ? FixedNumber.fromValue(0n, 18)
      : (borrowedFixed.value.sub(amountFixed.value))
          .div(collateralValue)
          .mul(FixedNumber.fromValue(100n))
    estimateUserLTV.value = userLtvFixed.value
    estimateHealth.value = (userLtvFixed.isZero() || userLtvFixed.isNegative())
      ? 0n
      : FixedNumber.fromValue(position.value!.liquidationLTV, 2).div(userLtvFixed).value

    if (userLtvFixed.gte(FixedNumber.fromValue(position.value!.liquidationLTV, 2))) {
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
watch(amount, async () => {
  clearSimulationError()
  if (formTab.value !== 'wallet') {
    return
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
  if (formTab.value === 'wallet') {
    collateralAmount.value = ''
    debtAmount.value = ''
    repaySwapDirection.value = SwapperMode.EXACT_IN
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
      <div class="flex justify-between">
        <VaultLabelsAndAssets
          :vault="position.borrow"
          :assets="assets as VaultAsset[]"
          size="large"
        />
      </div>

      <UiTabs
        v-model="formTab"
        class="mb-12"
        rounded
        pills
        :list="formTabs"
      />

      <template v-if="formTab === 'wallet'">
        <AssetInput
          v-if="position.borrow.asset"
          v-model="amount"
          label="Deposit amount"
          :desc="name"
          :asset="position.borrow.asset"
          :vault="position.borrow"
          :balance="balance"
          maxable
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

        <VaultFormInfoBlock
          v-if="collateralVault && borrowVault"
          :loading="isEstimatesLoading"
          class="flex flex-col gap-16"
        >
          <div class="flex justify-between items-center flex-wrap gap-8">
            <p class="text-content-tertiary">
              Net APY
            </p>

            <p
              v-if="netAPY !== estimateNetAPY"
              class="text-p2 text-content-tertiary"
            >
              {{ formatNumber(netAPY) }}% → <span class="text-content-primary">{{ formatNumber(estimateNetAPY) }}%</span>
            </p>
            <p
              v-else
              class="text-p2 text-content-primary"
            >
              {{ formatNumber(netAPY) }}%
            </p>
          </div>
          <div class="flex justify-between items-center flex-wrap gap-8">
            <p class="text-content-tertiary">
              Current price
            </p>
            <p class="text-p2 flex items-center gap-4">
              ${{ formatNumber(nanoToValue(position.price, 18)) }}
              <span class="text-content-tertiary text-p3">
                {{ collateralVault.asset.symbol }}/{{ borrowVault.asset.symbol }}
              </span>
            </p>
          </div>
          <div class="flex justify-between items-center flex-wrap gap-8">
            <p class="text-content-tertiary">
              Liquidation price
            </p>
            <p class="text-p2 flex items-center gap-4">
              ${{ formatNumber(liquidationPrice) }}
              <span class="text-content-tertiary text-p3">
                {{ collateralVault.asset.symbol }}
              </span>
            </p>
          </div>
          <div class="flex justify-between items-center flex-wrap gap-8">
            <p class="text-content-tertiary">
              Your LTV (LLTV)
            </p>
            <p
              v-if="position.userLTV !== estimateUserLTV"
              class="text-p2 text-content-tertiary"
            >
              {{ formatNumber(nanoToValue(position.userLTV, 18)) }}%
              <span class="text-p3">
                ({{ formatNumber(nanoToValue(position.liquidationLTV, 2)) }}%)
              </span>
              → <span class="text-content-primary">
                {{ formatNumber(nanoToValue(estimateUserLTV, 18)) }}%
                <span class="text-content-tertiary text-p3">
                  ({{ formatNumber(nanoToValue(position.liquidationLTV, 2)) }}%)
                </span>
              </span>
            </p>
            <p
              v-else
              class="text-p2 flex items-center gap-4"
            >
              {{ formatNumber(nanoToValue(position.userLTV, 18)) }}%
              <span class="text-content-tertiary text-p3">
                ({{ formatNumber(nanoToValue(position.liquidationLTV, 2)) }}%)
              </span>
            </p>
          </div>
          <div class="flex justify-between items-center flex-wrap gap-8">
            <p class="text-content-tertiary">
              Your health
            </p>

            <p
              v-if="position.health !== estimateHealth"
              class="text-p2 text-content-tertiary"
            >
              {{ formatNumber(nanoToValue(position.health, 18)) }} → <span class="text-content-primary">{{ formatNumber(nanoToValue(estimateHealth, 18)) }}</span>
            </p>
            <p
              v-else
              class="text-p2 text-content-primary"
            >
              {{ formatNumber(nanoToValue(position.health, 18)) }}
            </p>
          </div>
        </VaultFormInfoBlock>
      </template>

      <template v-else>
        <AssetInput
          v-if="swapCollateralVault"
          v-model="collateralAmount"
          label="Collateral to swap"
          :desc="swapCollateralProduct.name"
          :asset="swapCollateralVault.asset"
          :vault="swapCollateralVault"
          :collateral-options="repayCollateralOptions"
          :balance="swapCollateralBalance"
          maxable
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
          :items="swapRouteItems"
          :selected-provider="swapSelectedProvider"
          :status-label="swapQuotesStatusLabel"
          :is-loading="swapIsQuoteLoading"
          :empty-message="swapRouteEmptyMessage"
          @select="selectSwapProvider"
        />

        <UiToast
          v-if="swapQuoteError"
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

        <VaultFormInfoBlock
          :loading="swapIsQuoteLoading"
          class="bg-surface-secondary p-16 rounded-16 flex flex-col gap-16 w-full shadow-card"
        >
          <div class="flex justify-between items-center">
            <p class="text-content-tertiary">
              ROE
            </p>
            <p class="text-p2">
              <template v-if="swapRoeBefore !== null && swapRoeAfter !== null && swapQuote">
                <span class="text-content-tertiary">{{ formatNumber(swapRoeBefore) }}%</span>
                → <span class="text-content-primary">{{ formatNumber(swapRoeAfter) }}%</span>
              </template>
              <template v-else>
                {{ swapRoeBefore !== null ? `${formatNumber(swapRoeBefore)}%` : '-' }}
              </template>
            </p>
          </div>
          <div class="flex justify-between items-center">
            <p class="text-content-tertiary">
              Current price
            </p>
            <p class="text-p2">
              {{ swapCurrentPrice ? `${formatNumber(swapCurrentPrice.value)} ${swapCurrentPrice.symbol}` : '-' }}
            </p>
          </div>
          <div class="flex justify-between items-center">
            <p class="text-content-tertiary">
              Liquidation price
            </p>
            <p class="text-p2">
              <template v-if="swapCurrentLiquidationPrice !== null && swapNextLiquidationPrice !== null && swapQuote">
                <span class="text-content-tertiary">{{ formatNumber(swapCurrentLiquidationPrice, 4) }}</span>
                → <span class="text-content-primary">{{ formatNumber(swapNextLiquidationPrice, 4) }}</span>
              </template>
              <template v-else>
                {{ swapCurrentLiquidationPrice !== null ? `${formatNumber(swapCurrentLiquidationPrice, 4)} ` : '-' }}
              </template>
              <span class="text-content-tertiary text-p3">
                {{ swapCollateralVault?.asset.symbol }}
              </span>
            </p>
          </div>
          <div class="flex justify-between items-center">
            <p class="text-content-tertiary">
              Your LTV (LLTV)
            </p>
            <p class="text-p2 text-right">
              <template v-if="swapCurrentLtv !== null && swapCurrentLiquidationLtv !== null && swapNextLtv !== null && swapNextLiquidationLtv !== null && swapQuote">
                <span class="text-content-tertiary">
                  {{ formatNumber(swapCurrentLtv) }}%
                  <span class="text-content-tertiary text-p3">
                    ({{ formatNumber(swapCurrentLiquidationLtv) }}%)
                  </span>
                </span>
                → <span class="text-content-primary">
                  {{ formatNumber(swapNextLtv) }}%
                  <span class="text-content-tertiary text-p3">
                    ({{ formatNumber(swapNextLiquidationLtv) }}%)
                  </span>
                </span>
              </template>
              <template v-else>
                <span v-if="swapCurrentLtv !== null && swapCurrentLiquidationLtv !== null">
                  {{ formatNumber(swapCurrentLtv) }}%
                  <span class="text-content-tertiary text-p3">
                    ({{ formatNumber(swapCurrentLiquidationLtv) }}%)
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
              <template v-if="swapCurrentHealth !== null && swapNextHealth !== null && swapQuote">
                <span class="text-content-tertiary">{{ formatNumber(swapCurrentHealth, 2) }}</span>
                → <span class="text-content-primary">{{ formatNumber(swapNextHealth, 2) }}</span>
              </template>
              <template v-else>
                {{ swapCurrentHealth !== null ? formatNumber(swapCurrentHealth, 2) : '-' }}
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
              {{ swapPriceImpact !== null ? `${formatNumber(swapPriceImpact, 2, 2)}%` : '-' }}
            </p>
          </div>
          <div class="flex justify-between items-center">
            <p class="text-content-tertiary">
              Leveraged price impact
            </p>
            <p class="text-p2">
              {{ swapLeveragedPriceImpact !== null ? `${formatNumber(swapLeveragedPriceImpact, 2, 2)}%` : '-' }}
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
              {{ swapRoutedVia || '-' }}
            </p>
          </div>
        </VaultFormInfoBlock>
      </template>
    </template>

    <template #buttons>
      <VaultFormInfoButton
        :pair="position"
        :disabled="isLoading || isSubmitting"
      >
        Pair information
      </VaultFormInfoButton>
      <VaultFormSubmit
        v-if="formTab === 'wallet'"
        :disabled="reviewRepayDisabled"
        :loading="isSubmitting"
      >
        {{ reviewRepayLabel }}
      </VaultFormSubmit>
      <VaultFormSubmit
        v-else
        :disabled="reviewRepayDisabled"
        :loading="isSubmitting"
      >
        {{ reviewRepayLabel }}
      </VaultFormSubmit>
    </template>
  </VaultForm>
</template>
