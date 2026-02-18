<script setup lang="ts">
import { useAccount } from '@wagmi/vue'
import { getAddress, formatUnits, type Address, type Abi, zeroAddress } from 'viem'
import { FixedPoint } from '~/utils/fixed-point'
import { getPublicClient } from '~/utils/public-client'
import { useModal } from '~/components/ui/composables/useModal'
import { OperationReviewModal, SwapTokenSelector, SlippageSettingsModal } from '#components'
import { useTermsOfUseGate } from '~/composables/useTermsOfUseGate'
import { useToast } from '~/components/ui/composables/useToast'
import { getAssetLogoUrl } from '~/composables/useTokens'
import { eulerAccountLensABI } from '~/entities/euler/abis'
import {
  getNetAPY,
  type Vault,
  type SecuritizeVault,
  type VaultAsset,
} from '~/entities/vault'
import { getUtilisationWarning } from '~/composables/useVaultWarnings'
import {
  getAssetUsdValueOrZero,
  getAssetOraclePrice,
  getCollateralOraclePrice,
  getCollateralUsdValueOrZero,
  conservativePriceRatio,
} from '~/services/pricing/priceProvider'
import type { TxPlan } from '~/entities/txPlan'
import { isAnyVaultBlockedByCountry, isVaultRestrictedByCountry } from '~/composables/useGeoBlock'
import { useVaultRegistry } from '~/composables/useVaultRegistry'
import { useSwapQuotesParallel } from '~/composables/useSwapQuotesParallel'
import { type SwapApiQuote, SwapperMode } from '~/entities/swap'
import { getQuoteAmount } from '~/utils/swapQuotes'
import { formatNumber, formatSmartAmount, formatHealthScore } from '~/utils/string-utils'
import { nanoToValue } from '~/utils/crypto-utils'

const router = useRouter()
const route = useRoute()
const { buildWithdrawPlan, buildWithdrawAndSwapPlan, executeTxPlan } = useEulerOperations()
const { error } = useToast()
const { getSubmitLabel, getSubmitDisabled, guardWithTerms } = useTermsOfUseGate()
const reviewWithdrawLabel = getSubmitLabel('Review Withdraw')
const modal = useModal()
const { isPositionsLoaded, refreshAllPositions, getPositionBySubAccountIndex } = useEulerAccount()
const { isConnected, address } = useAccount()
const { getSupplyRewardApy, getBorrowRewardApy } = useRewardsApy()
const { withIntrinsicBorrowApy, withIntrinsicSupplyApy } = useIntrinsicApy()
const { runSimulation, simulationError, clearSimulationError } = useTxPlanSimulation()
const { eulerLensAddresses, isReady: isEulerAddressesReady, loadEulerConfig } = useEulerAddresses()
const { isReady: isVaultsReady } = useVaults()
const { getOrFetch } = useVaultRegistry()
const { EVM_PROVIDER_URL } = useEulerConfig()

const priceInvert = usePriceInvert(
  () => collateralVault.value?.asset.symbol,
  () => borrowVault.value?.asset.symbol,
)

const positionIndex = usePositionIndex()

const isLoading = ref(false)
const isSubmitting = ref(false)
const isPreparing = ref(false)
const isEstimatesLoading = ref(false)
const amount = ref('')
const plan = ref<TxPlan | null>(null)
const estimateNetAPY = ref(0)
const estimateUserLTV = ref(0n)
const estimateHealth = ref(0n)
const estimatesError = ref('')
const selectedCollateral = ref<Vault | SecuritizeVault | null>(null)
const selectedCollateralAssets = ref(0n)
const lastCollateralAddress = ref('')

