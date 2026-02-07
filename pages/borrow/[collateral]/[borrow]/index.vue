<script setup lang="ts">
import { useAccount } from '@wagmi/vue'
import { ethers, FixedNumber } from 'ethers'
import type { Address } from 'viem'
import { useModal } from '~/components/ui/composables/useModal'
import { OperationReviewModal, SlippageSettingsModal, VaultUnverifiedDisclaimerModal } from '#components'
import { useTermsOfUseGate } from '~/composables/useTermsOfUseGate'
import { useToast } from '~/components/ui/composables/useToast'
import { type AnyBorrowVaultPair, type BorrowVaultPair, getNetAPY, type VaultAsset, type CollateralOption, type Vault, type SecuritizeVault, convertAssetsToShares, isSecuritizeBorrowPair } from '~/entities/vault'
import { collectPythFeedIds } from '~/entities/oracle'
import { getAssetUsdValueOrZero, getAssetOraclePrice, getCollateralOraclePrice, getCollateralUsdPrice, ONE_18 } from '~/services/pricing/priceProvider'
import { getNewSubAccount } from '~/entities/account'
import { useEulerProductOfVault } from '~/composables/useEulerLabels'
import { useMultiplyCollateralOptions } from '~/composables/useMultiplyCollateralOptions'
import { useSwapQuotesParallel } from '~/composables/useSwapQuotesParallel'
import { type SwapApiQuote, SwapperMode } from '~/entities/swap'
import { getQuoteAmount } from '~/utils/swapQuotes'
import type { TxPlan } from '~/entities/txPlan'

const router = useRouter()
const route = useRoute()
const modal = useModal()
const { error } = useToast()
const { getSubmitLabel, getSubmitDisabled, guardWithTerms } = useTermsOfUseGate()
const reviewBorrowLabel = getSubmitLabel('Review Borrow')
const reviewMultiplyLabel = getSubmitLabel('Review Multiply')
const { buildBorrowPlan, buildBorrowBySavingPlan, buildMultiplyPlan, executeTxPlan } = useEulerOperations()
const { getBorrowVaultPair, updateVault } = useVaults()
const { address, isConnected } = useAccount()
const { updateBorrowPositions, depositPositions } = useEulerAccount()
const { getOpportunityOfBorrowVault, getOpportunityOfLendVault } = useMerkl()
const { withIntrinsicBorrowApy, withIntrinsicSupplyApy } = useIntrinsicApy()
const { eulerLensAddresses } = useEulerAddresses()
const { getBalance, fetchSingleBalance, fetchVaultShareBalance } = useWallets()
const openSlippageSettings = () => {
  modal.open(SlippageSettingsModal)
}
const {
  runSimulation: runBorrowSimulation,
  simulationError: borrowSimulationError,
  clearSimulationError: clearBorrowSimulationError,
} = useTxPlanSimulation()
const {
  runSimulation: runMultiplySimulation,
  simulationError: multiplySimulationError,
  clearSimulationError: clearMultiplySimulationError,
} = useTxPlanSimulation()

type MultiplyPlanParams = {
  supplyVaultAddress: string
  supplyAssetAddress: string
  supplyAmount: bigint
  supplySharesAmount?: bigint
  supplyIsSavings?: boolean
  longVaultAddress: string
  longAssetAddress: string
  borrowVaultAddress: string
  debtAmount: bigint
  quote?: SwapApiQuote
  swapperMode: SwapperMode
  subAccount: string
}

const collateralAddress = route.params.collateral as string
const borrowAddress = route.params.borrow as string

const ltv = ref(0)
const borrowAmount = ref('')
const collateralAmount = ref('')
const balance = ref(0n)
const savingBalance = ref(0n)
const savingAssets = ref(0n)
const isSubmitting = ref(false)
const isMultiplySubmitting = ref(false)
const isEstimatesLoading = ref(false)
const plan = ref<TxPlan | null>(null)
const multiplyPlan = ref<TxPlan | null>(null)
const multiplyPlanParams = ref<MultiplyPlanParams | null>(null)

// Load vault pair (handles regular, escrow, and securitize collateral)
const initialPair = await getBorrowVaultPair(collateralAddress, borrowAddress)
const pair: Ref<AnyBorrowVaultPair | undefined> = ref(initialPair)

// Check if collateral is securitize for conditional rendering
const isSecuritizeCollateral = computed(() => pair.value ? isSecuritizeBorrowPair(pair.value) : false)
const health = ref()
const netAPY = ref()
const liquidationPrice = ref()
const isSavingCollateral = ref(false)
const isMultiplySavingCollateral = ref(false)
const tab = ref()
const formTab = ref<'borrow' | 'multiply'>('borrow')
const multiplySupplyVault: Ref<Vault | undefined> = ref()

const multiplyInputAmount = ref('')
const multiplier = ref(1)
const multiplyLongAmount = ref('')
const multiplyShortAmount = ref('')
const multiplyAssetBalance: Ref<bigint> = ref(0n)
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
  selectProvider: selectMultiplyQuote,
} = useSwapQuotesParallel({ amountField: 'amountOut', compare: 'max' })
const { slippage: multiplySlippage } = useSlippage()
const multiplySubAccount = ref<string | null>(null)
const isMultiplySubAccountLoading = ref(false)
let multiplySubAccountPromise: Promise<string> | null = null

const errorText = computed(() => {
  if (computedBalance.value < valueToNano(collateralAmount.value, collateralVault.value?.asset?.decimals)) {
    return 'Not enough balance'
  }
  else if ((borrowVault.value?.supply || 0n) < valueToNano(borrowAmount.value, borrowVault.value?.decimals)) {
    return 'Not enough liquidity in the vault'
  }
  return null
})
const isSubmitDisabled = computed(() => {
  if (!isConnected.value) return false
  return computedBalance.value < valueToNano(collateralAmount.value, collateralVault.value?.asset?.decimals)
    || !(+collateralAmount.value)
    || ((borrowVault.value?.supply || 0n) < valueToNano(borrowAmount.value, borrowVault.value?.decimals))
    || !valueToNano(borrowAmount.value, borrowVault.value?.decimals)
})
const isMultiplySubmitDisabled = computed(() => {
  if (!isConnected.value) return false
  if (!multiplySupplyVault.value || !multiplyLongVault.value || !multiplyShortVault.value) {
    return true
  }
  if (!multiplyInputAmount.value || multiplyDebtAmountNano.value <= 0n) {
    return true
  }
  if (multiplyErrorText.value) {
    return true
  }
  if (isMultiplySubAccountLoading.value) {
    return true
  }
  const isSameAsset = normalizeAddress(multiplyLongVault.value.asset.address) === normalizeAddress(multiplyShortVault.value.asset.address)
  if (!isSameAsset && !multiplySelectedQuote.value) {
    return true
  }
  return false
})
const reviewBorrowDisabled = getSubmitDisabled(isSubmitDisabled)
const reviewMultiplyDisabled = getSubmitDisabled(isMultiplySubmitDisabled)
const borrowVault = computed(() => pair.value?.borrow)
const collateralVault = computed(() => pair.value?.collateral)
const multiplyLongVault = computed(() => collateralVault.value)
const pairAssets = computed(() => [collateralVault.value?.asset, borrowVault.value?.asset])
const priceFixed = computed(() => {
  // Use liability vault's view of collateral price
  const collateralPrice = borrowVault.value && collateralVault.value
    ? getCollateralOraclePrice(borrowVault.value, collateralVault.value)
    : undefined
  const borrowPrice = borrowVault.value ? getAssetOraclePrice(borrowVault.value) : undefined
  const ask = collateralPrice?.amountOutAsk || 0n
  const bid = borrowPrice?.amountOutBid || 1n
  return FixedNumber.fromValue(ask, 18).div(FixedNumber.fromValue(bid, 18))
})

// USD price per unit of collateral from liability vault's perspective (for AssetInput display)
const collateralUnitPrice = ref<number | undefined>(undefined)

