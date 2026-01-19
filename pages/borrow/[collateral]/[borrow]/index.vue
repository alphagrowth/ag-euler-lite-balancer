<script setup lang="ts">
import { useAccount } from '@wagmi/vue'
import { ethers, FixedNumber } from 'ethers'
import { type Address } from 'viem'
import { useModal } from '~/components/ui/composables/useModal'
import { OperationReviewModal, VaultUnverifiedDisclaimerModal } from '#components'
import { useToast } from '~/components/ui/composables/useToast'
import { type BorrowVaultPair, getNetAPY, getVaultPrice, getVaultPriceInfo, type VaultAsset, type CollateralOption, type Vault, convertAssetsToShares } from '~/entities/vault'
import { getNewSubAccount } from '~/entities/account'
import { useEulerProductOfVault } from '~/composables/useEulerLabels'
import { useMultiplyCollateralOptions } from '~/composables/useMultiplyCollateralOptions'
import { useSwapApi } from '~/composables/useSwapApi'
import { type SwapApiQuote, SwapperMode } from '~/entities/swap'
import type { TxPlan } from '~/entities/txPlan'

const router = useRouter()
const route = useRoute()
const modal = useModal()
const { error } = useToast()
const { borrowBySaving, borrow, buildBorrowPlan, buildBorrowBySavingPlan, buildMultiplyPlan, executeTxPlan } = useEulerOperations()
const { getBorrowVaultPair, updateVault, isReady: areVaultsReady } = useVaults()
const { address, isConnected } = useAccount()
const { updateBorrowPositions, depositPositions } = useEulerAccount()
const { getOpportunityOfBorrowVault, getOpportunityOfLendVault } = useMerkl()
const { withIntrinsicBorrowApy, withIntrinsicSupplyApy } = useIntrinsicApy()
const { eulerLensAddresses } = useEulerAddresses()
const { getBalance } = useWallets()
const { getSwapQuotes, getSwapProviders, logSwapFailure } = useSwapApi()

