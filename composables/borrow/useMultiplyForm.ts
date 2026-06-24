import type { Ref, ComputedRef } from 'vue'
import { useAccount, useConfig } from '@wagmi/vue'
import { formatUnits, type Address } from 'viem'
import { logWarn } from '~/utils/errorHandling'
import { normalizeAddressOrEmpty } from '~/utils/accountPositionHelpers'
import { useModal } from '~/components/ui/composables/useModal'
import { OperationReviewModal } from '#components'
import { useToast } from '~/components/ui/composables/useToast'
import {
  type AnyBorrowVaultPair,
  type Vault,
  type VaultAsset,
  type CollateralOption,
  convertAssetsToShares,
} from '~/entities/vault'
import {
  getAssetUsdValue,
  getAssetUsdValueOrZero,
  getCollateralUsdValueOrZero,
  getAssetOraclePrice,
  getCollateralOraclePrice,
  getCollateralShareOraclePrice,
  conservativePriceRatioNumber,
} from '~/services/pricing/priceProvider'
import { type SwapApiQuote, SwapperMode } from '~/entities/swap'
import { buildSwapRouteItems } from '~/utils/swapRouteItems'
import { formatSmartAmount, trimTrailingZeros } from '~/utils/string-utils'
import { nanoToValue } from '~/utils/crypto-utils'
import { getDisplayAssetSymbol } from '~/utils/asset-display'
import { useMultiplyPriceImpact } from '~/composables/borrow/useMultiplyPriceImpact'
import { calculateRoe, computeNextHealth, computeLiquidationPrice } from '~/utils/repayUtils'
import { computeMaxMultiplier, computeMinMultiplier, computeWeightedSupplyApy, computeLeverageDebt } from '~/utils/multiply-math'
import type { TxPlan } from '~/entities/txPlan'
import { getUtilisationWarning, getBorrowCapWarning } from '~/composables/useVaultWarnings'
import { isOperationBlocked } from '~/utils/operationGuardRegistry'
import { useMultiplyCollateralOptions } from '~/composables/useMultiplyCollateralOptions'
import { useSwapQuotesParallel } from '~/composables/useSwapQuotesParallel'
import { useEulerProductOfVault } from '~/composables/useEulerLabels'
import { useEnsoRoute, encodeAdapterZapIn, previewAdapterZapIn, type BptAdapterConfigEntry } from '~/composables/useEnsoRoute'
import type { WrapperRouteConfig } from '~/entities/wrapperRoutes'

type MultiplyPlanParams = {
  supplyVaultAddress: string
  supplyAssetAddress: string
  supplyAmount: bigint
  supplySharesAmount?: bigint
  supplyIsSavings?: boolean
  supplyQuote?: SwapApiQuote
  longVaultAddress: string
  longAssetAddress: string
  borrowVaultAddress: string
  debtAmount: bigint
  quote?: SwapApiQuote
  swapperMode: SwapperMode
  subAccount: string
}

export interface UseMultiplyFormOptions {
  pair: Ref<AnyBorrowVaultPair | undefined>
  borrowVault: ComputedRef<Vault | undefined>
  collateralVault: ComputedRef<Vault | undefined>
  formTab: Ref<'borrow' | 'multiply'>

  resolvePendingSubAccount: () => Promise<string>
  isPendingSubAccountLoading: Ref<boolean>

  isGeoBlocked: ComputedRef<boolean>
  isMultiplyRestricted: ComputedRef<boolean>
}

const normalizeAddress = normalizeAddressOrEmpty

