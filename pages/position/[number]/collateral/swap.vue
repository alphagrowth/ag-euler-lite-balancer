<script setup lang="ts">
import { useAccount } from '@wagmi/vue'
import { getAddress, formatUnits, isAddress, zeroAddress, type Address, type Abi } from 'viem'
import { getPublicClient } from '~/utils/public-client'
import { OperationReviewModal, SlippageSettingsModal } from '#components'
import { useTermsOfUseGate } from '~/composables/useTermsOfUseGate'
import type { AccountBorrowPosition } from '~/entities/account'
import { eulerAccountLensABI } from '~/entities/euler/abis'
import {
  type Vault,
  type SecuritizeVault,
  type VaultAsset,
} from '~/entities/vault'
import {
  getAssetUsdValue,
  getAssetOraclePrice,
  getCollateralOraclePrice,
  getCollateralUsdPrice,
  conservativePriceRatioNumber,
  getCollateralUsdValueOrZero,
} from '~/services/pricing/priceProvider'
import { useEulerProductOfVault } from '~/composables/useEulerLabels'
import { isAnyVaultBlockedByCountry, getVaultTags } from '~/composables/useGeoBlock'
import { useSwapCollateralOptions } from '~/composables/useSwapCollateralOptions'
import { useSwapQuotesParallel } from '~/composables/useSwapQuotesParallel'
import { SwapperMode } from '~/entities/swap'
import { getQuoteAmount } from '~/utils/swapQuotes'
import type { TxPlan } from '~/entities/txPlan'
import { useModal } from '~/components/ui/composables/useModal'
import { useToast } from '~/components/ui/composables/useToast'
import { useIntrinsicApy } from '~/composables/useIntrinsicApy'
import { useVaultRegistry } from '~/composables/useVaultRegistry'
import { formatNumber, formatSmartAmount, formatHealthScore } from '~/utils/string-utils'
import { nanoToValue } from '~/utils/crypto-utils'
import { isSameUnderlyingAsset, isSameVault as isSameVaultCheck } from '~/utils/vault-utils'

const route = useRoute()
const router = useRouter()
const { isConnected, address } = useAccount()
const { isPositionsLoaded, isPositionsLoading, getPositionBySubAccountIndex } = useEulerAccount()
const { buildSwapPlan, buildSameAssetSwapPlan, executeTxPlan } = useEulerOperations()
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
const { isReady: isVaultsReady } = useVaults()
const { getOrFetch } = useVaultRegistry()
const { eulerLensAddresses, isReady: isEulerAddressesReady, loadEulerConfig } = useEulerAddresses()
const { EVM_PROVIDER_URL } = useEulerConfig()

const openSlippageSettings = () => {
  modal.open(SlippageSettingsModal)
}

const swapPriceInvert = usePriceInvert(
  () => fromVault.value?.asset.symbol,
  () => toVault.value?.asset.symbol,
)
const liqPriceInvert = usePriceInvert(
  () => toVault.value?.asset.symbol,
  () => borrowVault.value?.asset.symbol,
)