type MultiplyQuoteCard = {
  provider: string
  quote: SwapApiQuote
}
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
const pair: Ref<BorrowVaultPair | undefined> = ref(await getBorrowVaultPair(route.params.collateral as string, route.params.borrow as string))
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
const multiplyQuoteCards = ref<MultiplyQuoteCard[]>([])
const multiplySelectedProvider = ref<string | null>(null)
const multiplyProvidersCount = ref(0)
const multiplyProvidersFetchedCount = ref(0)
const isMultiplyQuoteLoading = ref(false)
const multiplyQuoteError = ref<string | null>(null)
const multiplySlippage = ref(0.5)
let multiplyQuoteAbort: AbortController | null = null
let multiplyQuoteRequestId = 0
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
const borrowVault = computed(() => pair.value?.borrow)
const collateralVault = computed(() => pair.value?.collateral)
const multiplyLongVault = computed(() => collateralVault.value)
const pairAssets = computed(() => [collateralVault.value?.asset, borrowVault.value?.asset])
const priceFixed = computed(() => {
  const collateralPrice = collateralVault.value ? getVaultPriceInfo(collateralVault.value) : undefined
  const borrowPrice = borrowVault.value ? getVaultPriceInfo(borrowVault.value) : undefined
  const ask = collateralPrice?.amountOutAsk || 0n
  const bid = borrowPrice?.amountOutBid || 1n
  return FixedNumber.fromValue(ask, 18).div(FixedNumber.fromValue(bid, 18))
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
  return [
    {
      label: 'Pair details',
      value: undefined,
      avatars: [getAssetLogoUrl(pair.value.collateral.asset.symbol), getAssetLogoUrl(pair.value.borrow.asset.symbol)],
    },
    {
      label: pair.value.collateral.asset.symbol,
      value: 'collateral',
      avatars: [getAssetLogoUrl(pair.value.collateral.asset.symbol)],
    },
    {
      label: pair.value.borrow.asset.symbol,
      value: 'borrow',
      avatars: [getAssetLogoUrl(pair.value.borrow.asset.symbol)],
    },
  ]
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

const multiplyShortVault = computed(() => borrowVault.value)
const { collateralOptions: multiplyCollateralOptions, collateralVaults: multiplyCollateralVaults } = useMultiplyCollateralOptions({
  currentVault: multiplySupplyVault,
  liabilityVault: multiplyShortVault,
})
const getQuoteAmountOut = (quote?: SwapApiQuote | null) => {
  try {
    return BigInt(quote?.amountOut || 0)
  }
  catch {
    return 0n
  }
}
const sortMultiplyQuotes = (cards: MultiplyQuoteCard[]) => {
  return [...cards].sort((a, b) => {
    const outA = getQuoteAmountOut(a.quote)
    const outB = getQuoteAmountOut(b.quote)
    if (outB > outA) return 1
    if (outB < outA) return -1
    return 0
  })
}
const multiplyQuoteCardsSorted = computed(() => sortMultiplyQuotes(multiplyQuoteCards.value))
const multiplyBestQuote = computed(() => multiplyQuoteCardsSorted.value[0]?.quote || null)
const multiplyBestAmountOut = computed(() => getQuoteAmountOut(multiplyBestQuote.value))
const multiplySelectedQuote = computed(() => {
  if (!multiplySelectedProvider.value) {
    return null
  }
  const match = multiplyQuoteCards.value.find(card => card.provider === multiplySelectedProvider.value)
  return match?.quote || null
})
const multiplyEffectiveQuote = computed(() => multiplySelectedQuote.value || multiplyBestQuote.value)
const multiplyQuotesStatusLabel = computed(() => {
  if (!multiplyProvidersCount.value) {
    return null
  }
  const current = Math.min(multiplyProvidersFetchedCount.value, multiplyProvidersCount.value)
  const total = multiplyProvidersCount.value
  return current < total
    ? `Fetching quotes ${current}/${total}`
    : `Quotes returned ${current}/${total}`
})
const getQuoteDiffPct = (quote: SwapApiQuote) => {
  const bestOut = multiplyBestAmountOut.value
  const amountOut = getQuoteAmountOut(quote)
  if (bestOut <= 0n || amountOut <= 0n || amountOut === bestOut) {
    return null
  }
  const diffBps = ((bestOut - amountOut) * 10_000n) / bestOut
  return Number(diffBps) / 100
}

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
  if (!multiplySupplyVault.value) {
    return 0n
  }
  return getBalance(multiplySupplyVault.value.address as `0x${string}`) || 0n
})
const collateralOptions = computed(() => {
  const options = [
    {
      type: 'wallet',
      amount: nanoToValue(balance.value, collateralVault.value?.asset.decimals),
      price: getVaultPrice(nanoToValue(balance.value, collateralVault.value?.asset.decimals) || 0, collateralVault.value!),
      apy: collateralSupplyApyWithRewards.value,
    },
  ]

  if (savingCollateral.value) {
    options.push({
      type: 'saving',
      amount: nanoToValue(savingCollateral.value.assets, collateralVault.value?.asset.decimals),
      price: getVaultPrice(nanoToValue(savingCollateral.value.assets, collateralVault.value?.asset.decimals) || 0, collateralVault.value!),
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
const multiplyBalance = computed(() => {
  if (!multiplySupplyVault.value) {
    return 0n
  }
  if (isMultiplySavingCollateral.value) {
    return multiplySavingPosition.value?.assets || 0n
  }
  return getBalance(multiplySupplyVault.value.asset.address as `0x${string}`) || 0n
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
  const collateralPriceInfo = multiplyShortVault.value.collateralPrices.find(
    price => normalizeAddress(price.asset) === normalizeAddress(multiplySupplyVault.value?.address)
      || normalizeAddress(price.asset) === normalizeAddress(multiplySupplyVault.value?.asset.address),
  )
  const liabilityPrice = multiplyShortVault.value.liabilityPriceInfo
  const collateralOutBid = collateralPriceInfo?.amountOutBid || collateralPriceInfo?.amountOutMid || 0n
  const collateralIn = collateralPriceInfo?.amountIn || 0n
  const liabilityOutBid = liabilityPrice?.amountOutBid || liabilityPrice?.amountOutMid || 0n
  const liabilityIn = liabilityPrice?.amountIn || 0n
  if (!collateralIn || !collateralOutBid || !liabilityIn || !liabilityOutBid) {
    return 0n
  }
  const totalAssets = multiplySupplyVault.value.totalAssets || 0n
  const totalShares = multiplySupplyVault.value.totalShares || 0n
  const collateralAsShares = totalAssets > 0n && totalShares > 0n
    ? (suppliedCollateral * totalShares) / totalAssets
    : suppliedCollateral
  const suppliedCollateralValue = (collateralAsShares * collateralOutBid) / collateralIn
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
const multiplySupplyValueUsd = computed(() => {
  if (!multiplySupplyVault.value) {
    return null
  }
  if (!multiplySupplyAmountNano.value) {
    return null
  }
  return getVaultPrice(multiplySupplyAmountNano.value, multiplySupplyVault.value)
})
const multiplyLongValueUsd = computed(() => {
  if (!multiplyLongVault.value) {
    return null
  }
  if (!multiplySwapAmountOut.value) {
    return null
  }
  return getVaultPrice(multiplySwapAmountOut.value, multiplyLongVault.value)
})
const multiplyBorrowValueUsd = computed(() => {
  if (!multiplyShortVault.value) {
    return null
  }
  if (!multiplyDebtAmountNano.value) {
    return null
  }
  return getVaultPrice(multiplyDebtAmountNano.value, multiplyShortVault.value)
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
  if (multiplySupplyValueUsd.value === null || multiplySupplyApy.value === null) {
    return null
  }
  return calculateRoe(
    multiplySupplyValueUsd.value,
    0,
    multiplySupplyApy.value,
    multiplyBorrowApy.value || 0,
  )
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
    return multiplyNextHealth.value
  }
  return multiplyLiquidationLtv.value / multiplyCurrentLtv.value
})
const multiplyPriceRatio = computed(() => {
  if (!multiplyLongVault.value || !multiplyShortVault.value) {
    return null
  }
  const collateralPrice = getVaultPriceInfo(multiplyLongVault.value)
  const borrowPrice = getVaultPriceInfo(multiplyShortVault.value)
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
const multiplyPriceImpact = computed(() => {
  if (isMultiplyQuoteLoading.value) {
    return null
  }
  if (!multiplySwapReady.value || !multiplyShortVault.value || !multiplyLongVault.value) {
    return null
  }
  const amountInUsd = getVaultPrice(multiplySwapAmountIn.value, multiplyShortVault.value)
  const amountOutUsd = getVaultPrice(multiplySwapAmountOut.value, multiplyLongVault.value)
  if (!amountInUsd || !amountOutUsd) {
    return null
  }
  const impact = (amountOutUsd / amountInUsd - 1) * 100
  if (!Number.isFinite(impact)) {
    return null
  }
  return impact
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
    return
  }
  balance.value = getBalance(collateralVault.value?.asset.address as `0x${string}`) || 0n
  savingBalance.value = getBalance(collateralVault.value?.address as `0x${string}`) || 0n
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
const upsertMultiplyQuote = (provider: string, quote: SwapApiQuote) => {
  const next = multiplyQuoteCards.value.filter(card => card.provider !== provider)
  next.push({ provider, quote })
  multiplyQuoteCards.value = sortMultiplyQuotes(next)
  if (isMultiplyQuoteLoading.value && next.length > 0) {
    isMultiplyQuoteLoading.value = false
  }
}
const selectMultiplyQuote = (provider: string) => {
  multiplySelectedProvider.value = provider
}
watch(multiplyQuoteCards, (next) => {
  if (!next.length) {
    multiplySelectedProvider.value = null
    return
  }
  if (
    multiplySelectedProvider.value
    && !next.some(card => card.provider === multiplySelectedProvider.value)
  ) {
    multiplySelectedProvider.value = null
  }
})
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
  multiplyQuoteCards.value = []
  multiplySelectedProvider.value = null
  multiplyProvidersCount.value = 0
  multiplyProvidersFetchedCount.value = 0
  multiplyQuoteError.value = null
  if (multiplyQuoteAbort) {
    multiplyQuoteAbort.abort()
    multiplyQuoteAbort = null
  }
  multiplyQuoteRequestId += 1
  isMultiplyQuoteLoading.value = false
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

  if (multiplyQuoteAbort) {
    multiplyQuoteAbort.abort()
  }
  const controller = new AbortController()
  multiplyQuoteAbort = controller
  const requestId = ++multiplyQuoteRequestId

  isMultiplyQuoteLoading.value = true
  multiplyQuoteCards.value = []
  multiplySelectedProvider.value = null
  multiplyProvidersFetchedCount.value = 0
  multiplyProvidersCount.value = 0
  setMultiplyAmounts(null, null)
  try {
    const providers = await getSwapProviders()
    if (requestId !== multiplyQuoteRequestId) {
      return
    }
    multiplyProvidersCount.value = providers.length

    if (!providers.length) {
      multiplyQuoteError.value = 'No swap providers available'
      return
    }

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
    const fetchProviderQuote = async (provider: string) => {
      try {
        const data = await getSwapQuotes({
          ...requestParams,
          provider,
        }, { signal: controller.signal })

        if (requestId !== multiplyQuoteRequestId) {
          return
        }

        const best = data.reduce<SwapApiQuote | null>((current, quote) => {
          if (!current) return quote
          const currentOut = getQuoteAmountOut(current)
          const nextOut = getQuoteAmountOut(quote)
          return nextOut > currentOut ? quote : current
        }, null)

        if (best) {
          upsertMultiplyQuote(provider, best)
        }
      }
      catch (err) {
        const error = err as { name?: string; message?: string }
        if (error?.name === 'CanceledError' || error?.name === 'AbortError') {
          return
        }
        logSwapFailure({
          reason: error?.message || 'Unknown error',
          provider,
          fromVault: multiplyShortVault.value?.address,
          toVault: multiplyLongVault.value?.address,
          amount: ethers.formatUnits(debtAmount, Number(multiplyShortVault.value.asset.decimals)),
          slippage: multiplySlippage.value,
          swapperMode: SwapperMode.EXACT_IN,
          isRepay: false,
        })
      }
      finally {
        if (requestId !== multiplyQuoteRequestId) {
          return
        }
        multiplyProvidersFetchedCount.value += 1
        if (multiplyProvidersFetchedCount.value >= multiplyProvidersCount.value) {
          isMultiplyQuoteLoading.value = false
          if (!multiplyQuoteCards.value.length) {
            multiplyQuoteError.value = 'Unable to fetch swap quote'
          }
        }
      }
    }

    providers.forEach((provider) => {
      void fetchProviderQuote(provider)
    })
  }
  catch (err) {
    const error = err as { name?: string; message?: string }
    if (error?.name === 'CanceledError' || error?.name === 'AbortError') {
      return
    }
    multiplyQuoteError.value = 'Unable to fetch swap quote'
    multiplyQuoteCards.value = []
  }
  finally {
    if (requestId === multiplyQuoteRequestId) {
      if (multiplyProvidersFetchedCount.value >= multiplyProvidersCount.value) {
        isMultiplyQuoteLoading.value = false
      }
    }
  }
}, 500)
const onMultiplyInput = () => {
  if (!multiplyInputAmount.value) {
    resetMultiplyQuoteState()
    return
  }
  requestMultiplyQuote()
}
const onMultiplierInput = () => {
  if (!multiplyInputAmount.value) {
    resetMultiplyQuoteState()
    return
  }
  requestMultiplyQuote()
}
const onMultiplyCollateralChange = (selectedIndex: number) => {
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
}
const send = async () => {
  try {
    isSubmitting.value = true
    if (!collateralVault.value || !borrowVault.value) {
      return
    }
    const method = isSavingCollateral.value ? borrowBySaving : borrow
    let amount = collateralAmountFixed.value.toFormat({ decimals: Number(collateralVault.value.decimals) }).value
    if (isSavingCollateral.value) {
      if (savingCollateral.value?.assets === amount) {
        amount = savingBalance.value
      }
      else {
        amount = await convertAssetsToShares(collateralVault.value.address, amount)
      }
    }
    await method(
      collateralVault.value.address,
      collateralVault.value.asset.address,
      amount,
      borrowVault.value.address,
      borrowVault.value.asset.address,
      borrowAmountFixed.value.toFormat({ decimals: Number(borrowVault.value.decimals) }).value,
      collateralVault.value.asset.symbol,
    )

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
    netAPY.value = getNetAPY(
      getVaultPrice(+collateralAmount.value || 0, collateralVault.value!),
      collateralSupplyApy.value,
      getVaultPrice(+borrowAmount.value || 0, borrowVault.value!),
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

watch(pair, (val) => {
  if (!val) {
    return
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
  updateBalance()
}, { immediate: true })
watch(address, () => {
  multiplySubAccount.value = null
  multiplySubAccountPromise = null
})
watch([collateralAmount, borrowAmount], async () => {
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
  resetMultiplyQuoteState()
  if (multiplyInputAmount.value) {
    requestMultiplyQuote()
  }
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

watch(areVaultsReady, async (ready) => {
  if (ready && route.params.collateral && route.params.borrow) {
    try {
      const refreshedPair = await getBorrowVaultPair(
        route.params.collateral as string,
        route.params.borrow as string,
      )
      pair.value = refreshedPair
    }
    catch (e) {
      console.error('Error refreshing vault pair:', e)
    }
  }
}, { immediate: false })
</script>

<template>
  <div class="flex gap-32">
    <VaultForm
      title="Open borrow position"
      class="flex flex-col gap-16 w-full"
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
            :vault="collateralVault"
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
            :number-filter="(n: number) => `${n}%`"
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

          <VaultFormInfoBlock
            v-if="pair"
            :loading="isEstimatesLoading"
            class="bg-euler-dark-400 p-16 rounded-16 flex flex-col gap-16"
          >
            <div class="flex justify-between items-center">
              <p class="text-euler-dark-900">
                Net APY
              </p>
              <p class="text-p2">
                {{ netAPY ? `${formatNumber(netAPY)}%` : '-' }}
              </p>
            </div>
            <div class="flex justify-between items-center">
              <p class="text-euler-dark-900">
                Current Price
              </p>
              <p class="text-p2">
                {{ !priceFixed.isZero() ? formatNumber(priceFixed.toUnsafeFloat()) : '-' }}
                <span class="text-euler-dark-900 text-p3">
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
                <span class="text-euler-dark-900 text-p3">
                  {{ collateralVault?.asset.symbol }}
                </span>
              </p>
            </div>
            <div class="flex justify-between items-center">
              <p class="text-euler-dark-900">
                Health
              </p>
              <p class="text-p2">
                {{ health ? formatNumber(health, 2) : '-' }}
              </p>
            </div>
          </VaultFormInfoBlock>
        </template>

        <template v-else-if="multiplySupplyVault && multiplyLongVault && multiplyShortVault">
          <div class="grid gap-16 laptop:grid-cols-[minmax(0,1fr)_360px] laptop:items-start">
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
                :number-filter="(n: number) => `${n}x`"
                @update:model-value="onMultiplierInput"
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
                v-if="multiplyQuoteError"
                title="Swap quote"
                variant="warning"
                :description="multiplyQuoteError"
                size="compact"
              />
            </div>

            <div class="flex flex-col gap-16 w-full laptop:max-w-[360px]">
              <div class="bg-euler-dark-400 p-16 rounded-16 flex flex-col gap-12">
                <div class="flex justify-between items-center">
                  <p class="text-p2 text-white">
                    Select swap route
                  </p>
                  <p class="text-p3 text-euler-dark-900">
                    {{ multiplyQuotesStatusLabel || '-' }}
                  </p>
                </div>
                <div class="flex flex-col gap-8 max-h-[240px] overflow-y-auto pr-4">
                  <template v-if="multiplyQuoteCardsSorted.length">
                    <button
                      v-for="card in multiplyQuoteCardsSorted"
                      :key="card.provider"
                      type="button"
                      class="w-full text-left rounded-12 border p-12 transition-colors"
                      :class="multiplySelectedProvider === card.provider
                        ? 'border-teal-light-300 bg-euler-dark-500'
                        : 'border-euler-dark-500 bg-euler-dark-400 hover:bg-euler-dark-500'"
                      @click="selectMultiplyQuote(card.provider)"
                    >
                      <div class="flex items-start justify-between gap-8">
                        <p class="text-p2 text-white">
                          {{ formatNumber(ethers.formatUnits(BigInt(card.quote.amountOut || 0), Number(multiplyLongVault.asset.decimals))) }}
                          {{ multiplyLongVault.asset.symbol }}
                        </p>
                        <p
                          v-if="multiplyBestQuote"
                          class="text-p3"
                          :class="card.provider === multiplyQuoteCardsSorted[0]?.provider ? 'text-green-600' : 'text-red-600'"
                        >
                          <template v-if="card.provider === multiplyQuoteCardsSorted[0]?.provider">
                            Best
                          </template>
                          <template v-else>
                            -{{ getQuoteDiffPct(card.quote)?.toFixed(2) || '0.00' }}%
                          </template>
                        </p>
                      </div>
                      <div class="flex items-center justify-between gap-8 text-p3 text-euler-dark-900">
                        <span class="truncate">{{ card.provider }}</span>
                        <span class="truncate">
                          {{ card.quote.route?.length ? `via ${card.quote.route.map(route => route.providerName).join(', ')}` : '-' }}
                        </span>
                      </div>
                    </button>
                  </template>
                  <template v-else-if="isMultiplyQuoteLoading">
                    <div class="h-48 rounded-12 bg-euler-dark-500 animate-pulse" />
                    <div class="h-48 rounded-12 bg-euler-dark-500 animate-pulse" />
                    <div class="h-48 rounded-12 bg-euler-dark-500 animate-pulse" />
                  </template>
                  <template v-else-if="multiplyProvidersCount === 0">
                    <p class="text-p3 text-euler-dark-900">
                      Enter amount to fetch quotes
                    </p>
                  </template>
                  <template v-else>
                    <p class="text-p3 text-euler-dark-900">
                      No quotes found
                    </p>
                  </template>
                </div>
              </div>

              <VaultFormInfoBlock
                :loading="isMultiplyQuoteLoading"
                class="bg-euler-dark-400 p-16 rounded-16 flex flex-col gap-16 w-full"
              >
                <div class="flex justify-between items-center">
                  <p class="text-euler-dark-900">
                    ROE
                  </p>
                  <p class="text-p2">
                    <template v-if="multiplyRoeBefore !== null && multiplyRoeAfter !== null && multiplySwapReady">
                      <span class="text-euler-dark-900">{{ formatNumber(multiplyRoeBefore) }}%</span>
                      → <span class="text-white">{{ formatNumber(multiplyRoeAfter) }}%</span>
                    </template>
                    <template v-else>
                      {{ multiplyRoeBefore !== null ? `${formatNumber(multiplyRoeBefore)}%` : '-' }}
                    </template>
                  </p>
                </div>
                <div class="flex justify-between items-center">
                  <p class="text-euler-dark-900">
                    Current price
                  </p>
                  <p class="text-p2">
                    {{ multiplyCurrentPrice ? `${formatNumber(multiplyCurrentPrice.value)} ${multiplyCurrentPrice.symbol}` : '-' }}
                  </p>
                </div>
                <div class="flex justify-between items-center">
                  <p class="text-euler-dark-900">
                    Liquidation price
                  </p>
                  <p class="text-p2">
                    <template v-if="multiplyCurrentLiquidationPrice !== null && multiplyNextLiquidationPrice !== null && multiplySwapReady">
                      <span class="text-euler-dark-900">{{ formatNumber(multiplyCurrentLiquidationPrice, 4) }}</span>
                      → <span class="text-white">{{ formatNumber(multiplyNextLiquidationPrice, 4) }}</span>
                    </template>
                    <template v-else>
                      {{ multiplyCurrentLiquidationPrice !== null ? formatNumber(multiplyCurrentLiquidationPrice, 4) : '-' }}
                    </template>
                    <span class="text-euler-dark-900 text-p3">
                      {{ multiplyLongVault?.asset.symbol }}
                    </span>
                  </p>
                </div>
                <div class="flex justify-between items-center">
                  <p class="text-euler-dark-900">
                    Your LTV (LLTV)
                  </p>
                  <p class="text-p2 text-right">
                    <template v-if="multiplyCurrentLtv !== null && multiplyCurrentLiquidationLtv !== null && multiplyNextLtv !== null && multiplyNextLiquidationLtv !== null && multiplySwapReady">
                      <span class="text-euler-dark-900">
                        {{ formatNumber(multiplyCurrentLtv) }}%
                        <span class="text-euler-dark-900 text-p3">
                          ({{ formatNumber(multiplyCurrentLiquidationLtv) }}%)
                        </span>
                      </span>
                      → <span class="text-white">
                        {{ formatNumber(multiplyNextLtv) }}%
                        <span class="text-euler-dark-900 text-p3">
                          ({{ formatNumber(multiplyNextLiquidationLtv) }}%)
                        </span>
                      </span>
                    </template>
                    <template v-else>
                      <span v-if="multiplyCurrentLtv !== null && multiplyCurrentLiquidationLtv !== null">
                        {{ formatNumber(multiplyCurrentLtv) }}%
                        <span class="text-euler-dark-900 text-p3">
                          ({{ formatNumber(multiplyCurrentLiquidationLtv) }}%)
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
                    <template v-if="multiplyCurrentHealth !== null && multiplyNextHealth !== null && multiplySwapReady">
                      <span class="text-euler-dark-900">{{ formatNumber(multiplyCurrentHealth, 2) }}</span>
                      → <span class="text-white">{{ formatNumber(multiplyNextHealth, 2) }}</span>
                    </template>
                    <template v-else>
                      {{ multiplyCurrentHealth !== null ? formatNumber(multiplyCurrentHealth, 2) : '-' }}
                    </template>
                  </p>
                </div>
                <div class="flex justify-between items-start">
                  <p class="text-euler-dark-900">
                    Swap
                  </p>
                  <p class="text-p2 text-right flex flex-col items-end">
                    <span>{{ multiplySwapSummary ? multiplySwapSummary.from : '-' }}</span>
                    <span
                      v-if="multiplySwapSummary"
                      class="text-euler-dark-900 text-p3"
                    >
                      {{ multiplySwapSummary.to }}
                    </span>
                  </p>
                </div>
                <div class="flex justify-between items-center">
                  <p class="text-euler-dark-900">
                    Price impact
                  </p>
                  <p class="text-p2">
                    {{ multiplyPriceImpact !== null ? `${formatNumber(multiplyPriceImpact, 2, 2)}%` : '-' }}
                  </p>
                </div>
                <div class="flex justify-between items-center">
                  <p class="text-euler-dark-900">
                    Slippage tolerance
                  </p>
                  <p class="text-p2">
                    {{ formatNumber(multiplySlippage, 2, 0) }}%
                  </p>
                </div>
                <div class="flex justify-between items-center">
                  <p class="text-euler-dark-900">
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
          class="laptop:!hidden"
        />
        <VaultFormSubmit
          v-if="formTab === 'borrow'"
          :disabled="isSubmitDisabled"
          :loading="isSubmitting"
        >
          Review Borrow
        </VaultFormSubmit>
        <VaultFormSubmit
          v-else-if="formTab === 'multiply'"
          :disabled="isMultiplySubmitDisabled"
          :loading="isMultiplySubmitting"
        >
          Review Multiply
        </VaultFormSubmit>
      </template>
    </VaultForm>
    <div
      v-if="pair"
      class="w-full mobile:hidden"
    >
      <UiTabs
        v-if="tabs.length"
        v-model="tab"
        class="mb-12"
        :list="tabs"
      >
        <template #default="{ tab: slotTab }">
          <div class="flex items-center gap-8">
            <BaseAvatar :src="slotTab.avatars as string[]" />

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
        <VaultOverview
          v-else-if="tab === 'collateral'"
          :vault="pair.collateral"
          desktop-overview
        />
        <VaultOverview
          v-else-if="tab === 'borrow'"
          :vault="pair.borrow"
          desktop-overview
        />
      </Transition>
    </div>
  </div>
</template>