export const useMultiplyForm = (options: UseMultiplyFormOptions) => {
  const {
    pair: _pair,
    borrowVault,
    collateralVault,
    formTab: _formTab,
    resolvePendingSubAccount,
    isPendingSubAccountLoading,
    isGeoBlocked,
    isMultiplyRestricted,
  } = options

  const router = useRouter()
  const modal = useModal()
  const { error } = useToast()
  const { buildMultiplyPlan, executeTxPlan } = useEulerOperations()
  const wagmiConfig = useConfig()
  const { address, isConnected } = useAccount()
  const { refreshAllPositions, depositPositions } = useEulerAccount()
  const { eulerLensAddresses, eulerPeripheryAddresses, chainId: currentChainId } = useEulerAddresses()
  const { fetchSingleBalance, getBalance } = useWallets()
  const wrapperRoute = useWrapperRoute()
  const { getSupplyRewardApy, getBorrowRewardApy } = useRewardsApy()
  const { withIntrinsicBorrowApy, withIntrinsicSupplyApy } = useIntrinsicApy()
  const { enableEnsoMultiply, bptAdapterConfig } = useDeployConfig()
  const { getEnsoRoute, buildEnsoSwapQuote, buildAdapterSwapQuote } = useEnsoRoute()
  const {
    runSimulation: runMultiplySimulation,
    simulationError: multiplySimulationError,
    clearSimulationError: clearMultiplySimulationError,
  } = useTxPlanSimulation()

  const multiplyPriceInvert = usePriceInvert(
    () => getDisplayAssetSymbol(multiplyShortVault.value?.asset),
    () => getDisplayAssetSymbol(multiplyLongVault.value?.asset),
  )

  const { slippage: multiplySlippage } = useSlippage({
    fromSymbol: () => borrowVault.value?.asset.symbol,
    toSymbol: () => collateralVault.value?.asset.symbol,
  })
  const {
    sortedQuoteCards: multiplyQuoteCardsSorted,
    selectedProvider: multiplySelectedProvider,
    selectedQuote: multiplySelectedQuote,
    effectiveQuote: multiplyEffectiveQuote,
    providersCount: multiplyProvidersCount,
    isLoading: isMultiplyQuoteLoading,
    quoteError: multiplyQuoteError,
    statusLabel: multiplyQuotesStatusLabel,
    getQuoteDiffPct,
    reset: resetMultiplyQuoteStateInternal,
    requestQuotes: requestMultiplyQuotes,
    requestCustomQuote: requestMultiplyCustomQuote,
    selectProvider: selectMultiplyQuote,
  } = useSwapQuotesParallel({ amountField: 'amountOut', compare: 'max' })

  // --- Form state ---
  const multiplyInputAmount = ref('')
  const multiplier = ref(1)
  const multiplyLongAmount = ref('')
  const multiplyShortAmount = ref('')
  const multiplySupplyVault: Ref<Vault | undefined> = ref()
  const multiplySupplyAssetOverride: Ref<VaultAsset | null> = ref(null)
  const multiplySupplyAssetManuallySelected = ref(false)
  const multiplyWrapperRoute: Ref<WrapperRouteConfig | null> = ref(null)
  const multiplyAssetBalance: Ref<bigint> = ref(0n)
  const isMultiplySavingCollateral = ref(false)
  const isMultiplySubmitting = ref(false)
  const isMultiplyPreparing = ref(false)
  const multiplyPlan = ref<TxPlan | null>(null)
  const multiplyPlanParams = ref<MultiplyPlanParams | null>(null)

  // --- Vault aliases ---
  const multiplyLongVault = computed(() => collateralVault.value)
  const multiplyShortVault = computed(() => borrowVault.value)
  const multiplySupplyAsset = computed(() => multiplySupplyAssetOverride.value || multiplySupplyVault.value?.asset)
  const isMultiplyRawWrapperSupply = computed(() =>
    !isMultiplySavingCollateral.value
    && !!multiplyWrapperRoute.value
    && !!multiplySupplyAsset.value
    && normalizeAddress(multiplySupplyAsset.value.address) === normalizeAddress(multiplyWrapperRoute.value.rawToken.address),
  )

  // --- Collateral options ---
  const { collateralOptions: baseMultiplyCollateralOptions, collateralVaults: baseMultiplyCollateralVaults } = useMultiplyCollateralOptions({
    currentVault: multiplySupplyVault,
    liabilityVault: multiplyShortVault,
  })

  type MultiplyCollateralEntry = {
    vault: Vault
    asset: VaultAsset
    option: CollateralOption
  }

  const multiplyCollateralEntries = computed<MultiplyCollateralEntry[]>(() => {
    const entries: MultiplyCollateralEntry[] = []
    const route = multiplyWrapperRoute.value
    const rawAddress = route ? normalizeAddress(route.rawToken.address) : ''
    let insertedRaw = false

    baseMultiplyCollateralOptions.value.forEach((option, index) => {
      const vault = baseMultiplyCollateralVaults.value[index]
      if (!vault) return

      if (route && normalizeAddress(vault.address) === normalizeAddress(route.collateralVault) && !insertedRaw) {
        const rawBalance = getBalance(route.rawToken.address as Address)
        const rawAmount = nanoToValue(rawBalance, route.rawToken.decimals)
        entries.push({
          vault,
          asset: route.rawToken,
          option: {
            ...option,
            type: 'wallet',
            amount: rawAmount,
            price: option.amount > 0 ? option.price * rawAmount / option.amount : 0,
            symbol: getDisplayAssetSymbol(route.rawToken),
            assetAddress: route.rawToken.address,
          },
        })
        insertedRaw = true
      }

      if (!rawAddress || normalizeAddress(option.assetAddress || vault.asset.address) !== rawAddress) {
        entries.push({ vault, asset: vault.asset, option })
      }
    })

    if (route && !insertedRaw && multiplySupplyVault.value && normalizeAddress(multiplySupplyVault.value.address) === normalizeAddress(route.collateralVault)) {
      const rawBalance = getBalance(route.rawToken.address as Address)
      entries.unshift({
        vault: multiplySupplyVault.value,
        asset: route.rawToken,
        option: {
          type: 'wallet',
          amount: nanoToValue(rawBalance, route.rawToken.decimals),
          price: 0,
          symbol: getDisplayAssetSymbol(route.rawToken),
          assetAddress: route.rawToken.address,
          vaultAddress: multiplySupplyVault.value.address,
        },
      })
    }

    return entries
  })

  const multiplyCollateralOptions = computed(() => multiplyCollateralEntries.value.map(entry => entry.option))
  const multiplyCollateralVaults = computed(() => multiplyCollateralEntries.value.map(entry => entry.vault))
  const multiplyCollateralAssets = computed(() => multiplyCollateralEntries.value.map(entry => entry.asset))
  const multiplySelectedCollateralAssetAddress = computed(() => multiplySupplyAsset.value?.address)

  // --- Product labels ---
  const multiplySupplyProduct = useEulerProductOfVault(computed(() => multiplySupplyVault.value?.address || ''))
  const multiplyLongProduct = useEulerProductOfVault(computed(() => multiplyLongVault.value?.address || ''))
  const multiplyShortProduct = useEulerProductOfVault(computed(() => multiplyShortVault.value?.address || ''))

  // --- Savings position ---
  const multiplySavingPosition = computed(() => {
    if (!multiplySupplyVault.value) return null
    return depositPositions.value.find(
      position => normalizeAddress(position.vault.address) === normalizeAddress(multiplySupplyVault.value?.address),
    ) || null
  })
  const multiplySavingBalance = computed(() => multiplySavingPosition.value?.shares || 0n)

  const multiplyBalance = computed(() => {
    if (!multiplySupplyVault.value) return 0n
    if (isMultiplySavingCollateral.value) return multiplySavingPosition.value?.assets || 0n
    return multiplyAssetBalance.value
  })

  // --- Debt calculation ---
  const multiplyDebtAmountNano = computed(() => {
    if (!multiplySupplyVault.value || !multiplyShortVault.value) return 0n
    if (!multiplyInputAmount.value || multiplier.value <= 1) return 0n

    let suppliedCollateral: bigint
    try {
      suppliedCollateral = valueToNano(multiplyInputAmount.value, multiplySupplyAsset.value?.decimals || multiplySupplyVault.value.asset.decimals)
    }
    catch {
      return 0n
    }
    if (!suppliedCollateral) return 0n

    const rawSharePrice = getCollateralShareOraclePrice(multiplyShortVault.value, multiplySupplyVault.value)
    const collateralPriceInfo = getCollateralOraclePrice(multiplyShortVault.value, multiplySupplyVault.value)
    const liabilityPrice = multiplyShortVault.value.liabilityPriceInfo

    if (!rawSharePrice || !rawSharePrice.amountIn || rawSharePrice.amountIn <= 0n) return 0n
    if (!collateralPriceInfo || collateralPriceInfo.amountOutMid <= 0n) return 0n
    if (!liabilityPrice || liabilityPrice.queryFailure || !liabilityPrice.amountOutAsk || liabilityPrice.amountOutAsk <= 0n || !liabilityPrice.amountIn || liabilityPrice.amountIn <= 0n) return 0n

    return computeLeverageDebt({
      suppliedCollateral,
      collateralOutBid: collateralPriceInfo.amountOutBid || collateralPriceInfo.amountOutMid,
      collateralAmountIn: rawSharePrice.amountIn,
      multiplier: multiplier.value,
      liabilityIn: liabilityPrice.amountIn,
      liabilityOutAsk: liabilityPrice.amountOutAsk || liabilityPrice.amountOutMid,
    })
  })

  // --- LTV / multiplier bounds ---
  const multiplyBorrowLtv = computed(() => {
    if (!multiplySupplyVault.value || !multiplyShortVault.value) return 0
    const match = multiplyShortVault.value.collateralLTVs.find(
      ltv => normalizeAddress(ltv.collateral) === normalizeAddress(multiplySupplyVault.value?.address),
    )
    return match ? nanoToValue(match.borrowLTV, 2) : 0
  })

  const multiplyMaxMultiplier = computed(() => computeMaxMultiplier(multiplyBorrowLtv.value))

  const multiplyMinMultiplier = computed(() => computeMinMultiplier(multiplyMaxMultiplier.value))

  const multiplySupplyAmountNano = computed(() => {
    if (!multiplySupplyVault.value || !multiplyInputAmount.value) return 0n
    try {
      return valueToNano(multiplyInputAmount.value, multiplySupplyAsset.value?.decimals || multiplySupplyVault.value.asset.decimals)
    }
    catch {
      return 0n
    }
  })

  // --- Same-asset detection ---
  const multiplyIsSameAsset = computed(() => {
    if (!multiplyShortVault.value || !multiplyLongVault.value) return false
    return normalizeAddress(multiplyShortVault.value.asset.address) === normalizeAddress(multiplyLongVault.value.asset.address)
  })

  // --- Swap amounts ---
  const multiplySwapAmountIn = computed(() => {
    if (multiplyEffectiveQuote.value) return BigInt(multiplyEffectiveQuote.value.amountIn || 0)
    if (multiplyIsSameAsset.value && multiplyDebtAmountNano.value > 0n) return multiplyDebtAmountNano.value
    return 0n
  })

  const multiplySwapAmountOut = computed(() => {
    if (multiplyEffectiveQuote.value) return BigInt(multiplyEffectiveQuote.value.amountOut || 0)
    if (multiplyIsSameAsset.value && multiplyDebtAmountNano.value > 0n) return multiplyDebtAmountNano.value
    return 0n
  })

  const multiplySwapReady = computed(() => {
    if (isMultiplyQuoteLoading.value) return false
    return Boolean(multiplyEffectiveQuote.value || (multiplyIsSameAsset.value && multiplyDebtAmountNano.value > 0n))
  })

  // --- USD values (async) ---
  const multiplySupplyValueUsd = ref<number | null>(null)
  const multiplyLongValueUsd = ref<number | null>(null)
  const multiplyBorrowValueUsd = ref<number | null>(null)

  watchEffect(async () => {
    if (!multiplySupplyVault.value || !multiplySupplyAmountNano.value) {
      multiplySupplyValueUsd.value = null
      return
    }
    // Try asset pricing first, fall back to collateral pricing via borrow vault's oracle
    // (collateral-only vaults have no oracle for their own asset)
    const assetUsd = await getAssetUsdValue(multiplySupplyAmountNano.value, multiplySupplyVault.value, 'off-chain')
    if (assetUsd !== undefined && assetUsd > 0) {
      multiplySupplyValueUsd.value = assetUsd
      return
    }
    if (multiplyShortVault.value) {
      multiplySupplyValueUsd.value = await getCollateralUsdValueOrZero(multiplySupplyAmountNano.value, multiplyShortVault.value, multiplySupplyVault.value, 'off-chain')
    }
    else {
      multiplySupplyValueUsd.value = 0
    }
  })

  watchEffect(async () => {
    if (!multiplyLongVault.value || !multiplySwapAmountOut.value) {
      multiplyLongValueUsd.value = null
      return
    }
    // Try asset pricing first, fall back to collateral pricing via borrow vault's oracle
    const assetUsd = await getAssetUsdValue(multiplySwapAmountOut.value, multiplyLongVault.value, 'off-chain')
    if (assetUsd !== undefined && assetUsd > 0) {
      multiplyLongValueUsd.value = assetUsd
      return
    }
    if (multiplyShortVault.value) {
      multiplyLongValueUsd.value = await getCollateralUsdValueOrZero(multiplySwapAmountOut.value, multiplyShortVault.value, multiplyLongVault.value, 'off-chain')
    }
    else {
      multiplyLongValueUsd.value = 0
    }
  })

  watchEffect(async () => {
    if (!multiplyShortVault.value || !multiplyDebtAmountNano.value) {
      multiplyBorrowValueUsd.value = null
      return
    }
    multiplyBorrowValueUsd.value = await getAssetUsdValueOrZero(multiplyDebtAmountNano.value, multiplyShortVault.value, 'off-chain')
  })

  const multiplyTotalSupplyUsd = computed(() => {
    if (multiplySupplyValueUsd.value === null) return null
    return multiplySupplyValueUsd.value + (multiplyLongValueUsd.value || 0)
  })

  // --- APYs ---
  const multiplySupplyApy = computed(() => {
    if (!multiplySupplyVault.value) return null
    const base = nanoToValue(multiplySupplyVault.value.interestRateInfo.supplyAPY || 0n, 25)
    return withIntrinsicSupplyApy(base, multiplySupplyVault.value.asset.address) + getSupplyRewardApy(multiplySupplyVault.value.address)
  })

  const multiplyLongApy = computed(() => {
    if (!multiplyLongVault.value) return null
    const base = nanoToValue(multiplyLongVault.value.interestRateInfo.supplyAPY || 0n, 25)
    return withIntrinsicSupplyApy(base, multiplyLongVault.value.asset.address) + getSupplyRewardApy(multiplyLongVault.value.address)
  })

  const multiplyBorrowApy = computed(() => {
    if (!multiplyShortVault.value) return null
    const base = nanoToValue(multiplyShortVault.value.interestRateInfo.borrowAPY || 0n, 25)
    return withIntrinsicBorrowApy(base, multiplyShortVault.value.asset.address) - getBorrowRewardApy(multiplyShortVault.value.address, multiplySupplyVault.value?.address)
  })

  const multiplyWeightedSupplyApy = computed(() => {
    if (multiplySupplyValueUsd.value === null || multiplySupplyApy.value === null) return null
    return computeWeightedSupplyApy(
      multiplySupplyValueUsd.value,
      multiplySupplyApy.value,
      multiplyLongValueUsd.value,
      multiplyLongApy.value,
    )
  })

  // --- ROE ---
  const multiplyRoeBefore = computed(() => {
    if (isMultiplyQuoteLoading.value) return null
    if (multiplySupplyValueUsd.value === null) return null
    return 0
  })

  const multiplyRoeAfter = computed(() => {
    if (isMultiplyQuoteLoading.value) return null
    if (
      multiplyTotalSupplyUsd.value === null
      || multiplyBorrowValueUsd.value === null
      || multiplyWeightedSupplyApy.value === null
      || multiplyBorrowApy.value === null
    ) return null
    return calculateRoe(
      multiplyTotalSupplyUsd.value,
      multiplyBorrowValueUsd.value,
      multiplyWeightedSupplyApy.value,
      multiplyBorrowApy.value,
    )
  })

  // --- Health / LTV ---
  const multiplyLiquidationLtv = computed(() => {
    if (!multiplySupplyVault.value || !multiplyShortVault.value) return null
    const match = multiplyShortVault.value.collateralLTVs.find(
      ltv => normalizeAddress(ltv.collateral) === normalizeAddress(multiplySupplyVault.value?.address),
    )
    return match ? nanoToValue(match.liquidationLTV, 2) : null
  })

  const multiplyCurrentLtv = computed(() => {
    if (isMultiplyQuoteLoading.value) return null
    if (multiplySupplyValueUsd.value === null || multiplySupplyValueUsd.value <= 0) return null
    return 0
  })

  const multiplyNextLtv = computed(() => {
    if (isMultiplyQuoteLoading.value) return null
    if (multiplyTotalSupplyUsd.value === null || multiplyBorrowValueUsd.value === null) return null
    if (multiplyTotalSupplyUsd.value <= 0) return null
    return (multiplyBorrowValueUsd.value / multiplyTotalSupplyUsd.value) * 100
  })

  const multiplyCurrentLiquidationLtv = computed(() => null as number | null)
  const multiplyNextLiquidationLtv = computed(() => multiplyLiquidationLtv.value)

  const multiplyNextHealth = computed(() => {
    if (isMultiplyQuoteLoading.value) return null
    if (multiplyNextLtv.value === null || multiplyLiquidationLtv.value === null) return null
    return computeNextHealth(multiplyLiquidationLtv.value, multiplyNextLtv.value)
  })

  const multiplyCurrentHealth = computed(() => {
    if (isMultiplyQuoteLoading.value) return null
    if (multiplyLiquidationLtv.value === null || multiplyCurrentLtv.value === null) return null
    return computeNextHealth(multiplyLiquidationLtv.value, multiplyCurrentLtv.value)
  })

  // --- Price ratio ---
  const multiplyPriceRatio = computed(() => {
    if (!multiplyLongVault.value || !multiplyShortVault.value) return null
    const collateralPrice = getCollateralOraclePrice(multiplyShortVault.value, multiplyLongVault.value)
    const borrowPrice = getAssetOraclePrice(multiplyShortVault.value)
    return conservativePriceRatioNumber(collateralPrice, borrowPrice)
  })
  multiplyPriceInvert.autoInvert(() => multiplyPriceRatio.value)

  const multiplyCurrentLiquidationPrice = computed(() => {
    if (isMultiplyQuoteLoading.value) return null
    if (!multiplyPriceRatio.value || !multiplyCurrentHealth.value) return null
    if (!Number.isFinite(multiplyCurrentHealth.value)) return null
    return computeLiquidationPrice(multiplyPriceRatio.value, multiplyCurrentHealth.value)
  })

  const multiplyNextLiquidationPrice = computed(() => {
    if (isMultiplyQuoteLoading.value) return null
    if (!multiplyPriceRatio.value || !multiplyNextHealth.value) return null
    if (!Number.isFinite(multiplyNextHealth.value)) return null
    return computeLiquidationPrice(multiplyPriceRatio.value, multiplyNextHealth.value)
  })

  // --- Display ---
  const multiplyCurrentPrice = computed(() => {
    if (isMultiplyQuoteLoading.value) return null
    if (!multiplySwapReady.value || !multiplyShortVault.value || !multiplyLongVault.value) return null
    const amountIn = Number(formatUnits(multiplySwapAmountIn.value, Number(multiplyShortVault.value.asset.decimals)))
    const amountOut = Number(formatUnits(multiplySwapAmountOut.value, Number(multiplyLongVault.value.asset.decimals)))
    if (!amountIn || !amountOut) return null
    return {
      value: amountIn / amountOut,
      symbol: `${getDisplayAssetSymbol(multiplyShortVault.value.asset)}/${getDisplayAssetSymbol(multiplyLongVault.value.asset)}`,
    }
  })

  const multiplySwapSummary = computed(() => {
    if (isMultiplyQuoteLoading.value) return null
    if (!multiplySwapReady.value || !multiplyShortVault.value || !multiplyLongVault.value) return null
    const amountIn = formatUnits(multiplySwapAmountIn.value, Number(multiplyShortVault.value.asset.decimals))
    const amountOut = formatUnits(multiplySwapAmountOut.value, Number(multiplyLongVault.value.asset.decimals))
    return {
      from: `${formatSmartAmount(amountIn)} ${getDisplayAssetSymbol(multiplyShortVault.value.asset)}`,
      to: `${formatSmartAmount(amountOut)} ${getDisplayAssetSymbol(multiplyLongVault.value.asset)}`,
    }
  })

  const { multiplyPriceImpact, multipliedPriceImpact } = useMultiplyPriceImpact({
    isLoading: isMultiplyQuoteLoading,
    isSwapReady: multiplySwapReady,
    swapAmountIn: multiplySwapAmountIn,
    swapAmountOut: multiplySwapAmountOut,
    shortVault: multiplyShortVault,
    longVault: multiplyLongVault,
    multiplier,
    chainId: currentChainId,
  })

  const multiplyRoutedVia = computed(() => {
    if (isMultiplyQuoteLoading.value) return null
    if (!multiplyEffectiveQuote.value?.route?.length) return null
    return multiplyEffectiveQuote.value.route.map(route => route.providerName).join(', ')
  })

  const multiplyRouteItems = computed(() => {
    if (!multiplyLongVault.value) return []
    return buildSwapRouteItems({
      quoteCards: multiplyQuoteCardsSorted.value,
      getQuoteDiffPct,
      decimals: Number(multiplyLongVault.value.asset.decimals),
      symbol: getDisplayAssetSymbol(multiplyLongVault.value.asset),
      formatAmount: formatSmartAmount,
    })
  })

  const multiplyRouteEmptyMessage = computed(() => {
    if (!multiplyProvidersCount.value) return 'Enter amount to fetch quotes'
    return 'No quotes found'
  })

  // --- Validation ---
  const multiplyErrorText = computed(() => {
    if (!multiplySupplyVault.value || !multiplyShortVault.value) return null
    if (multiplyBalance.value < valueToNano(multiplyInputAmount.value, multiplySupplyAsset.value?.decimals || multiplySupplyVault.value.asset.decimals)) {
      return 'Not enough balance'
    }
    if (multiplyDebtAmountNano.value > 0n && (multiplyShortVault.value.supply || 0n) < multiplyDebtAmountNano.value) {
      return 'Not enough liquidity in the vault'
    }
    return null
  })

  const isSupplyCapReached = computed(() => multiplySupplyVault.value ? getIsSupplyCapReached(multiplySupplyVault.value) : false)
  const isBorrowCapReached = computed(() => multiplyShortVault.value ? getIsBorrowCapReached(multiplyShortVault.value) : false)

  const isMultiplySubmitDisabled = computed(() => {
    if (!isConnected.value) return false
    if (!multiplySupplyVault.value || !multiplyLongVault.value || !multiplyShortVault.value) return true
    if (!multiplyInputAmount.value || multiplyDebtAmountNano.value <= 0n) return true
    if (multiplyErrorText.value) return true
    if (isPendingSubAccountLoading.value) return true
    const isSameAsset = normalizeAddress(multiplyLongVault.value.asset.address) === normalizeAddress(multiplyShortVault.value.asset.address)
    if (!isSameAsset && !multiplySelectedQuote.value) return true
    if (isSupplyCapReached.value || isBorrowCapReached.value) return true
    return false
  })

  // --- Warnings ---
  const multiplyFormWarnings = computed(() => {
    if (!multiplyShortVault.value) return []
    return [
      getUtilisationWarning(multiplyShortVault.value, 'borrow'),
      getBorrowCapWarning(multiplyShortVault.value),
    ]
  })

  // --- Swap quote ---
  const requestMultiplyQuote = useDebounceFn(async () => {
    multiplyQuoteError.value = null

    if (!multiplySupplyVault.value || !multiplyLongVault.value || !multiplyShortVault.value || !multiplyInputAmount.value) {
      resetMultiplyQuoteState()
      return
    }

    const debtAmount = multiplyDebtAmountNano.value
    if (!debtAmount || debtAmount <= 0n) {
      resetMultiplyQuoteState()
      return
    }

    if (normalizeAddress(multiplyLongVault.value.asset.address) === normalizeAddress(multiplyShortVault.value.asset.address)) {
      resetMultiplyQuoteState()
      setMultiplyAmounts(debtAmount, debtAmount)
      return
    }

    let account: Address
    try {
      account = (await resolvePendingSubAccount()) as Address
    }
    catch {
      resetMultiplyQuoteState()
      multiplyQuoteError.value = 'Unable to resolve position'
      return
    }

    setMultiplyAmounts(null, null)

    const logContext = {
      fromVault: multiplyShortVault.value?.address,
      toVault: multiplyLongVault.value?.address,
      amount: formatUnits(debtAmount, Number(multiplyShortVault.value.asset.decimals)),
      slippage: multiplySlippage.value,
      swapperMode: SwapperMode.EXACT_IN,
      isRepay: false,
    }

    if (enableEnsoMultiply && eulerPeripheryAddresses.value?.swapper && currentChainId.value) {
      const swapperAddr = eulerPeripheryAddresses.value.swapper as Address
      const swapVerifierAddr = eulerPeripheryAddresses.value.swapVerifier as Address
      const tokenIn = multiplyShortVault.value.asset.address as Address
      const tokenOut = multiplyLongVault.value.asset.address as Address
      const borrowVaultAddr = multiplyShortVault.value.address as Address
      const collateralVaultAddr = multiplyLongVault.value.address as Address
      const chainId = currentChainId.value
      // Only use adapter for vaults where DEX routing doesn't work
      const ADAPTER_ONLY_VAULTS = new Set<string>()
      const adapterEntry = ADAPTER_ONLY_VAULTS.has(collateralVaultAddr.toLowerCase())
        ? (bptAdapterConfig[collateralVaultAddr.toLowerCase()] || bptAdapterConfig[collateralVaultAddr])
        : null

      if (adapterEntry && adapterEntry.pool && adapterEntry.wrapper && adapterEntry.numTokens) {
        await requestMultiplyCustomQuote('balancer-adapter', async () => {
          const deadline = Math.floor(Date.now() / 1000) + 1800
          const fullEntry = adapterEntry as BptAdapterConfigEntry
          const { expectedBptOut, minBptOut } = await previewAdapterZapIn(
            wagmiConfig,
            fullEntry,
            debtAmount,
            multiplySlippage.value,
          )
          const adapterCalldata = encodeAdapterZapIn(fullEntry.tokenIndex, debtAmount, minBptOut)

          const quote = buildAdapterSwapQuote({
            swapperAddress: swapperAddr,
            swapVerifierAddress: swapVerifierAddr,
            collateralVault: collateralVaultAddr,
            borrowVault: borrowVaultAddr,
            subAccount: account,
            tokenIn,
            tokenOut,
            borrowAmount: debtAmount,
            deadline,
            adapterAddress: fullEntry.adapter as Address,
            adapterCalldata,
            minAmountOut: minBptOut,
          })

          quote.amountOut = expectedBptOut.toString()
          quote.amountOutMin = minBptOut.toString()
          return quote
        }, { logContext })
      }
      else {
        await requestMultiplyCustomQuote('enso', async () => {
          const ensoRoute = await getEnsoRoute({
            chainId,
            fromAddress: swapperAddr,
            tokenIn,
            tokenOut,
            amountIn: debtAmount,
            receiver: swapperAddr,
            slippage: multiplySlippage.value,
          })

          const deadline = Math.floor(Date.now() / 1000) + 1800

          return buildEnsoSwapQuote(ensoRoute, {
            swapperAddress: swapperAddr,
            swapVerifierAddress: swapVerifierAddr,
            collateralVault: collateralVaultAddr,
            borrowVault: borrowVaultAddr,
            subAccount: account,
            tokenIn,
            tokenOut,
            borrowAmount: debtAmount,
            deadline,
          })
        }, { logContext })
      }
    }
    else {
      const requestParams = {
        tokenIn: multiplyShortVault.value.asset.address as Address,
        tokenOut: multiplyLongVault.value.asset.address as Address,
        accountIn: account,
        accountOut: account,
        amount: debtAmount,
        vaultIn: multiplyShortVault.value.address as Address,
        receiver: multiplyLongVault.value.address as Address,
        slippage: multiplySlippage.value,
        swapperMode: SwapperMode.EXACT_IN,
        isRepay: false,
        targetDebt: 0n,
        currentDebt: 0n,
      }
      await requestMultiplyQuotes(requestParams, {
        errorMessage: 'Unable to fetch a swap quote. Please adjust the amount or select a different asset to try again.',
        logContext,
      })
    }
  }, 500)

  // --- Helpers ---
  const setMultiplyAmounts = (longAmount?: bigint | null, shortAmount?: bigint | null) => {
    if (!multiplySupplyVault.value || !multiplyLongVault.value || !multiplyShortVault.value || !multiplyInputAmount.value) {
      multiplyLongAmount.value = ''
      multiplyShortAmount.value = ''
      return
    }
    let baseNano: bigint
    try {
      baseNano = valueToNano(multiplyInputAmount.value, multiplySupplyVault.value.asset.decimals)
    }
    catch {
      multiplyLongAmount.value = ''
      multiplyShortAmount.value = ''
      return
    }
    if (!baseNano) {
      multiplyLongAmount.value = ''
      multiplyShortAmount.value = ''
      return
    }
    multiplyLongAmount.value = longAmount && longAmount > 0n
      ? trimTrailingZeros(formatUnits(longAmount, Number(multiplyLongVault.value.asset.decimals)))
      : ''
    multiplyShortAmount.value = shortAmount && shortAmount > 0n
      ? trimTrailingZeros(formatUnits(shortAmount, Number(multiplyShortVault.value.asset.decimals)))
      : ''
  }

  const resetMultiplyQuoteState = () => {
    resetMultiplyQuoteStateInternal()
    setMultiplyAmounts(null, null)
  }

  const onRefreshMultiplyQuotes = () => {
    resetMultiplyQuoteState()
    isMultiplyQuoteLoading.value = true
    requestMultiplyQuote()
  }

  // --- Actions: form input handlers ---
  const onMultiplyInput = () => {
    clearMultiplySimulationError()
    if (!multiplyInputAmount.value) {
      resetMultiplyQuoteState()
      return
    }
    requestMultiplyQuote()
  }

  const onMultiplierInput = () => {
    clearMultiplySimulationError()
    if (!multiplyInputAmount.value) {
      resetMultiplyQuoteState()
      return
    }
    requestMultiplyQuote()
  }

  const onMultiplyCollateralChange = (selectedIndex: number) => {
    clearMultiplySimulationError()
    const nextVault = multiplyCollateralVaults.value[selectedIndex]
    const nextAsset = multiplyCollateralAssets.value[selectedIndex]
    const nextOption = multiplyCollateralOptions.value[selectedIndex]
    if (!nextVault || !nextAsset || !nextOption) return

    const nextIsSaving = nextOption.type === 'saving'
    const nextIsRawWrapper = multiplyWrapperRoute.value
      && normalizeAddress(nextVault.address) === normalizeAddress(multiplyWrapperRoute.value.collateralVault)
      && normalizeAddress(nextAsset.address) === normalizeAddress(multiplyWrapperRoute.value.rawToken.address)
    const vaultChanged = !multiplySupplyVault.value
      || normalizeAddress(multiplySupplyVault.value.address) !== normalizeAddress(nextVault.address)
    const savingChanged = nextIsSaving !== isMultiplySavingCollateral.value
    const assetChanged = normalizeAddress(multiplySupplyAsset.value?.address || '') !== normalizeAddress(nextAsset.address)
    if (vaultChanged || savingChanged || assetChanged) {
      multiplySupplyAssetManuallySelected.value = true
      multiplySupplyVault.value = nextVault
      multiplySupplyAssetOverride.value = nextIsRawWrapper ? nextAsset : null
      isMultiplySavingCollateral.value = nextIsSaving
      multiplyInputAmount.value = ''
      resetMultiplyQuoteState()
    }
  }

  // --- Actions: submit & send ---
  const submitMultiply = async () => {
    if (isOperationBlocked.value) return
    if (isMultiplyPreparing.value || isGeoBlocked.value || isMultiplyRestricted.value) return
    isMultiplyPreparing.value = true
    try {
      if (isMultiplySubmitting.value || !isConnected.value) return
      if (!multiplySupplyVault.value || !multiplyLongVault.value || !multiplyShortVault.value) return
      if (!multiplyInputAmount.value || multiplyDebtAmountNano.value <= 0n) return
      if (multiplyErrorText.value) return

      const supplyAsset = multiplySupplyAsset.value || multiplySupplyVault.value.asset
      const supplyAmountNano = valueToNano(multiplyInputAmount.value || '0', supplyAsset.decimals)
      let supplySharesAmount: bigint | undefined
      if (isMultiplySavingCollateral.value) {
        if (!multiplySavingPosition.value) {
          error('No savings balance for selected collateral')
          return
        }
        if (multiplySavingPosition.value.assets === supplyAmountNano) {
          supplySharesAmount = multiplySavingBalance.value
        }
        else {
          supplySharesAmount = await convertAssetsToShares(multiplySupplyVault.value.address, supplyAmountNano)
        }
        if (!supplySharesAmount || supplySharesAmount <= 0n) {
          error('Unable to resolve savings amount')
          return
        }
      }
      const debtAmount = multiplyDebtAmountNano.value
      if (!supplyAmountNano || debtAmount <= 0n) return

      const isSameAsset = normalizeAddress(multiplyLongVault.value.asset.address) === normalizeAddress(multiplyShortVault.value.asset.address)
      const quote = isSameAsset ? null : multiplySelectedQuote.value
      if (!isSameAsset && !quote) return

      let subAccount: string
      try {
        subAccount = await resolvePendingSubAccount()
      }
      catch (e) {
        logWarn('multiply/resolveSubaccount', e)
        error('Unable to resolve position')
        return
      }

      let supplyQuote: SwapApiQuote | undefined
      if (isMultiplyRawWrapperSupply.value) {
        if (!multiplyWrapperRoute.value) {
          error('Wrapper route is unavailable')
          return
        }
        supplyQuote = wrapperRoute.buildDepositQuote({
          route: multiplyWrapperRoute.value,
          wrappedAsset: multiplySupplyVault.value.asset,
          accountOut: subAccount as Address,
          amount: supplyAmountNano,
          deadline: Math.floor(Date.now() / 1000) + 1800,
        })
      }

      const planParams: MultiplyPlanParams = {
        supplyVaultAddress: multiplySupplyVault.value.address,
        supplyAssetAddress: supplyAsset.address,
        supplyAmount: supplyAmountNano,
        supplySharesAmount,
        supplyIsSavings: isMultiplySavingCollateral.value,
        supplyQuote,
        longVaultAddress: multiplyLongVault.value.address,
        longAssetAddress: multiplyLongVault.value.asset.address,
        borrowVaultAddress: multiplyShortVault.value.address,
        debtAmount,
        quote: quote || undefined,
        swapperMode: SwapperMode.EXACT_IN,
        subAccount,
      }
      multiplyPlanParams.value = planParams

      try {
        multiplyPlan.value = await buildMultiplyPlan({
          ...planParams,
          includePermit2Call: false,
        })
      }
      catch (e) {
        logWarn('multiply/buildPlan', e)
        multiplyPlan.value = null
      }

      if (multiplyPlan.value) {
        const ok = await runMultiplySimulation(multiplyPlan.value)
        if (!ok) return
      }

      modal.open(OperationReviewModal, {
        props: {
          type: 'borrow',
          asset: multiplyShortVault.value.asset,
          amount: multiplyShortAmount.value || formatUnits(debtAmount, Number(multiplyShortVault.value.asset.decimals)),
          plan: multiplyPlan.value || undefined,
          supplyingAssetForBorrow: supplyAsset,
          supplyingAmount: multiplyInputAmount.value,
          swapToAsset: quote ? multiplyLongVault.value.asset : undefined,
          swapToAmount: quote ? multiplyLongAmount.value : undefined,
          subAccount,
          onConfirm: () => {
            setTimeout(() => {
              sendMultiply()
            }, 400)
          },
        },
      })
    }
    finally {
      isMultiplyPreparing.value = false
    }
  }

  const sendMultiply = async () => {
    if (!multiplyPlanParams.value) return
    isMultiplySubmitting.value = true
    try {
      const plan = await buildMultiplyPlan({
        ...multiplyPlanParams.value,
        includePermit2Call: true,
      })
      multiplyPlan.value = plan
      await executeTxPlan(plan)
      modal.close()
      refreshAllPositions(eulerLensAddresses.value, address.value || '')
      setTimeout(() => {
        router.replace('/portfolio')
      }, 400)
    }
    catch (e) {
      logWarn('multiply/send', e)
      error('Transaction failed')
    }
    finally {
      isMultiplySubmitting.value = false
    }
  }

  // --- Balance ---
  const updateMultiplyAssetBalance = async () => {
    if (multiplySupplyAsset.value?.address && isConnected.value) {
      multiplyAssetBalance.value = await fetchSingleBalance(multiplySupplyAsset.value.address)
    }
    else {
      multiplyAssetBalance.value = 0n
    }
  }

  // --- Init ---
  const initMultiplySupplyVault = (vault: Vault) => {
    multiplySupplyVault.value = vault
    multiplySupplyAssetOverride.value = null
    multiplySupplyAssetManuallySelected.value = false
    isMultiplySavingCollateral.value = false
    void refreshMultiplyWrapperRoute(vault)
  }

  const refreshMultiplyWrapperRoute = async (vault = multiplySupplyVault.value) => {
    if (!vault) {
      multiplyWrapperRoute.value = null
      multiplySupplyAssetOverride.value = null
      return
    }

    const requestedVault = vault.address
    const validatedRoute = await wrapperRoute.getValidatedRoute(vault.address, vault.asset)
    if (normalizeAddress(multiplySupplyVault.value?.address || '') !== normalizeAddress(requestedVault)) {
      return
    }

    multiplyWrapperRoute.value = validatedRoute
    if (!validatedRoute) {
      if (multiplySupplyAssetOverride.value) {
        multiplySupplyAssetOverride.value = null
      }
      return
    }

    if (!multiplySupplyAssetManuallySelected.value && !isMultiplySavingCollateral.value) {
      multiplySupplyAssetOverride.value = validatedRoute.rawToken
      await updateMultiplyAssetBalance()
    }
  }

  // --- Watchers ---
  watch([multiplyEffectiveQuote, multiplyIsSameAsset, multiplyDebtAmountNano], () => {
    if (multiplyIsSameAsset.value && multiplyDebtAmountNano.value > 0n) {
      setMultiplyAmounts(multiplyDebtAmountNano.value, multiplyDebtAmountNano.value)
      return
    }
    if (multiplyEffectiveQuote.value) {
      const amountOut = BigInt(multiplyEffectiveQuote.value.amountOut || 0)
      const amountIn = BigInt(multiplyEffectiveQuote.value.amountIn || 0)
      setMultiplyAmounts(amountOut, amountIn)
      return
    }
    setMultiplyAmounts(null, null)
  }, { immediate: true })

  watch(multiplySlippage, () => {
    clearMultiplySimulationError()
    if (!multiplyInputAmount.value) {
      resetMultiplyQuoteState()
      return
    }
    requestMultiplyQuote()
  })

  watch([multiplySupplyVault, multiplyLongVault, multiplyShortVault, isMultiplySavingCollateral], () => {
    clearMultiplySimulationError()
    resetMultiplyQuoteState()
    if (multiplyInputAmount.value) {
      requestMultiplyQuote()
    }
  })

  watch(multiplySupplyVault, async (newVault) => {
    await refreshMultiplyWrapperRoute(newVault)
  })

  watch([multiplySupplyAsset, isConnected], async () => {
    if (multiplySupplyAsset.value?.address && isConnected.value) {
      multiplyAssetBalance.value = await fetchSingleBalance(multiplySupplyAsset.value.address)
    }
    else {
      multiplyAssetBalance.value = 0n
    }
  })

  watch(multiplySelectedQuote, () => {
    clearMultiplySimulationError()
  })

  watch(multiplyMaxMultiplier, (max) => {
    let next = multiplier.value
    const min = multiplyMinMultiplier.value
    if (!max || max < min) {
      next = min
    }
    else {
      if (next > max) next = max
      if (next < min) next = min
    }
    if (next !== multiplier.value) {
      multiplier.value = next
    }
    if (!multiplyInputAmount.value) {
      resetMultiplyQuoteState()
      return
    }
    requestMultiplyQuote()
  }, { immediate: true })

  // --- Reset ---
  const resetOnTabSwitch = () => {
    clearMultiplySimulationError()
  }

  return {
    // Form state
    multiplyInputAmount,
    multiplier,
    multiplyLongAmount,
    multiplyShortAmount,
    multiplySupplyVault,
    multiplySupplyAsset,
    multiplySelectedCollateralAssetAddress,
    multiplyAssetBalance,
    isMultiplySavingCollateral,
    isMultiplySubmitting,
    isMultiplyPreparing,
    multiplyPlan,

    // Vault aliases
    multiplyLongVault,
    multiplyShortVault,

    // Collateral
    multiplyCollateralOptions,
    multiplyCollateralVaults,
    multiplySavingPosition,
    multiplySavingBalance,
    multiplyBalance,

    // Debt
    multiplyDebtAmountNano,
    multiplyBorrowLtv,
    multiplyMaxMultiplier,
    multiplyMinMultiplier,
    multiplySupplyAmountNano,
    multiplyIsSameAsset,

    // Swap
    multiplySwapAmountIn,
    multiplySwapAmountOut,
    multiplySwapReady,
    multiplySlippage,
    multiplySelectedProvider,
    multiplyQuoteCardsSorted,
    isMultiplyQuoteLoading,
    multiplyQuoteError,
    multiplyQuotesStatusLabel,
    selectMultiplyQuote,

    // USD values
    multiplySupplyValueUsd,
    multiplyLongValueUsd,
    multiplyBorrowValueUsd,
    multiplyTotalSupplyUsd,

    // APY
    multiplySupplyApy,
    multiplyLongApy,
    multiplyBorrowApy,
    multiplyWeightedSupplyApy,

    // ROE
    multiplyRoeBefore,
    multiplyRoeAfter,

    // Health / LTV
    multiplyLiquidationLtv,
    multiplyCurrentLtv,
    multiplyNextLtv,
    multiplyCurrentLiquidationLtv,
    multiplyNextLiquidationLtv,
    multiplyNextHealth,
    multiplyCurrentHealth,

    // Price
    multiplyPriceRatio,
    multiplyCurrentLiquidationPrice,
    multiplyNextLiquidationPrice,
    multiplyCurrentPrice,
    multiplyPriceInvert,

    // Display
    multiplySwapSummary,
    multiplyPriceImpact,
    multipliedPriceImpact,
    multiplyRoutedVia,
    multiplyRouteItems,
    multiplyRouteEmptyMessage,
    multiplySimulationError,

    // Validation
    multiplyErrorText,
    isMultiplySubmitDisabled,
    multiplyFormWarnings,

    // Product labels
    multiplySupplyProduct,
    multiplyLongProduct,
    multiplyShortProduct,

    // Actions
    onMultiplyInput,
    onMultiplierInput,
    onMultiplyCollateralChange,
    onRefreshMultiplyQuotes,
    submitMultiply,
    sendMultiply,
    updateMultiplyAssetBalance,
    initMultiplySupplyVault,
    resetOnTabSwitch,
  }
}