// Withdraw & swap state
const { enableSwapDeposit } = useDeployConfig()
const selectedOutputAsset = ref<VaultAsset | undefined>()
const needsSwap = computed(() => {
  if (!selectedOutputAsset.value || !asset.value) return false
  try {
    return getAddress(selectedOutputAsset.value.address) !== getAddress(asset.value.address)
  }
  catch {
    return false
  }
})
const { slippage: swapSlippage } = useSlippage()
const {
  sortedQuoteCards: swapQuoteCardsSorted,
  selectedProvider: swapSelectedProvider,
  selectedQuote: swapSelectedQuote,
  effectiveQuote: swapEffectiveQuote,
  isLoading: isSwapQuoteLoading,
  quoteError: swapQuoteError,
  statusLabel: swapQuotesStatusLabel,
  getQuoteDiffPct: getSwapQuoteDiffPct,
  reset: resetSwapQuoteState,
  requestQuotes: requestSwapQuotes,
  selectProvider: selectSwapQuote,
} = useSwapQuotesParallel({ amountField: 'amountOut', compare: 'max' })

const position = computed(() => getPositionBySubAccountIndex(+positionIndex))
const isPositionLoaded = computed(() => !!position.value)
const collateralVault = computed(() => selectedCollateral.value || position.value?.collateral)
const borrowVault = computed(() => position.value?.borrow)
const withdrawWarnings = computed(() => {
  if (!borrowVault.value) return []
  return [getUtilisationWarning(borrowVault.value, 'borrow')]
})
const asset = computed(() => collateralVault.value?.asset)
const collateralAssets = computed(() => selectedCollateralAssets.value)
const rewardApyForBorrow = computed(() => getBorrowRewardApy(borrowVault.value?.address || '', collateralVault.value?.address || ''))
const rewardApyForCollateral = computed(() => getSupplyRewardApy(collateralVault.value?.address || ''))
const collateralSupplyApy = computed(() => {
  if (!collateralVault.value) return 0
  return withIntrinsicSupplyApy(
    nanoToValue(collateralVault.value.interestRateInfo.supplyAPY || 0n, 25),
    collateralVault.value?.asset.address,
  )
})
const borrowApy = computed(() => withIntrinsicBorrowApy(
  nanoToValue(borrowVault.value?.interestRateInfo.borrowAPY || 0n, 25),
  borrowVault.value?.asset.address,
))
// Get collateral USD value using liability vault's price perspective (async)
const getCollateralValueUsdLocal = async (amount: bigint) => {
  if (!borrowVault.value || !collateralVault.value) return 0
  return getCollateralUsdValueOrZero(amount, borrowVault.value, collateralVault.value, 'off-chain')
}
// Pre-computed net APY (async)
const netAPY = ref(0)

watchEffect(async () => {
  if (!position.value || !borrowVault.value || !collateralVault.value) {
    netAPY.value = 0
    return
  }

  const [collateralUsd, borrowedUsd] = await Promise.all([
    getCollateralValueUsdLocal(collateralAssets.value),
    getAssetUsdValueOrZero(position.value.borrowed ?? 0n, borrowVault.value, 'off-chain'),
  ])

  netAPY.value = getNetAPY(
    collateralUsd,
    collateralSupplyApy.value,
    borrowedUsd,
    borrowApy.value,
    rewardApyForCollateral.value || null,
    rewardApyForBorrow.value || null,
  )
})
const amountFixed = computed(() => FixedPoint.fromValue(
  valueToNano(amount.value || '0', collateralVault.value?.decimals),
  Number(collateralVault.value?.decimals),
))
const borrowedFixed = computed(() => FixedPoint.fromValue(position.value?.borrowed || 0n, position.value?.borrow.decimals || 18))
const suppliedFixed = computed(() => FixedPoint.fromValue(collateralAssets.value, collateralVault.value?.decimals || 18))
// Use the correct collateral/borrow price ratio for LTV calculations (not the liquidation price)
const priceFixed = computed(() => {
  const collateralPrice = borrowVault.value && collateralVault.value
    ? getCollateralOraclePrice(borrowVault.value, collateralVault.value)
    : undefined
  const borrowPrice = borrowVault.value ? getAssetOraclePrice(borrowVault.value) : undefined
  return FixedPoint.fromValue(conservativePriceRatio(collateralPrice, borrowPrice), 18)
})
const liquidationPrice = computed(() => {
  // position.value?.price is already the liquidation price
  const price = position.value?.price || 0n
  if (price <= 0n) {
    return undefined
  }
  return nanoToValue(price, 18)
})
const isSubmitDisabled = computed(() => {
  if (!isConnected.value) return false
  if (collateralAssets.value < valueToNano(amount.value, asset.value?.decimals)) return true
  if (isLoading.value || !(+amount.value) || !!estimatesError.value || isEstimatesLoading.value) return true
  if (needsSwap.value && !swapEffectiveQuote.value && !isSwapQuoteLoading.value) return true
  return false
})
const isGeoBlocked = computed(() => {
  const addresses: string[] = []
  if (borrowVault.value) addresses.push(borrowVault.value.address)
  if (collateralVault.value) addresses.push(collateralVault.value.address)
  return isAnyVaultBlockedByCountry(...addresses)
})
const isSwapRestricted = computed(() => needsSwap.value && isVaultRestrictedByCountry(collateralVault.value?.address || ''))
const reviewWithdrawDisabled = getSubmitDisabled(computed(() => isGeoBlocked.value || isSwapRestricted.value || isLoading.value || isSubmitDisabled.value))