watchEffect(async () => {
  if (!borrowVault.value || !collateralVault.value) {
    collateralUnitPrice.value = undefined
    return
  }
  const priceInfo = await getCollateralUsdPrice(borrowVault.value, collateralVault.value as Vault, 'off-chain')
  if (!priceInfo) {
    collateralUnitPrice.value = undefined
    return
  }
  // amountOutMid is the price in USD (18 decimals) for 1 unit of collateral
  collateralUnitPrice.value = nanoToValue(priceInfo.amountOutMid, 18)
})
const collateralAmountFixed = computed(() => FixedNumber.fromValue(
  valueToNano(collateralAmount.value || '0', collateralVault.value?.decimals),
  Number(collateralVault.value?.decimals),
))
const borrowAmountFixed = computed(() => FixedNumber.fromValue(
  valueToNano(borrowAmount.value || '0', borrowVault.value?.decimals),
  Number(borrowVault.value?.decimals),
))
const ltvFixed = computed(() => {
  const fn = FixedNumber.fromValue(valueToNano(ltv.value, 4), 4)
  if (fn.gte(FixedNumber.fromValue(pair.value?.borrowLTV || 0n, 2))) {
    return fn.sub(FixedNumber.fromValue(100n, 4))
  }
  return fn
})
const tabs = computed(() => {
  if (!pair.value) {
    return []
  }
  const list = [
    {
      label: 'Pair details',
      value: undefined,
      avatars: [getAssetLogoUrl(pair.value.collateral.asset.symbol), getAssetLogoUrl(pair.value.borrow.asset.symbol)],
      symbols: [pair.value.collateral.asset.symbol, pair.value.borrow.asset.symbol],
    },
    {
      label: pair.value.collateral.asset.symbol,
      value: 'collateral',
      avatars: [getAssetLogoUrl(pair.value.collateral.asset.symbol)],
      symbols: [pair.value.collateral.asset.symbol],
    },
    {
      label: pair.value.borrow.asset.symbol,
      value: 'borrow',
      avatars: [getAssetLogoUrl(pair.value.borrow.asset.symbol)],
      symbols: [pair.value.borrow.asset.symbol],
    },
  ]
  if (formTab.value === 'multiply' && multiplySupplyVault.value) {
    const supplyAddress = normalizeAddress(multiplySupplyVault.value.address)
    const collateralAddress = normalizeAddress(pair.value.collateral.address)
    const borrowAddress = normalizeAddress(pair.value.borrow.address)
    if (supplyAddress && supplyAddress !== collateralAddress && supplyAddress !== borrowAddress) {
      list.splice(1, 0, {
        label: multiplySupplyVault.value.asset.symbol,
        value: 'multiply-collateral',
        avatars: [getAssetLogoUrl(multiplySupplyVault.value.asset.symbol)],
        symbols: [multiplySupplyVault.value.asset.symbol],
      })
    }
  }
  return list
})
const formTabs = computed(() => [
  {
    label: 'Borrow',
    value: 'borrow',
  },
  {
    label: 'Multiply',
    value: 'multiply',
  },
])
watch(tabs, (next) => {
  if (!tab.value) {
    return
  }
  const values = next.map(item => item.value)
  if (!values.includes(tab.value)) {
    tab.value = undefined
  }
}, { immediate: true })

const multiplyShortVault = computed(() => borrowVault.value)
const { collateralOptions: multiplyCollateralOptions, collateralVaults: multiplyCollateralVaults } = useMultiplyCollateralOptions({
  currentVault: multiplySupplyVault,
  liabilityVault: multiplyShortVault,
})
const multiplyRouteItems = computed(() => {
  if (!multiplyLongVault.value) {
    return []
  }
  const bestProvider = multiplyQuoteCardsSorted.value[0]?.provider
  return multiplyQuoteCardsSorted.value.map((card) => {
    const amountOut = getQuoteAmount(card.quote, 'amountOut')
    const amount = formatNumber(
      ethers.formatUnits(amountOut, Number(multiplyLongVault.value.asset.decimals)),
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
      symbol: multiplyLongVault.value.asset.symbol,
      routeLabel: card.quote.route?.length
        ? `via ${card.quote.route.map(route => route.providerName).join(', ')}`
        : '-',
      badge,
    }
  })
})
const multiplyRouteEmptyMessage = computed(() => {
  if (!multiplyProvidersCount.value) {
    return 'Enter amount to fetch quotes'
  }
  return 'No quotes found'
})

const borrowProduct = useEulerProductOfVault(computed(() => borrowVault.value?.address || ''))
const collateralProduct = useEulerProductOfVault(computed(() => collateralVault.value?.address || ''))
const multiplySupplyProduct = useEulerProductOfVault(computed(() => multiplySupplyVault.value?.address || ''))
const multiplyLongProduct = useEulerProductOfVault(computed(() => multiplyLongVault.value?.address || ''))
const multiplyShortProduct = useEulerProductOfVault(computed(() => multiplyShortVault.value?.address || ''))

const opportunityInfoForBorrow = computed(() => getOpportunityOfBorrowVault(pair.value?.borrow.asset.address || ''))
const opportunityInfoForCollateral = computed(() => getOpportunityOfLendVault(pair.value?.collateral.address || ''))
const collateralSupplyApy = computed(() => withIntrinsicSupplyApy(
  nanoToValue(collateralVault.value?.interestRateInfo.supplyAPY || 0n, 25),
  collateralVault.value?.asset.symbol,
))
const collateralSupplyApyWithRewards = computed(() => collateralSupplyApy.value + (opportunityInfoForCollateral.value?.apr || 0))
const borrowApy = computed(() => withIntrinsicBorrowApy(
  nanoToValue(borrowVault.value?.interestRateInfo.borrowAPY || 0n, 25),
  borrowVault.value?.asset.symbol,
))

const calculateRoe = (
  supplyUsd: number | null,
  borrowUsd: number | null,
  supplyApyValue: number | null,
  borrowApyValue: number | null,
) => {
  if (supplyUsd === null || borrowUsd === null || supplyApyValue === null || borrowApyValue === null) {
    return null
  }
  const equity = supplyUsd - borrowUsd
  if (!Number.isFinite(equity) || equity <= 0) {
    return null
  }
  const net = supplyUsd * supplyApyValue - borrowUsd * borrowApyValue
  if (!Number.isFinite(net)) {
    return null
  }
  return net / equity
}

const multiplySupplyOpportunity = computed(() => {
  return multiplySupplyVault.value ? getOpportunityOfLendVault(multiplySupplyVault.value.address) : null
})
const multiplyLongOpportunity = computed(() => {
  return multiplyLongVault.value ? getOpportunityOfLendVault(multiplyLongVault.value.address) : null
})
const multiplyBorrowOpportunity = computed(() => {
  return multiplyShortVault.value ? getOpportunityOfBorrowVault(multiplyShortVault.value.asset.address) : null
})

const multiplySupplyApy = computed(() => {
  if (!multiplySupplyVault.value) {
    return null
  }
  const base = nanoToValue(multiplySupplyVault.value.interestRateInfo.supplyAPY || 0n, 25)
  return withIntrinsicSupplyApy(base, multiplySupplyVault.value.asset.symbol) + (multiplySupplyOpportunity.value?.apr || 0)
})
const multiplyLongApy = computed(() => {
  if (!multiplyLongVault.value) {
    return null
  }
  const base = nanoToValue(multiplyLongVault.value.interestRateInfo.supplyAPY || 0n, 25)
  return withIntrinsicSupplyApy(base, multiplyLongVault.value.asset.symbol) + (multiplyLongOpportunity.value?.apr || 0)
})
const multiplyBorrowApy = computed(() => {
  if (!multiplyShortVault.value) {
    return null
  }
  const base = nanoToValue(multiplyShortVault.value.interestRateInfo.borrowAPY || 0n, 25)
  return withIntrinsicBorrowApy(base, multiplyShortVault.value.asset.symbol) - (multiplyBorrowOpportunity.value?.apr || 0)
})

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
const savingCollateral = computed(() => {
  return depositPositions.value.find(position => position.vault.address === route.params.collateral)
})
const multiplySavingPosition = computed(() => {
  if (!multiplySupplyVault.value) {
    return null
  }
  return depositPositions.value.find(
    position => normalizeAddress(position.vault.address) === normalizeAddress(multiplySupplyVault.value?.address),
  ) || null
})
const multiplySavingBalance = computed(() => {
  return multiplySavingPosition.value?.shares || 0n
})
// Reactive collateral option prices
const walletCollateralPriceUsd = ref(0)
const savingCollateralPriceUsd = ref(0)