const positionIndex = route.params.number as string

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
  if (!isConnected.value) {
    position.value = null
    return
  }
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
    return getAddress(addr)
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

    // Use unified vault resolution - handles EVK, escrow, and securitize vaults
    const vault = await getOrFetch(targetAddress) as Vault | SecuritizeVault | undefined
    selectedCollateral.value = vault || null

    const lensAddress = eulerLensAddresses.value?.accountLens
    if (!lensAddress) {
      throw new Error('Account lens address is not available')
    }

    const client = getPublicClient(EVM_PROVIDER_URL)
    const res = await client.readContract({
      address: lensAddress as Address,
      abi: eulerAccountLensABI as Abi,
      functionName: 'getVaultAccountInfo',
      args: [position.value.subAccount, targetAddress],
    }) as Record<string, any>
    selectedCollateralAssets.value = res.assets
  }
  catch (e) {
    console.warn('[Collateral swap] failed to load collateral', e)
    if (!selectedCollateral.value) {
      selectedCollateral.value = position.value.collateral
    }
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
    || collateralVaults.value.find(v => !getVaultTags(v.address, 'swap-target').disabled)
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
const balance = computed(() => selectedCollateralAssets.value)

const resetQuoteState = () => {
  resetQuoteStateInternal()
  toAmount.value = ''
}

const onRefreshQuotes = () => {
  resetQuoteState()
  isQuoteLoading.value = true
  requestQuote()
}

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
const borrowApy = computed(() => {
  if (!borrowVault.value) {
    return null
  }
  const base = nanoToValue(borrowVault.value.interestRateInfo.borrowAPY || 0n, 25)
  return withIntrinsicBorrowApy(base, borrowVault.value.asset.symbol) - getBorrowRewardApy(borrowVault.value.address, fromVault.value?.address)
})

// Get collateral USD value using liability vault's price perspective
const getCollateralValueUsdLocal = async (amount: bigint) => {
  if (!borrowVault.value || !fromVault.value) return 0
  return getCollateralUsdValueOrZero(amount, borrowVault.value, fromVault.value as Vault, 'off-chain')
}
// Price per unit for collateral in USD (from liability vault's perspective)
const collateralPricePerUnit = ref<number | undefined>(undefined)
watchEffect(async () => {
  if (!borrowVault.value || !fromVault.value) {
    collateralPricePerUnit.value = undefined
    return
  }
  const priceInfo = await getCollateralUsdPrice(borrowVault.value, fromVault.value as Vault, 'off-chain')
  if (!priceInfo?.amountOutMid) {
    collateralPricePerUnit.value = undefined
    return
  }
  collateralPricePerUnit.value = nanoToValue(priceInfo.amountOutMid, 18)
})
const supplyValueUsd = ref<number | null>(null)
watchEffect(async () => {
  if (!fromVault.value || !position.value || !borrowVault.value) {
    supplyValueUsd.value = null
    return
  }
  supplyValueUsd.value = await getCollateralValueUsdLocal(selectedCollateralAssets.value)
})
const nextSupplyValueUsd = ref<number | null>(null)
watchEffect(async () => {
  if (isSameAsset.value && toVault.value && fromAmount.value) {
    try {
      const amount = valueToNano(fromAmount.value, toVault.value.asset.decimals)
      nextSupplyValueUsd.value = (await getAssetUsdValue(amount, toVault.value, 'off-chain')) ?? null
    }
    catch {
      nextSupplyValueUsd.value = null
    }
    return
  }
  if (!quote.value || !toVault.value) {
    nextSupplyValueUsd.value = null
    return
  }
  nextSupplyValueUsd.value = (await getAssetUsdValue(BigInt(quote.value.amountOut), toVault.value, 'off-chain')) ?? null
})
const borrowValueUsd = ref<number | null>(null)
watchEffect(async () => {
  if (!borrowVault.value || !position.value) {
    borrowValueUsd.value = null
    return
  }
  borrowValueUsd.value = (await getAssetUsdValue(position.value.borrowed, borrowVault.value, 'off-chain')) ?? null
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
  const collateralPrice = getCollateralOraclePrice(borrowVault.value, toVault.value)
  const borrowPrice = getAssetOraclePrice(borrowVault.value)
  return conservativePriceRatioNumber(collateralPrice, borrowPrice)
})
const nextCollateralAmount = computed(() => {
  if (isSameAsset.value && toVault.value && fromAmount.value) {
    try {
      return nanoToValue(valueToNano(fromAmount.value, toVault.value.asset.decimals), toVault.value.decimals)
    }
    catch {
      return null
    }
  }
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
const currentPriceRatio = computed(() => {
  if (!fromVault.value || !borrowVault.value) {
    return null
  }
  const collateralPrice = getCollateralOraclePrice(borrowVault.value, fromVault.value as Vault)
  const borrowPrice = getAssetOraclePrice(borrowVault.value)
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
    from: `${formatSignificant(amountIn)} ${fromVault.value.asset.symbol}`,
    to: `${formatSignificant(amountOut)} ${toVault.value.asset.symbol}`,
  }
})

const priceImpact = ref<number | null>(null)
watchEffect(async () => {
  if (!quote.value || !fromVault.value || !toVault.value || !borrowVault.value) {
    priceImpact.value = null
    return
  }
  const amountInUsd = await getCollateralValueUsdLocal(BigInt(quote.value.amountIn))
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
const isMaxSwap = computed(() => {
  if (!fromVault.value?.asset || !fromAmount.value) return false
  try {
    const amount = valueToNano(fromAmount.value, fromVault.value.asset.decimals)
    return balance.value > 0n && amount >= balance.value
  }
  catch {
    return false
  }
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
const isGeoBlocked = computed(() => {
  const addresses: string[] = []
  if (fromVault.value) addresses.push(fromVault.value.address)
  if (borrowVault.value) addresses.push(borrowVault.value.address)
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
  clearSimulationError()
  const nextVault = collateralVaults.value[selectedIndex]
  if (!nextVault) {
    return
  }
  if (!toVault.value || normalizeAddress(toVault.value.address) !== normalizeAddress(nextVault.address)) {
    toVault.value = nextVault
  }
}

const buildPlan = async (): Promise<TxPlan> => {
  if (!fromVault.value || !toVault.value || !position.value) {
    throw new Error('Vaults or position not loaded')
  }

  if (isSameAsset.value) {
    const amount = valueToNano(fromAmount.value, fromVault.value.asset.decimals)
    return buildSameAssetSwapPlan({
      fromVaultAddress: fromVault.value.address,
      toVaultAddress: toVault.value.address,
      amount,
      isMax: isMaxSwap.value,
      subAccount: position.value.subAccount,
      enableCollateral: true,
      disableCollateral: isMaxSwap.value,
      liabilityVault: borrowVault.value?.address,
      enabledCollaterals: position.value.collaterals,
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
    enableCollateral: true,
    disableCollateral: isMaxSwap.value ? fromVault.value.address : undefined,
    liabilityVault: borrowVault.value?.address,
    enabledCollaterals: position.value.collaterals,
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
              :vault="isFromSecuritize ? undefined : (fromVault as Vault)"
              :balance="balance"
              :price-override="isFromSecuritize ? collateralPricePerUnit : undefined"
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
                :loading="isSubmitting || isPreparing"
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
                :after="roeAfter !== null && (quote || isSameAsset) ? formatNumber(roeAfter) : undefined"
                suffix="%"
              />
            </SummaryRow>
            <template v-if="!isSameAsset">
              <SummaryRow label="Swap price" align-top>
                <SummaryPriceValue
                  :value="currentPrice ? formatSmartAmount(swapPriceInvert.invertValue(currentPrice.value)) : undefined"
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
            <SummaryRow label="Liquidation price" align-top>
              <SummaryPriceValue
                :before="liqPriceInvert.invertValue(currentLiquidationPrice) != null ? formatSmartAmount(liqPriceInvert.invertValue(currentLiquidationPrice)!) : undefined"
                :after="nextLiquidationPrice !== null && (quote || isSameAsset) ? formatSmartAmount(liqPriceInvert.invertValue(nextLiquidationPrice)) : undefined"
                :symbol="liqPriceInvert.displaySymbol"
                invertible
                @invert="liqPriceInvert.toggle"
              />
            </SummaryRow>
            <SummaryRow label="LTV">
              <SummaryValue
                :before="currentLtv !== null ? formatNumber(currentLtv) : undefined"
                :after="nextLtv !== null && (quote || isSameAsset) ? formatNumber(nextLtv) : undefined"
                suffix="%"
              />
            </SummaryRow>
            <SummaryRow label="Health score">
              <SummaryValue
                :before="currentHealth !== null ? formatHealthScore(currentHealth) : undefined"
                :after="nextHealth !== null && (quote || isSameAsset) ? formatHealthScore(nextHealth) : undefined"
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