// Swap quote helpers
const swapEstimatedOutput = computed(() => {
  if (!swapEffectiveQuote.value || !selectedOutputAsset.value) return ''
  const amountOut = BigInt(swapEffectiveQuote.value.amountOut || 0)
  if (amountOut <= 0n) return ''
  return formatUnits(amountOut, Number(selectedOutputAsset.value.decimals))
})

const swapRouteItems = computed(() => {
  if (!selectedOutputAsset.value) return []
  const bestProvider = swapQuoteCardsSorted.value[0]?.provider
  return swapQuoteCardsSorted.value.map((card) => {
    const amountOut = getQuoteAmount(card.quote, 'amountOut')
    const amountFormatted = formatSmartAmount(
      formatUnits(amountOut, Number(selectedOutputAsset.value!.decimals)),
    )
    const diffPct = getSwapQuoteDiffPct(card.quote)
    const badge = card.provider === bestProvider
      ? { label: 'Best', tone: 'best' as const }
      : diffPct !== null
        ? { label: `-${diffPct.toFixed(2)}%`, tone: 'worse' as const }
        : undefined
    return {
      provider: card.provider,
      amount: amountFormatted,
      symbol: selectedOutputAsset.value!.symbol,
      routeLabel: card.quote.route?.length
        ? `via ${card.quote.route.map(r => r.providerName).join(', ')}`
        : '-',
      badge,
    }
  })
})

const requestSwapQuote = useDebounceFn(async () => {
  swapQuoteError.value = null

  if (!selectedOutputAsset.value || !asset.value || !needsSwap.value || !amount.value) {
    resetSwapQuoteState()
    return
  }

  const withdrawAmountNano = valueToNano(amount.value || '0', asset.value.decimals)
  if (withdrawAmountNano <= 0n) {
    resetSwapQuoteState()
    return
  }

  const userAddr = (address.value || zeroAddress) as Address
  const subAccountAddr = position.value?.subAccount
    ? (position.value.subAccount as Address)
    : userAddr
  await requestSwapQuotes({
    tokenIn: asset.value.address as Address,
    tokenOut: selectedOutputAsset.value.address as Address,
    accountIn: subAccountAddr,
    accountOut: zeroAddress as Address,
    amount: withdrawAmountNano,
    vaultIn: collateralVault.value!.address as Address,
    receiver: userAddr,
    transferOutputToReceiver: true,
    slippage: swapSlippage.value,
    swapperMode: SwapperMode.EXACT_IN,
    isRepay: false,
    targetDebt: 0n,
    currentDebt: 0n,
  }, {
    logContext: {
      tokenIn: asset.value.address,
      tokenOut: selectedOutputAsset.value.address,
      amount: amount.value,
      slippage: swapSlippage.value,
    },
  })
}, 500)