watchEffect(async () => {
  if (!collateralVault.value) {
    walletCollateralPriceUsd.value = 0
    savingCollateralPriceUsd.value = 0
    return
  }
  walletCollateralPriceUsd.value = await getAssetUsdValueOrZero(balance.value, collateralVault.value, 'off-chain')
  if (savingCollateral.value) {
    savingCollateralPriceUsd.value = await getAssetUsdValueOrZero(savingCollateral.value.assets, collateralVault.value, 'off-chain')
  }
  else {
    savingCollateralPriceUsd.value = 0
  }
})

const collateralOptions = computed(() => {
  const options = [
    {
      type: 'wallet',
      amount: nanoToValue(balance.value, collateralVault.value?.asset.decimals),
      price: walletCollateralPriceUsd.value,
      apy: collateralSupplyApyWithRewards.value,
    },
  ]

  if (savingCollateral.value) {
    options.push({
      type: 'saving',
      amount: nanoToValue(savingCollateral.value.assets, collateralVault.value?.asset.decimals),
      price: savingCollateralPriceUsd.value,
      apy: collateralSupplyApyWithRewards.value,
    })
  }
  return options
})
const resolveMultiplySubAccount = async () => {
  if (multiplySubAccount.value) {
    return multiplySubAccount.value
  }
  if (!address.value) {
    throw new Error('Wallet not connected')
  }
  if (!multiplySubAccountPromise) {
    isMultiplySubAccountLoading.value = true
    multiplySubAccountPromise = getNewSubAccount(address.value)
      .then((subAccount) => {
        multiplySubAccount.value = subAccount
        return subAccount
      })
      .finally(() => {
        isMultiplySubAccountLoading.value = false
        multiplySubAccountPromise = null
      })
  }
  return multiplySubAccountPromise
}
const computedBalance = computed(() => {
  if (isSavingCollateral.value) return savingAssets.value || 0n
  return balance.value
})
// Use local ref instead of getBalance() - vaults loaded after initial fetch are missing from global Map
const multiplyBalance = computed(() => {
  if (!multiplySupplyVault.value) {
    return 0n
  }
  if (isMultiplySavingCollateral.value) {
    return multiplySavingPosition.value?.assets || 0n
  }
  return multiplyAssetBalance.value
})
const multiplyDebtAmountNano = computed(() => {
  if (!multiplySupplyVault.value || !multiplyShortVault.value) {
    return 0n
  }
  if (!multiplyInputAmount.value || multiplier.value <= 1) {
    return 0n
  }
  let suppliedCollateral: bigint
  try {
    suppliedCollateral = valueToNano(multiplyInputAmount.value, multiplySupplyVault.value.asset.decimals)
  }
  catch {
    return 0n
  }
  if (!suppliedCollateral) {
    return 0n
  }
  // Use helper that applies Pyth-enhanced collateral pricing from the liability vault's perspective
  // PriceResult is normalized: price per 1e18 units (no amountIn field)
  const collateralPriceInfo = getCollateralOraclePrice(multiplyShortVault.value, multiplySupplyVault.value)
  const liabilityPrice = multiplyShortVault.value.liabilityPriceInfo

  if (!collateralPriceInfo || collateralPriceInfo.amountOutMid <= 0n) {
    return 0n
  }
  if (!liabilityPrice || liabilityPrice.queryFailure || !liabilityPrice.amountOutBid || liabilityPrice.amountOutBid <= 0n || !liabilityPrice.amountIn || liabilityPrice.amountIn <= 0n) {
    return 0n
  }
  const totalAssets = multiplySupplyVault.value.totalAssets || 0n
  const totalShares = multiplySupplyVault.value.totalShares || 0n
  const collateralAsShares = totalAssets > 0n && totalShares > 0n
    ? (suppliedCollateral * totalShares) / totalAssets
    : suppliedCollateral
  const collateralOutBid = collateralPriceInfo.amountOutBid || collateralPriceInfo.amountOutMid
  // PriceResult is normalized to 1e18, so divide by ONE_18 instead of amountIn
  const suppliedCollateralValue = (collateralAsShares * collateralOutBid) / ONE_18
  if (!suppliedCollateralValue) {
    return 0n
  }
  const scaledMultiple = BigInt(Math.floor(multiplier.value * 1000))
  if (scaledMultiple <= 1000n) {
    return 0n
  }
  const multipliedCollateral = (suppliedCollateralValue * scaledMultiple) / 1000n
  if (multipliedCollateral <= suppliedCollateralValue) {
    return 0n
  }
  const totalDebtValue = multipliedCollateral - suppliedCollateralValue
  const liabilityOutBid = liabilityPrice.amountOutBid || liabilityPrice.amountOutMid
  const liabilityIn = liabilityPrice.amountIn
  return (totalDebtValue * liabilityIn) / liabilityOutBid
})
const multiplyBorrowLtv = computed(() => {
  if (!multiplySupplyVault.value || !multiplyShortVault.value) {
    return 0
  }
  const match = multiplyShortVault.value.collateralLTVs.find(
    ltv => normalizeAddress(ltv.collateral) === normalizeAddress(multiplySupplyVault.value?.address),
  )
  return match ? nanoToValue(match.borrowLTV, 2) : 0
})
const multiplyMaxMultiplier = computed(() => {
  const ltvPercent = multiplyBorrowLtv.value
  if (!ltvPercent || !Number.isFinite(ltvPercent)) {
    return 1
  }
  const ltv = ltvPercent / 100
  if (ltv <= 0 || ltv >= 0.99) {
    return 1
  }
  const max = 1 / (1 - ltv)
  return Math.max(1, Math.floor(max * 100) / 100)
})
const multiplyMinMultiplier = computed(() => {
  return multiplyMaxMultiplier.value <= 1 ? 0 : 1
})
const multiplySupplyAmountNano = computed(() => {
  if (!multiplySupplyVault.value || !multiplyInputAmount.value) {
    return 0n
  }
  try {
    return valueToNano(multiplyInputAmount.value, multiplySupplyVault.value.asset.decimals)
  }
  catch {
    return 0n
  }
})
const multiplyIsSameAsset = computed(() => {
  if (!multiplyShortVault.value || !multiplyLongVault.value) {
    return false
  }
  return normalizeAddress(multiplyShortVault.value.asset.address) === normalizeAddress(multiplyLongVault.value.asset.address)
})
const multiplySwapAmountIn = computed(() => {
  if (multiplyEffectiveQuote.value) {
    return BigInt(multiplyEffectiveQuote.value.amountIn || 0)
  }
  if (multiplyIsSameAsset.value && multiplyDebtAmountNano.value > 0n) {
    return multiplyDebtAmountNano.value
  }
  return 0n
})
const multiplySwapAmountOut = computed(() => {
  if (multiplyEffectiveQuote.value) {
    return BigInt(multiplyEffectiveQuote.value.amountOut || 0)
  }
  if (multiplyIsSameAsset.value && multiplyDebtAmountNano.value > 0n) {
    return multiplyDebtAmountNano.value
  }
  return 0n
})
const multiplySwapReady = computed(() => {
  if (isMultiplyQuoteLoading.value) {
    return false
  }
  return Boolean(multiplyEffectiveQuote.value || (multiplyIsSameAsset.value && multiplyDebtAmountNano.value > 0n))
})
// Reactive multiply USD values
const multiplySupplyValueUsd = ref<number | null>(null)
const multiplyLongValueUsd = ref<number | null>(null)
const multiplyBorrowValueUsd = ref<number | null>(null)

watchEffect(async () => {
  if (!multiplySupplyVault.value || !multiplySupplyAmountNano.value) {
    multiplySupplyValueUsd.value = null
  }
  else {
    multiplySupplyValueUsd.value = await getAssetUsdValueOrZero(multiplySupplyAmountNano.value, multiplySupplyVault.value, 'off-chain')
  }

  if (!multiplyLongVault.value || !multiplySwapAmountOut.value) {
    multiplyLongValueUsd.value = null
  }
  else {
    multiplyLongValueUsd.value = await getAssetUsdValueOrZero(multiplySwapAmountOut.value, multiplyLongVault.value, 'off-chain')
  }

  if (!multiplyShortVault.value || !multiplyDebtAmountNano.value) {
    multiplyBorrowValueUsd.value = null
  }
  else {
    multiplyBorrowValueUsd.value = await getAssetUsdValueOrZero(multiplyDebtAmountNano.value, multiplyShortVault.value, 'off-chain')
  }
})
const multiplyTotalSupplyUsd = computed(() => {
  if (multiplySupplyValueUsd.value === null) {
    return null
  }
  return multiplySupplyValueUsd.value + (multiplyLongValueUsd.value || 0)
})
const multiplyWeightedSupplyApy = computed(() => {
  if (multiplySupplyValueUsd.value === null || multiplySupplyApy.value === null) {
    return null
  }
  const longUsd = multiplyLongValueUsd.value
  const longApy = multiplyLongApy.value
  if (!longUsd || longUsd <= 0 || longApy === null) {
    return multiplySupplyApy.value
  }
  const total = multiplySupplyValueUsd.value + longUsd
  if (!Number.isFinite(total) || total <= 0) {
    return null
  }
  return (multiplySupplyValueUsd.value * multiplySupplyApy.value + longUsd * longApy) / total
})
const multiplyRoeBefore = computed(() => {
  if (isMultiplyQuoteLoading.value) {
    return null
  }
  if (multiplySupplyValueUsd.value === null) {
    return null
  }
  // New position: no existing ROE yet
  return 0
})
const multiplyRoeAfter = computed(() => {
  if (isMultiplyQuoteLoading.value) {
    return null
  }
  if (
    multiplyTotalSupplyUsd.value === null
    || multiplyBorrowValueUsd.value === null
    || multiplyWeightedSupplyApy.value === null
    || multiplyBorrowApy.value === null
  ) {
    return null
  }
  return calculateRoe(
    multiplyTotalSupplyUsd.value,
    multiplyBorrowValueUsd.value,
    multiplyWeightedSupplyApy.value,
    multiplyBorrowApy.value,
  )
})
const multiplyLiquidationLtv = computed(() => {
  if (!multiplySupplyVault.value || !multiplyShortVault.value) {
    return null
  }
  const match = multiplyShortVault.value.collateralLTVs.find(
    ltv => normalizeAddress(ltv.collateral) === normalizeAddress(multiplySupplyVault.value?.address),
  )
  return match ? nanoToValue(match.liquidationLTV, 2) : null
})
const multiplyCurrentLtv = computed(() => {
  if (isMultiplyQuoteLoading.value) {
    return null
  }
  if (multiplySupplyValueUsd.value === null || multiplySupplyValueUsd.value <= 0) {
    return null
  }
  return 0
})
const multiplyNextLtv = computed(() => {
  if (isMultiplyQuoteLoading.value) {
    return null
  }
  if (multiplyTotalSupplyUsd.value === null || multiplyBorrowValueUsd.value === null) {
    return null
  }
  if (multiplyTotalSupplyUsd.value <= 0) {
    return null
  }
  return (multiplyBorrowValueUsd.value / multiplyTotalSupplyUsd.value) * 100
})
const multiplyCurrentLiquidationLtv = computed(() => multiplyLiquidationLtv.value)
const multiplyNextLiquidationLtv = computed(() => multiplyLiquidationLtv.value)
const multiplyNextHealth = computed(() => {
  if (isMultiplyQuoteLoading.value) {
    return null
  }
  if (multiplyNextLtv.value === null || multiplyLiquidationLtv.value === null) {
    return null
  }
  if (multiplyNextLtv.value <= 0) {
    return null
  }
  return multiplyLiquidationLtv.value / multiplyNextLtv.value
})
const multiplyCurrentHealth = computed(() => {
  if (isMultiplyQuoteLoading.value) {
    return null
  }
  if (multiplyLiquidationLtv.value === null || multiplyCurrentLtv.value === null) {
    return null
  }
  if (multiplyCurrentLtv.value <= 0) {
    return Number.POSITIVE_INFINITY
  }
  return multiplyLiquidationLtv.value / multiplyCurrentLtv.value
})
const multiplyPriceRatio = computed(() => {
  if (!multiplyLongVault.value || !multiplyShortVault.value) {
    return null
  }
  // Use liability vault's (multiplyShortVault) view of collateral price
  const collateralPrice = getCollateralOraclePrice(multiplyShortVault.value, multiplyLongVault.value)
  const borrowPrice = getAssetOraclePrice(multiplyShortVault.value)
  const ask = collateralPrice?.amountOutAsk || 0n
  const bid = borrowPrice?.amountOutBid || 0n
  if (!ask || !bid) {
    return null
  }
  return nanoToValue(ask, 18) / nanoToValue(bid, 18)
})
const multiplyCurrentLiquidationPrice = computed(() => {
  if (isMultiplyQuoteLoading.value) {
    return null
  }
  if (!multiplyPriceRatio.value || !multiplyCurrentHealth.value) {
    return null
  }
  if (!Number.isFinite(multiplyCurrentHealth.value)) {
    return Number.POSITIVE_INFINITY
  }
  if (multiplyCurrentHealth.value <= 0) {
    return null
  }
  return multiplyPriceRatio.value / multiplyCurrentHealth.value
})
const multiplyNextLiquidationPrice = computed(() => {
  if (isMultiplyQuoteLoading.value) {
    return null
  }
  if (!multiplyPriceRatio.value || !multiplyNextHealth.value) {
    return null
  }
  if (multiplyNextHealth.value <= 0) {
    return null
  }
  return multiplyPriceRatio.value / multiplyNextHealth.value
})
const multiplyCurrentPrice = computed(() => {
  if (isMultiplyQuoteLoading.value) {
    return null
  }
  if (!multiplySwapReady.value || !multiplyShortVault.value || !multiplyLongVault.value) {
    return null
  }
  const amountIn = Number(ethers.formatUnits(multiplySwapAmountIn.value, Number(multiplyShortVault.value.asset.decimals)))
  const amountOut = Number(ethers.formatUnits(multiplySwapAmountOut.value, Number(multiplyLongVault.value.asset.decimals)))
  if (!amountIn || !amountOut) {
    return null
  }
  return {
    value: amountIn / amountOut,
    symbol: `${multiplyShortVault.value.asset.symbol}/${multiplyLongVault.value.asset.symbol}`,
  }
})
const multiplySwapSummary = computed(() => {
  if (isMultiplyQuoteLoading.value) {
    return null
  }
  if (!multiplySwapReady.value || !multiplyShortVault.value || !multiplyLongVault.value) {
    return null
  }
  const amountIn = ethers.formatUnits(multiplySwapAmountIn.value, Number(multiplyShortVault.value.asset.decimals))
  const amountOut = ethers.formatUnits(multiplySwapAmountOut.value, Number(multiplyLongVault.value.asset.decimals))
  return {
    from: `${formatNumber(amountIn)} ${multiplyShortVault.value.asset.symbol}`,
    to: `${formatNumber(amountOut)} ${multiplyLongVault.value.asset.symbol}`,
  }
})
// Reactive multiply price impact
const multiplyPriceImpact = ref<number | null>(null)