const onSelectOutputAsset = (newAsset: VaultAsset) => {
  selectedOutputAsset.value = newAsset
  amount.value = ''
  clearSimulationError()
  resetSwapQuoteState()
}

const openSwapTokenSelector = () => {
  modal.open(SwapTokenSelector, {
    props: {
      currentAssetAddress: selectedOutputAsset.value?.address || asset.value?.address,
      onSelect: onSelectOutputAsset,
    },
  })
}

const openSlippageSettings = () => {
  modal.open(SlippageSettingsModal)
}

const onRefreshSwapQuotes = () => {
  resetSwapQuoteState()
  requestSwapQuote()
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
    amount.value = ''
    lastCollateralAddress.value = targetAddress
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
    console.warn('[Withdraw] failed to load collateral', e)
    if (!selectedCollateral.value) {
      selectedCollateral.value = position.value.collateral
    }
  }
}

const load = async () => {
  if (!isConnected.value) {
    return
  }
  isLoading.value = true
  await until(isPositionLoaded).toBe(true)
  try {
    await loadSelectedCollateral()
    estimateNetAPY.value = netAPY.value
    estimateUserLTV.value = position.value!.userLTV
    estimateHealth.value = position.value!.health
  }
  catch (e) {
    showError('Unable to load Vault')
    console.warn(e)
  }
  finally {
    isLoading.value = false
  }
}
const submit = async () => {
  if (isPreparing.value || isGeoBlocked.value || isSwapRestricted.value) return
  isPreparing.value = true
  try {
    await guardWithTerms(async () => {
      if (!asset.value?.address || !collateralVault.value?.address) {
        return
      }

      try {
        if (needsSwap.value && swapEffectiveQuote.value) {
          plan.value = await buildWithdrawAndSwapPlan({
            vaultAddress: collateralVault.value.address as Address,
            assetsAmount: valueToNano(amount.value || '0', asset.value.decimals),
            quote: swapEffectiveQuote.value,
            subAccount: position.value?.subAccount,
            options: {
              includePythUpdate: (position.value?.borrowed || 0n) > 0n,
              liabilityVault: borrowVault.value?.address,
              enabledCollaterals: position.value?.collaterals,
            },
          })
        }
        else {
          plan.value = await buildWithdrawPlan(
            collateralVault.value.address,
            valueToNano(amount.value || '0', asset.value.decimals),
            position.value?.subAccount,
            { includePythUpdate: (position.value?.borrowed || 0n) > 0n, liabilityVault: borrowVault.value?.address, enabledCollaterals: position.value?.collaterals },
          )
        }
      }
      catch (e) {
        console.warn('[position/withdraw] failed to build plan', e)
        plan.value = null
      }

      if (plan.value) {
        const ok = await runSimulation(plan.value)
        if (!ok) {
          return
        }
      }

      const reviewType = needsSwap.value ? 'swap-withdraw' as const : 'withdraw' as const
      modal.open(OperationReviewModal, {
        props: {
          type: reviewType,
          asset: asset.value,
          amount: amount.value,
          plan: plan.value || undefined,
          subAccount: position.value?.subAccount,
          hasBorrows: (position.value?.borrowed || 0n) > 0n,
          swapToAsset: needsSwap.value ? selectedOutputAsset.value : undefined,
          swapToAmount: needsSwap.value ? swapEstimatedOutput.value : undefined,
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
  try {
    isSubmitting.value = true
    if (!asset.value?.address) {
      return
    }

    let txPlan: TxPlan
    if (needsSwap.value && (swapSelectedQuote.value || swapEffectiveQuote.value)) {
      const quote = swapSelectedQuote.value || swapEffectiveQuote.value!
      txPlan = await buildWithdrawAndSwapPlan({
        vaultAddress: collateralVault.value!.address as Address,
        assetsAmount: valueToNano(amount.value || '0', asset.value.decimals),
        quote,
        subAccount: position.value?.subAccount,
        options: {
          includePythUpdate: (position.value?.borrowed || 0n) > 0n,
          liabilityVault: borrowVault.value?.address,
          enabledCollaterals: position.value?.collaterals,
        },
      })
    }
    else {
      txPlan = await buildWithdrawPlan(
        collateralVault.value!.address,
        valueToNano(amount.value || '0', asset.value.decimals),
        position.value?.subAccount,
        { includePythUpdate: (position.value?.borrowed || 0n) > 0n, liabilityVault: borrowVault.value?.address, enabledCollaterals: position.value?.collaterals },
      )
    }
    await executeTxPlan(txPlan)

    modal.close()
    refreshAllPositions(eulerLensAddresses.value, address.value as string)
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
const updateEstimates = useDebounceFn(async () => {
  clearSimulationError()
  estimatesError.value = ''
  if (!collateralVault.value) {
    return
  }
  try {
    if (suppliedFixed.value.lte(amountFixed.value)) {
      throw new Error('Not enough liquidity in your position')
    }
    const [collateralUsd, borrowedUsd] = await Promise.all([
      getCollateralValueUsdLocal(collateralAssets.value - valueToNano(amount.value, collateralVault.value.decimals)),
      getAssetUsdValueOrZero(position.value!.borrowed ?? 0n, borrowVault.value!, 'off-chain'),
    ])
    estimateNetAPY.value = getNetAPY(
      collateralUsd,
      collateralSupplyApy.value,
      borrowedUsd,
      borrowApy.value,
      rewardApyForCollateral.value || null,
      rewardApyForBorrow.value || null,
    )
    const collateralValue = (suppliedFixed.value.sub(amountFixed.value)).mul(priceFixed.value)

    const userLtvFixed = collateralValue.isZero()
      ? FixedPoint.fromValue(0n, 18)
      : borrowedFixed.value
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
watch(() => route.query.collateral, async () => {
  clearSimulationError()
  if (!isPositionLoaded.value) {
    return
  }
  await loadSelectedCollateral()
  estimateNetAPY.value = netAPY.value
  estimateUserLTV.value = position.value?.userLTV || 0n
  estimateHealth.value = position.value?.health || 0n
})
watch(address, async () => {
  if (isPositionLoaded.value) {
    await loadSelectedCollateral()
  }
})
watch(amount, async () => {
  clearSimulationError()
  if (!collateralVault.value) {
    return
  }
  if (!isEstimatesLoading.value) {
    isEstimatesLoading.value = true
  }
  updateEstimates()
  if (needsSwap.value) {
    resetSwapQuoteState()
    requestSwapQuote()
  }
})

// Fetch swap quotes when output asset changes
watch(selectedOutputAsset, () => {
  clearSimulationError()
  resetSwapQuoteState()
  if (needsSwap.value && amount.value) {
    requestSwapQuote()
  }
})

// Re-request quote when slippage changes
watch(swapSlippage, () => {
  if (needsSwap.value && amount.value) {
    clearSimulationError()
    resetSwapQuoteState()
    requestSwapQuote()
  }
})

watch(swapSelectedQuote, () => {
  clearSimulationError()
})
</script>

<template>
  <VaultForm
    title="Withdraw"
    :loading="isLoading"
    @submit.prevent="submit"
  >
    <template v-if="collateralVault && asset">
      <VaultLabelsAndAssets
        :vault="collateralVault"
        :assets="[asset]"
        size="large"
      />

      <div class="grid gap-16 laptop:grid-cols-[minmax(0,1fr)_360px] laptop:items-start">
        <div class="flex flex-col gap-16 w-full">
          <AssetInput
            v-if="position && asset"
            v-model="amount"
            label="Withdraw amount"
            :asset="asset"
            :vault="(collateralVault as Vault)"
            :balance="collateralAssets"
            maxable
          />

          <!-- Receive as token selector -->
          <div v-if="enableSwapDeposit" class="flex items-center gap-8">
            <span class="text-p3 text-content-tertiary">Receive as</span>
            <button
              type="button"
              class="flex items-center gap-6 bg-euler-dark-500 text-p3 font-semibold px-12 h-36 rounded-[40px] whitespace-nowrap"
              @click="openSwapTokenSelector"
            >
              <BaseAvatar
                :src="getAssetLogoUrl(selectedOutputAsset?.address || asset.address, selectedOutputAsset?.symbol || asset.symbol)"
                :label="selectedOutputAsset?.symbol || asset.symbol"
                class="icon--20"
              />
              {{ selectedOutputAsset?.symbol || asset.symbol }}
              <SvgIcon
                class="text-euler-dark-800 !w-16 !h-16"
                name="arrow-down"
              />
            </button>
          </div>

          <!-- Swap info block -->
          <template v-if="needsSwap && selectedOutputAsset">
            <SwapRouteSelector
              :items="swapRouteItems"
              :selected-provider="swapSelectedProvider"
              :status-label="swapQuotesStatusLabel"
              :is-loading="isSwapQuoteLoading"
              empty-message="Enter amount to fetch quotes"
              @select="selectSwapQuote"
              @refresh="onRefreshSwapQuotes"
            />

            <VaultFormInfoBlock
              v-if="swapEstimatedOutput"
              :loading="isSwapQuoteLoading"
            >
              <SummaryRow label="Estimated output" align-top>
                <p class="text-p2">
                  ~{{ formatSmartAmount(swapEstimatedOutput) }} {{ selectedOutputAsset.symbol }}
                </p>
              </SummaryRow>
              <SummaryRow label="Slippage tolerance">
                <button
                  type="button"
                  class="flex items-center gap-6 text-p2"
                  @click="openSlippageSettings"
                >
                  <span>{{ formatNumber(swapSlippage, 2, 0) }}%</span>
                  <SvgIcon
                    name="edit"
                    class="!w-16 !h-16 text-accent-600"
                  />
                </button>
              </SummaryRow>
            </VaultFormInfoBlock>

            <UiToast
              v-if="swapQuoteError"
              title="Swap quote"
              variant="warning"
              :description="swapQuoteError"
              size="compact"
            />
          </template>

          <UiToast
            v-if="isGeoBlocked"
            title="Region restricted"
            description="This operation is not available in your region. You can still repay existing debt."
            variant="warning"
            size="compact"
          />
          <UiToast
            v-if="!isGeoBlocked && isSwapRestricted"
            title="Swap restricted"
            description="Swapping from this vault is not available in your region. You can withdraw the vault's underlying asset directly."
            variant="warning"
            size="compact"
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

          <VaultWarningBanner :warnings="withdrawWarnings" />
        </div>

        <VaultFormInfoBlock
          v-if="position && borrowVault"
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
              :value="!priceFixed.isZero() ? formatSmartAmount(priceInvert.invertValue(priceFixed.toUnsafeFloat())) : undefined"
              :symbol="priceInvert.displaySymbol"
              invertible
              @invert="priceInvert.toggle"
            />
          </SummaryRow>
          <SummaryRow label="Liquidation price">
            <SummaryPriceValue
              :value="liquidationPrice != null ? formatSmartAmount(priceInvert.invertValue(liquidationPrice)!) : undefined"
              :symbol="priceInvert.displaySymbol"
              invertible
              @invert="priceInvert.toggle"
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
            :disabled="isLoading || isSubmitting"
            :vault="collateralVault"
          />
          <VaultFormSubmit
            :disabled="reviewWithdrawDisabled"
            :loading="isSubmitting || isPreparing"
          >
            {{ reviewWithdrawLabel }}
          </VaultFormSubmit>
        </div>
      </div>
    </template>
  </VaultForm>
</template>