watchEffect(async () => {
  if (isMultiplyQuoteLoading.value) {
    multiplyPriceImpact.value = null
    return
  }
  if (!multiplySwapReady.value || !multiplyShortVault.value || !multiplyLongVault.value) {
    multiplyPriceImpact.value = null
    return
  }
  const amountInUsd = await getAssetUsdValue(multiplySwapAmountIn.value, multiplyShortVault.value, 'off-chain')
  const amountOutUsd = await getAssetUsdValue(multiplySwapAmountOut.value, multiplyLongVault.value, 'off-chain')
  if (!amountInUsd || !amountOutUsd) {
    multiplyPriceImpact.value = null
    return
  }
  const impact = (amountOutUsd / amountInUsd - 1) * 100
  if (!Number.isFinite(impact)) {
    multiplyPriceImpact.value = null
    return
  }
  multiplyPriceImpact.value = impact
})
const multiplyRoutedVia = computed(() => {
  if (isMultiplyQuoteLoading.value) {
    return null
  }
  if (!multiplyEffectiveQuote.value?.route?.length) {
    return null
  }
  return multiplyEffectiveQuote.value.route.map(route => route.providerName).join(', ')
})
const multiplyErrorText = computed(() => {
  if (!multiplySupplyVault.value || !multiplyShortVault.value) {
    return null
  }
  if (multiplyBalance.value < valueToNano(multiplyInputAmount.value, multiplySupplyVault.value.asset.decimals)) {
    return 'Not enough balance'
  }
  if (multiplyDebtAmountNano.value > 0n && (multiplyShortVault.value.supply || 0n) < multiplyDebtAmountNano.value) {
    return 'Not enough liquidity in the vault'
  }
  return null
})
const updateBalance = async () => {
  if (!isConnected.value) {
    balance.value = 0n
    savingBalance.value = 0n
    multiplyAssetBalance.value = 0n
    return
  }

  // Fetch underlying asset balance
  if (collateralVault.value?.asset.address) {
    balance.value = await fetchSingleBalance(collateralVault.value.asset.address)
  }
  else {
    balance.value = 0n
  }

  // Fetch vault share balance (for savings positions)
  if (collateralVault.value?.address) {
    savingBalance.value = await fetchVaultShareBalance(collateralVault.value.address)
  }
  else {
    savingBalance.value = 0n
  }

  // Fetch multiply supply vault's underlying asset balance
  if (multiplySupplyVault.value?.asset.address) {
    multiplyAssetBalance.value = await fetchSingleBalance(multiplySupplyVault.value.asset.address)
  }
  else {
    multiplyAssetBalance.value = 0n
  }
}
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
    ? ethers.formatUnits(longAmount, Number(multiplyLongVault.value.asset.decimals))
    : ''
  multiplyShortAmount.value = shortAmount && shortAmount > 0n
    ? ethers.formatUnits(shortAmount, Number(multiplyShortVault.value.asset.decimals))
    : ''
}
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
const resetMultiplyQuoteState = () => {
  resetMultiplyQuoteStateInternal()
  setMultiplyAmounts(null, null)
}
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
    account = (await resolveMultiplySubAccount()) as Address
  }
  catch {
    resetMultiplyQuoteState()
    multiplyQuoteError.value = 'Unable to resolve position'
    return
  }

  setMultiplyAmounts(null, null)
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
    logContext: {
      fromVault: multiplyShortVault.value?.address,
      toVault: multiplyLongVault.value?.address,
      amount: ethers.formatUnits(debtAmount, Number(multiplyShortVault.value.asset.decimals)),
      slippage: multiplySlippage.value,
      swapperMode: SwapperMode.EXACT_IN,
      isRepay: false,
    },
  })
}, 500)
watch(multiplySlippage, () => {
  clearMultiplySimulationError()
  if (!multiplyInputAmount.value) {
    resetMultiplyQuoteState()
    return
  }
  requestMultiplyQuote()
})
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
  const nextOption = multiplyCollateralOptions.value[selectedIndex]
  if (!nextVault || !nextOption) {
    return
  }
  const nextIsSaving = nextOption.type === 'saving'
  const vaultChanged = !multiplySupplyVault.value
    || normalizeAddress(multiplySupplyVault.value.address) !== normalizeAddress(nextVault.address)
  const savingChanged = nextIsSaving !== isMultiplySavingCollateral.value
  if (vaultChanged || savingChanged) {
    multiplySupplyVault.value = nextVault
    isMultiplySavingCollateral.value = nextIsSaving
    multiplyInputAmount.value = ''
    resetMultiplyQuoteState()
  }
}
const submitMultiply = async () => {
  await guardWithTerms(async () => {
    if (isMultiplySubmitting.value || !isConnected.value) {
      return
    }
    if (!multiplySupplyVault.value || !multiplyLongVault.value || !multiplyShortVault.value) {
      return
    }
    if (!multiplyInputAmount.value || multiplyDebtAmountNano.value <= 0n) {
      return
    }
    if (multiplyErrorText.value) {
      return
    }

    const supplyAmountNano = valueToNano(multiplyInputAmount.value || '0', multiplySupplyVault.value.asset.decimals)
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
    if (!supplyAmountNano || debtAmount <= 0n) {
      return
    }

    const isSameAsset = normalizeAddress(multiplyLongVault.value.asset.address) === normalizeAddress(multiplyShortVault.value.asset.address)
    const quote = isSameAsset ? null : multiplySelectedQuote.value
    if (!isSameAsset && !quote) {
      return
    }

    let subAccount: string
    try {
      subAccount = await resolveMultiplySubAccount()
    }
    catch (e) {
      console.warn('[Multiply] failed to resolve subaccount', e)
      error('Unable to resolve position')
      return
    }

    const planParams: MultiplyPlanParams = {
      supplyVaultAddress: multiplySupplyVault.value.address,
      supplyAssetAddress: multiplySupplyVault.value.asset.address,
      supplyAmount: supplyAmountNano,
      supplySharesAmount,
      supplyIsSavings: isMultiplySavingCollateral.value,
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
      console.warn('[OperationReviewModal] failed to build plan', e)
      multiplyPlan.value = null
    }

    if (multiplyPlan.value) {
      const ok = await runMultiplySimulation(multiplyPlan.value)
      if (!ok) {
        return
      }
    }

    modal.open(OperationReviewModal, {
      props: {
        type: 'borrow',
        asset: multiplyShortVault.value.asset,
        amount: multiplyShortAmount.value || ethers.formatUnits(debtAmount, Number(multiplyShortVault.value.asset.decimals)),
        plan: multiplyPlan.value || undefined,
        supplyingAssetForBorrow: multiplySupplyVault.value.asset,
        supplyingAmount: multiplyInputAmount.value,
        subAccount,
        onConfirm: () => {
          setTimeout(() => {
            sendMultiply()
          }, 400)
        },
      },
    })
  })
}
const sendMultiply = async () => {
  if (!multiplyPlanParams.value) {
    return
  }
  isMultiplySubmitting.value = true
  try {
    const plan = await buildMultiplyPlan({
      ...multiplyPlanParams.value,
      includePermit2Call: true,
    })
    multiplyPlan.value = plan
    await executeTxPlan(plan)
    modal.close()
    updateBalance()
    updateBorrowPositions(eulerLensAddresses.value, address.value || '')
    setTimeout(() => {
      router.replace('/portfolio')
    }, 400)
  }
  catch (e) {
    console.warn(e)
    error('Transaction failed')
  }
  finally {
    isMultiplySubmitting.value = false
  }
}
const submit = async () => {
  await guardWithTerms(async () => {
    // TODO: Validate
    if (!isConnected.value) {
      isSubmitting.value = false
      return
    }

    if (!borrowVault.value || !collateralVault.value) {
      return
    }

    const collateralAmountNano = valueToNano(collateralAmount.value || '0', collateralVault.value?.decimals)
    const borrowAmountNano = valueToNano(borrowAmount.value || '0', borrowVault.value?.decimals)
    let collateralAmountForPlan = collateralAmountNano

    if (isSavingCollateral.value) {
      if (savingCollateral.value?.assets === collateralAmountNano) {
        collateralAmountForPlan = savingBalance.value
      }
      else {
        collateralAmountForPlan = await convertAssetsToShares(collateralVault.value.address, collateralAmountNano)
      }
    }

    try {
      plan.value = isSavingCollateral.value
        ? await buildBorrowBySavingPlan(
          collateralVault.value.address,
          collateralAmountForPlan,
          borrowVault.value.address,
          borrowAmountNano,
        )
        : await buildBorrowPlan(
          collateralVault.value.address,
          collateralVault.value.asset.address,
          collateralAmountForPlan,
          borrowVault.value.address,
          borrowAmountNano,
          undefined,
          { includePermit2Call: false },
        )
    }
    catch (e) {
      console.warn('[OperationReviewModal] failed to build plan', e)
      plan.value = null
    }

    if (plan.value) {
      const ok = await runBorrowSimulation(plan.value)
      if (!ok) {
        return
      }
    }

    modal.open(OperationReviewModal, {
      props: {
        type: 'borrow',
        asset: borrowVault.value?.asset,
        amount: borrowAmount.value,
        plan: plan.value || undefined,
        supplyingAssetForBorrow: collateralVault.value?.asset,
        supplyingAmount: collateralAmount.value,
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
  try {
    isSubmitting.value = true
    if (!collateralVault.value || !borrowVault.value) {
      return
    }
    let collateralAmountForPlan = collateralAmountFixed.value.toFormat({ decimals: Number(collateralVault.value.decimals) }).value
    if (isSavingCollateral.value) {
      if (savingCollateral.value?.assets === collateralAmountForPlan) {
        collateralAmountForPlan = savingBalance.value
      }
      else {
        collateralAmountForPlan = await convertAssetsToShares(collateralVault.value.address, collateralAmountForPlan)
      }
    }
    const borrowAmountNano = borrowAmountFixed.value.toFormat({ decimals: Number(borrowVault.value.decimals) }).value
    const txPlan = isSavingCollateral.value
      ? await buildBorrowBySavingPlan(
        collateralVault.value.address,
        collateralAmountForPlan,
        borrowVault.value.address,
        borrowAmountNano,
      )
      : await buildBorrowPlan(
        collateralVault.value.address,
        collateralVault.value.asset.address,
        collateralAmountForPlan,
        borrowVault.value.address,
        borrowAmountNano,
        undefined,
        { includePermit2Call: true },
      )
    await executeTxPlan(txPlan)

    modal.close()
    updateBalance()
    updateBorrowPositions(eulerLensAddresses.value, address.value || '')
    setTimeout(() => {
      router.replace('/portfolio')
    }, 400)
  }
  catch (e) {
    console.warn(e)
    error('Transaction failed')
  }
  finally {
    isSubmitting.value = false
  }
}
const onSubmit = () => {
  if (formTab.value === 'borrow') {
    submit()
  }
  else if (formTab.value === 'multiply') {
    submitMultiply()
  }
}
const onChangeCollateral = (selection: boolean | number) => {
  clearBorrowSimulationError()
  if (typeof selection === 'number') {
    isSavingCollateral.value = selection === 1
    return
  }
  isSavingCollateral.value = selection
}
const onCollateralInput = async () => {
  await nextTick()
  borrowAmount.value = collateralAmountFixed.value
    .mul(priceFixed.value)
    .mul(ltvFixed.value)
    .div(FixedNumber.fromValue(100n)).round(Number(borrowVault.value?.decimals || 18))
    .toString()
}
const onBorrowInput = async () => {
  await nextTick()
  if (!collateralAmount.value) {
    return
  }
  ltv.value = +borrowAmountFixed.value
    .div(collateralAmountFixed.value.mul(priceFixed.value))
    .mul(FixedNumber.fromValue(100n))
    .toUnsafeFloat().toFixed(2)
}
const onLtvInput = async () => {
  await nextTick()
  onCollateralInput()
}
const updateEstimates = useDebounceFn(async () => {
  if (!pair.value) {
    return
  }
  try {
    await Promise.all([updateVault(collateralVault.value!.address), updateVault(borrowVault.value!.address)])
  }
  catch (e) {
    console.error(e)
  }
  try {
    health.value = ltvFixed.value.toUnsafeFloat() <= 0
      ? Infinity
      : (Number(pair.value?.liquidationLTV || 0n) / 100) / ltvFixed.value.toUnsafeFloat()
    liquidationPrice.value = health.value < 0.1 ? Infinity : priceFixed.value.toUnsafeFloat() / health.value
    const collateralUsdValue = await getAssetUsdValueOrZero(+collateralAmount.value || 0, collateralVault.value!, 'off-chain')
    const borrowUsdValue = await getAssetUsdValueOrZero(+borrowAmount.value || 0, borrowVault.value!, 'off-chain')
    netAPY.value = getNetAPY(
      collateralUsdValue,
      collateralSupplyApy.value,
      borrowUsdValue,
      borrowApy.value,
      opportunityInfoForCollateral.value?.apr || null,
      opportunityInfoForBorrow.value?.apr || null,
    )
  }
  catch (e) {
    console.warn(e)
    health.value = undefined
    liquidationPrice.value = undefined
    netAPY.value = undefined
  }
  finally {
    isEstimatesLoading.value = false
  }
}, 1000)

// Check if vault uses Pyth oracles (requires fresh prices)
const hasPythOracles = (vault: Vault | undefined): boolean => {
  if (!vault) return false
  const feeds = collectPythFeedIds(vault.oracleDetailedInfo)
  return feeds.length > 0
}

// Check if borrow vault has a price failure (liabilityPriceInfo missing or query failed)
// Note: 0n is a valid price (very small value), so we don't treat it as failure
const hasBorrowPriceFailure = (vault: Vault | undefined): boolean => {
  if (!vault) return false
  return (
    vault.liabilityPriceInfo?.queryFailure ||
    vault.liabilityPriceInfo?.amountOutMid === undefined ||
    vault.liabilityPriceInfo?.amountOutMid === null
  )
}

// Check if borrow vault has a collateral price failure for the given collateral
// Note: 0n is a valid price (very small value), so we don't treat it as failure
const hasCollateralPriceFailure = (borrowVault: Vault | undefined, collateralAddress: string | undefined): boolean => {
  if (!borrowVault || !collateralAddress) return false
  const collateralPrice = borrowVault.collateralPrices.find(
    p => p.asset.toLowerCase() === collateralAddress.toLowerCase(),
  )
  if (!collateralPrice) return true // No price entry = failure
  return (
    collateralPrice.queryFailure ||
    collateralPrice.amountOutMid === undefined ||
    collateralPrice.amountOutMid === null
  )
}

// Check if vault needs refresh (Pyth detected OR price failure)
const needsRefresh = (vault: Vault | undefined): boolean => {
  return hasPythOracles(vault) || hasBorrowPriceFailure(vault)
}

// Check if borrow vault needs refresh due to collateral price failure
const needsRefreshForCollateral = (borrowVault: Vault | undefined, collateralAddress: string | undefined): boolean => {
  return hasPythOracles(borrowVault) || hasCollateralPriceFailure(borrowVault, collateralAddress)
}

// Track vaults that have been refreshed to avoid infinite retry loops
const refreshedVaultAddresses = new Set<string>()

// Clear refresh tracking when navigating to a different borrow pair
watch(pair, (newVal, oldVal) => {
  if (oldVal && newVal) {
    const newBorrow = newVal.borrow.address.toLowerCase()
    const oldBorrow = oldVal.borrow.address.toLowerCase()
    if (newBorrow !== oldBorrow) {
      refreshedVaultAddresses.clear()
    }
  }
}, { immediate: false })

// Clear on unmount to prevent memory leaks
onUnmounted(() => {
  refreshedVaultAddresses.clear()
})

watch(pair, async (val) => {
  if (!val) {
    return
  }

  // Refresh borrow vault if it uses Pyth oracles, has a price failure, or has collateral price failure
  // Pyth prices are only valid for ~2 minutes, so always refresh when Pyth is detected
  // Collateral prices come from borrow.collateralPrices[], so refresh borrow vault if those fail
  const borrowAddr = val.borrow.address.toLowerCase()
  const collateralAddr = val.collateral.address

  const borrowNeedsRefresh = needsRefresh(val.borrow) || needsRefreshForCollateral(val.borrow, collateralAddr)

  if (borrowNeedsRefresh && !refreshedVaultAddresses.has(borrowAddr)) {
    refreshedVaultAddresses.add(borrowAddr)
    const refreshedBorrow = await updateVault(val.borrow.address)
    pair.value = {
      ...val,
      borrow: refreshedBorrow,
    } as AnyBorrowVaultPair
    val = pair.value
  }

  // Also refresh collateral vault if it uses Pyth oracles or has a price failure (only for regular Vaults, not SecuritizeVault)
  // Note: Collateral prices in borrow context come from borrow.collateralPrices[], but collateral vault
  // may have its own Pyth oracles for its own liabilityPriceInfo (e.g., when viewed directly on lend page)
  if ('liabilityPriceInfo' in val.collateral) {
    const collateralVaultTyped = val.collateral as Vault
    const collateralAddr = collateralVaultTyped.address.toLowerCase()

    if (needsRefresh(collateralVaultTyped) && !refreshedVaultAddresses.has(collateralAddr)) {
      refreshedVaultAddresses.add(collateralAddr)
      const refreshedCollateral = await updateVault(collateralVaultTyped.address)
      pair.value = {
        ...pair.value,
        collateral: refreshedCollateral,
      } as AnyBorrowVaultPair
      val = pair.value
    }
  }

  const supplyAddress = normalizeAddress(multiplySupplyVault.value?.address)
  const isSupplyAllowed = supplyAddress
    ? val.borrow.collateralLTVs.some(ltv => normalizeAddress(ltv.collateral) === supplyAddress)
    : false
  if (!multiplySupplyVault.value || !isSupplyAllowed) {
    multiplySupplyVault.value = val.collateral
    isMultiplySavingCollateral.value = false
  }
  if (!val.collateral.verified) {
    modal.open(VaultUnverifiedDisclaimerModal, {
      isNotClosable: true,
      props: {
        onCancel: () => {
          router.replace('/')
        },
      },
    })
  }
  // Fetch fresh underlying asset balance for this specific vault
  await updateBalance()
}, { immediate: true })
watch(address, () => {
  multiplySubAccount.value = null
  multiplySubAccountPromise = null
})
watch([collateralAmount, borrowAmount], async () => {
  clearBorrowSimulationError()
  if (!pair.value) {
    return
  }
  if (!isEstimatesLoading.value) {
    isEstimatesLoading.value = true
  }
  updateEstimates()
})
watch(savingCollateral, (val) => {
  if (val?.assets && !savingAssets.value) {
    savingAssets.value = val.assets
  }
})
watch([multiplySupplyVault, multiplyLongVault, multiplyShortVault, isMultiplySavingCollateral], () => {
  clearMultiplySimulationError()
  resetMultiplyQuoteState()
  if (multiplyInputAmount.value) {
    requestMultiplyQuote()
  }
})
watch(multiplySupplyVault, async (newVault) => {
  if (newVault?.asset.address && isConnected.value) {
    multiplyAssetBalance.value = await fetchSingleBalance(newVault.asset.address)
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
    if (next > max) {
      next = max
    }
    if (next < min) {
      next = min
    }
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
watch(formTab, () => {
  clearBorrowSimulationError()
  clearMultiplySimulationError()
})
</script>

<template>
  <div class="flex gap-32">
    <div class="flex flex-col gap-16 w-full">
      <BaseBackButton class="laptop:!hidden" />
      <VaultForm
        title="Open borrow position"
        class="flex flex-col gap-16 w-full min-w-0"
        @submit.prevent="onSubmit"
      >
        <template v-if="pair">
          <UiTabs
            v-model="formTab"
            class="mb-12"
            rounded
            pills
            :list="formTabs"
          />

          <VaultLabelsAndAssets
            v-if="collateralVault && borrowVault"
            :vault="collateralVault"
            :pair-vault="borrowVault"
            :assets="pairAssets as VaultAsset[]"
            size="large"
          />

          <template v-if="formTab === 'borrow'">
            <AssetInput
              v-if="collateralVault"
              v-model="collateralAmount"
              :desc="collateralProduct.name"
              :label="`Supply ${collateralVault.asset.symbol}`"
              :asset="collateralVault.asset"
              :price-override="collateralUnitPrice"
              :balance="computedBalance"
              :collateral-options="collateralOptions as CollateralOption[]"
              maxable
              @input="onCollateralInput"
              @change-collateral="onChangeCollateral"
            />

            <UiRange
              v-model="ltv"
              label="LTV"
              :step="0.1"
              :max="Number(pair.borrowLTV / 100n)"
              :number-filter="(n: number) => `${formatNumber(n, 2, 0)}%`"
              @update:model-value="onLtvInput"
            />

            <AssetInput
              v-if="borrowVault"
              v-model="borrowAmount"
              :desc="borrowProduct.name"
              :label="`Borrow ${borrowVault.asset.symbol}`"
              :asset="borrowVault.asset"
              :vault="borrowVault"
              @input="onBorrowInput"
            />

            <UiToast
              v-show="errorText"
              title="Error"
              variant="error"
              :description="errorText || ''"
              size="compact"
            />
            <UiToast
              v-if="borrowSimulationError"
              title="Error"
              variant="error"
              :description="borrowSimulationError"
              size="compact"
            />

            <VaultFormInfoBlock
              v-if="pair"
              :loading="isEstimatesLoading"
              class="bg-surface-secondary p-16 rounded-16 flex flex-col gap-16 shadow-card"
            >
              <div class="flex justify-between items-center">
                <p class="text-content-tertiary">
                  Net APY
                </p>
                <p class="text-p2">
                  {{ netAPY ? `${formatNumber(netAPY)}%` : '-' }}
                </p>
              </div>
              <div class="flex justify-between items-center">
                <p class="text-content-tertiary">
                  Current Price
                </p>
                <p class="text-p2">
                  {{ !priceFixed.isZero() ? formatNumber(priceFixed.toUnsafeFloat()) : '-' }}
                  <span class="text-content-tertiary text-p3">
                    {{ collateralVault?.asset.symbol }}/{{ borrowVault?.asset.symbol }}
                  </span>
                </p>
              </div>
              <div class="flex justify-between items-center">
                <p class="text-euler-dark-900">
                  Liquidation price
                </p>
                <p class="text-p2">
                  {{ liquidationPrice ? formatNumber(liquidationPrice, 4) : '-' }}
                  <span class="text-content-tertiary text-p3">
                    {{ collateralVault?.asset.symbol }}
                  </span>
                </p>
              </div>
              <div class="flex justify-between items-center">
                <p class="text-content-tertiary">
                  Health
                </p>
                <p class="text-p2">
                  {{ health ? formatNumber(health, 2) : '-' }}
                </p>
              </div>
            </VaultFormInfoBlock>
          </template>

          <template v-else-if="multiplySupplyVault && multiplyLongVault && multiplyShortVault">
            <div class="grid gap-16 laptop:items-start">
              <div class="flex flex-col gap-16 w-full">
                <AssetInput
                  v-model="multiplyInputAmount"
                  :desc="multiplySupplyProduct.name"
                  :label="`Supply ${multiplySupplyVault.asset.symbol}`"
                  :asset="multiplySupplyVault.asset"
                  :vault="multiplySupplyVault"
                  :balance="multiplyBalance"
                  :collateral-options="multiplyCollateralOptions"
                  maxable
                  @input="onMultiplyInput"
                  @change-collateral="onMultiplyCollateralChange"
                />

                <UiRange
                  v-model="multiplier"
                  label="Multiplier"
                  :step="0.1"
                  :min="multiplyMinMultiplier"
                  :max="multiplyMaxMultiplier"
                  :number-filter="(n: number) => `${formatNumber(n, 2, 0)}x`"
                  @update:model-value="onMultiplierInput"
                />

                <SwapRouteSelector
                  :items="multiplyRouteItems"
                  :selected-provider="multiplySelectedProvider"
                  :status-label="multiplyQuotesStatusLabel"
                  :is-loading="isMultiplyQuoteLoading"
                  :empty-message="multiplyRouteEmptyMessage"
                  @select="selectMultiplyQuote"
                />

                <AssetInput
                  v-model="multiplyLongAmount"
                  :desc="multiplyLongProduct.name"
                  label="Long"
                  :asset="multiplyLongVault.asset"
                  :vault="multiplyLongVault"
                  :readonly="true"
                />

                <AssetInput
                  v-model="multiplyShortAmount"
                  :desc="multiplyShortProduct.name"
                  label="Short"
                  :asset="multiplyShortVault.asset"
                  :vault="multiplyShortVault"
                  :readonly="true"
                />

                <UiToast
                  v-show="multiplyErrorText"
                  title="Error"
                  variant="error"
                  :description="multiplyErrorText || ''"
                  size="compact"
                />
                <UiToast
                  v-if="multiplySimulationError"
                  title="Error"
                  variant="error"
                  :description="multiplySimulationError"
                  size="compact"
                />

                <UiToast
                  v-if="multiplyQuoteError"
                  title="Swap quote"
                  variant="warning"
                  :description="multiplyQuoteError"
                  size="compact"
                />
              </div>

              <div class="flex flex-col gap-16 w-full">
                <VaultFormInfoBlock
                  :loading="isMultiplyQuoteLoading"
                  class="bg-surface-secondary p-16 rounded-16 flex flex-col gap-16 w-full shadow-card"
                >
                  <div class="flex justify-between items-center">
                    <p class="text-content-tertiary">
                      ROE
                    </p>
                    <p class="text-p2">
                      <template v-if="multiplyRoeBefore !== null && multiplyRoeAfter !== null && multiplySwapReady">
                        <span class="text-content-tertiary">{{ formatNumber(multiplyRoeBefore) }}%</span>
                        → <span class="text-content-primary">{{ formatNumber(multiplyRoeAfter) }}%</span>
                      </template>
                      <template v-else>
                        {{ multiplyRoeBefore !== null ? `${formatNumber(multiplyRoeBefore)}%` : '-' }}
                      </template>
                    </p>
                  </div>
                  <div class="flex justify-between items-center">
                    <p class="text-content-tertiary">
                      Current price
                    </p>
                    <p class="text-p2">
                      {{ multiplyCurrentPrice ? `${formatNumber(multiplyCurrentPrice.value)} ${multiplyCurrentPrice.symbol}` : '-' }}
                    </p>
                  </div>
                  <div class="flex justify-between items-center">
                    <p class="text-content-tertiary">
                      Liquidation price
                    </p>
                    <p class="text-p2">
                      <template v-if="multiplyCurrentLiquidationPrice !== null && multiplyNextLiquidationPrice !== null && multiplySwapReady">
                        <span class="text-content-tertiary">{{ formatNumber(multiplyCurrentLiquidationPrice, 4) }}</span>
                        → <span class="text-content-primary">{{ formatNumber(multiplyNextLiquidationPrice, 4) }}</span>
                      </template>
                      <template v-else>
                        {{ multiplyCurrentLiquidationPrice !== null ? formatNumber(multiplyCurrentLiquidationPrice, 4) : '-' }}
                      </template>
                      <span class="text-content-tertiary text-p3">
                        {{ multiplyLongVault?.asset.symbol }}
                      </span>
                    </p>
                  </div>
                  <div class="flex justify-between items-center">
                    <p class="text-content-tertiary">
                      Your LTV (LLTV)
                    </p>
                    <p class="text-p2 text-right">
                      <template v-if="multiplyCurrentLtv !== null && multiplyCurrentLiquidationLtv !== null && multiplyNextLtv !== null && multiplyNextLiquidationLtv !== null && multiplySwapReady">
                        <span class="text-content-tertiary">
                          {{ formatNumber(multiplyCurrentLtv) }}%
                          <span class="text-content-tertiary text-p3">
                            ({{ formatNumber(multiplyCurrentLiquidationLtv) }}%)
                          </span>
                        </span>
                        → <span class="text-content-primary">
                          {{ formatNumber(multiplyNextLtv) }}%
                          <span class="text-content-tertiary text-p3">
                            ({{ formatNumber(multiplyNextLiquidationLtv) }}%)
                          </span>
                        </span>
                      </template>
                      <template v-else>
                        <span v-if="multiplyCurrentLtv !== null && multiplyCurrentLiquidationLtv !== null">
                          {{ formatNumber(multiplyCurrentLtv) }}%
                          <span class="text-content-tertiary text-p3">
                            ({{ formatNumber(multiplyCurrentLiquidationLtv) }}%)
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
                      <template v-if="multiplyCurrentHealth !== null && multiplyNextHealth !== null && multiplySwapReady">
                        <span class="text-content-tertiary">{{ formatNumber(multiplyCurrentHealth, 2) }}</span>
                        → <span class="text-content-primary">{{ formatNumber(multiplyNextHealth, 2) }}</span>
                      </template>
                      <template v-else>
                        {{ multiplyCurrentHealth !== null ? formatNumber(multiplyCurrentHealth, 2) : '-' }}
                      </template>
                    </p>
                  </div>
                  <div class="flex justify-between items-start">
                    <p class="text-content-tertiary">
                      Swap
                    </p>
                    <p class="text-p2 text-right flex flex-col items-end">
                      <span>{{ multiplySwapSummary ? multiplySwapSummary.from : '-' }}</span>
                      <span
                        v-if="multiplySwapSummary"
                        class="text-content-tertiary text-p3"
                      >
                        {{ multiplySwapSummary.to }}
                      </span>
                    </p>
                  </div>
                  <div class="flex justify-between items-center">
                    <p class="text-content-tertiary">
                      Price impact
                    </p>
                    <p class="text-p2">
                      {{ multiplyPriceImpact !== null ? `${formatNumber(multiplyPriceImpact, 2, 2)}%` : '-' }}
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
                      <span>{{ formatNumber(multiplySlippage, 2, 0) }}%</span>
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
                      {{ multiplyRoutedVia || '-' }}
                    </p>
                  </div>
                </VaultFormInfoBlock>
              </div>
            </div>
          </template>
        </template>

        <template #buttons>
          <VaultFormInfoButton
            :pair="pair"
            :extra-vault="formTab === 'multiply' ? multiplySupplyVault : undefined"
            class="laptop:!hidden"
          />
          <VaultFormSubmit
            v-if="formTab === 'borrow'"
            :disabled="reviewBorrowDisabled"
            :loading="isSubmitting"
          >
            {{ reviewBorrowLabel }}
          </VaultFormSubmit>
          <VaultFormSubmit
            v-else-if="formTab === 'multiply'"
            :disabled="reviewMultiplyDisabled"
            :loading="isMultiplySubmitting"
          >
            {{ reviewMultiplyLabel }}
          </VaultFormSubmit>
        </template>
      </VaultForm>
    </div>
    <div
      v-if="pair"
      class="w-full min-w-0 mobile:hidden"
    >
      <UiTabs
        v-if="tabs.length"
        v-model="tab"
        class="mb-12 min-w-0"
        :list="tabs"
      >
        <template #default="{ tab: slotTab }">
          <div class="flex items-center gap-8">
            <BaseAvatar :src="slotTab.avatars as string[]" :label="slotTab.symbols" />

            {{ slotTab.label }}
          </div>
        </template>
      </UiTabs>
      <Transition
        name="page"
        mode="out-in"
      >
        <VaultOverviewPair
          v-if="!tab"
          :pair="pair"
          style="flex-grow: 1"
          desktop-overview
        />
        <SecuritizeVaultOverview
          v-else-if="tab === 'collateral' && isSecuritizeCollateral"
          :vault="(pair.collateral as SecuritizeVault)"
          desktop-overview
        />
        <VaultOverview
          v-else-if="tab === 'collateral'"
          :vault="(pair.collateral as Vault)"
          desktop-overview
          @vault-click="(address: string) => router.push(`/lend/${address}`)"
        />
        <VaultOverview
          v-else-if="tab === 'multiply-collateral' && multiplySupplyVault"
          :vault="multiplySupplyVault"
          desktop-overview
          @vault-click="(address: string) => router.push(`/lend/${address}`)"
        />
        <VaultOverview
          v-else-if="tab === 'borrow'"
          :vault="pair.borrow"
          desktop-overview
          @vault-click="(address: string) => router.push(`/lend/${address}`)"
        />
      </Transition>
    </div>
  </div>
</template>
