<script setup lang="ts">
import { useAccount } from '@wagmi/vue'
import { getAddress, formatUnits, type Address, type Abi } from 'viem'
import { FixedPoint } from '~/utils/fixed-point'
import { getPublicClient } from '~/utils/public-client'
import { useModal } from '~/components/ui/composables/useModal'
import { OperationReviewModal } from '#components'
import { useTermsOfUseGate } from '~/composables/useTermsOfUseGate'
import { useToast } from '~/components/ui/composables/useToast'
import { eulerAccountLensABI } from '~/entities/euler/abis'
import {
  getNetAPY,
  type Vault,
  type SecuritizeVault,
} from '~/entities/vault'
import { getUtilisationWarning } from '~/composables/useVaultWarnings'
import {
  getAssetUsdValueOrZero,
  getAssetOraclePrice,
  getCollateralOraclePrice,
  getCollateralUsdValueOrZero,
} from '~/services/pricing/priceProvider'
import type { TxPlan } from '~/entities/txPlan'
import { isAnyVaultBlockedByCountry } from '~/composables/useGeoBlock'
import { useVaultRegistry } from '~/composables/useVaultRegistry'

const router = useRouter()
const route = useRoute()
const { buildWithdrawPlan, executeTxPlan } = useEulerOperations()
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

const positionIndex = route.params.number as string

const isLoading = ref(false)
const isSubmitting = ref(false)
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
const rewardApyForBorrow = computed(() => getBorrowRewardApy(borrowVault.value?.asset.address || '', borrowVault.value?.address || ''))
const rewardApyForCollateral = computed(() => getSupplyRewardApy(collateralVault.value?.address || ''))
const collateralSupplyApy = computed(() => {
  if (!collateralVault.value) return 0
  return withIntrinsicSupplyApy(
    nanoToValue(collateralVault.value.interestRateInfo.supplyAPY || 0n, 25),
    collateralVault.value?.asset.symbol,
  )
})
const borrowApy = computed(() => withIntrinsicBorrowApy(
  nanoToValue(borrowVault.value?.interestRateInfo.borrowAPY || 0n, 25),
  borrowVault.value?.asset.symbol,
))
// Get collateral USD value using liability vault's price perspective (async)
const getCollateralValueUsdLocal = async (amount: bigint) => {
  if (!borrowVault.value || !collateralVault.value) return 0
  return getCollateralUsdValueOrZero(amount, borrowVault.value, collateralVault.value as Vault, 'off-chain')
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
  const ask = collateralPrice?.amountOutAsk || 0n
  const bid = borrowPrice?.amountOutBid || 1n
  return FixedPoint.fromValue(ask, 18).div(FixedPoint.fromValue(bid, 18))
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
  return collateralAssets.value < valueToNano(amount.value, asset.value?.decimals)
    || isLoading.value || !(+amount.value) || !!estimatesError.value || isEstimatesLoading.value
})
const isGeoBlocked = computed(() => {
  const addresses: string[] = []
  if (borrowVault.value) addresses.push(borrowVault.value.address)
  if (collateralVault.value) addresses.push(collateralVault.value.address)
  return isAnyVaultBlockedByCountry(...addresses)
})
const reviewWithdrawDisabled = getSubmitDisabled(computed(() => isGeoBlocked.value || isLoading.value || isSubmitDisabled.value))

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
    estimateUserLTV.value = position.value.userLTV
    estimateHealth.value = position.value.health
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
  if (isGeoBlocked.value) return
  await guardWithTerms(async () => {
    if (!asset.value?.address || !collateralVault.value?.address) {
      return
    }

    try {
      plan.value = await buildWithdrawPlan(
        collateralVault.value.address,
        valueToNano(amount.value || '0', asset.value.decimals),
        position.value?.subAccount,
        { includePythUpdate: (position.value?.borrowed || 0n) > 0n, liabilityVault: borrowVault.value?.address, enabledCollaterals: position.value?.collaterals },
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
        type: 'withdraw',
        asset: asset.value,
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
  })
}
const send = async () => {
  try {
    isSubmitting.value = true
    if (!asset.value?.address) {
      return
    }

    const txPlan = await buildWithdrawPlan(
      collateralVault.value!.address,
      valueToNano(amount.value || '0', asset.value.decimals),
      position.value?.subAccount,
      { includePythUpdate: (position.value?.borrowed || 0n) > 0n, liabilityVault: borrowVault.value?.address, enabledCollaterals: position.value?.collaterals },
    )
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
      collateralSupplyApy.value, // TODO: consider calculated supplyAPY after withdraw
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
watch(amount, async () => {
  clearSimulationError()
  if (!collateralVault.value) {
    return
  }
  if (!isEstimatesLoading.value) {
    isEstimatesLoading.value = true
  }
  updateEstimates()
})
</script>

<template>
  <VaultForm
    title="Withdraw"
    :loading="isLoading"
    @submit.prevent="submit"
  >
    <template v-if="collateralVault && asset">
      <div class="flex justify-between">
        <VaultLabelsAndAssets
          :vault="collateralVault"
          :assets="[asset]"
          size="large"
        />
      </div>

      <AssetInput
        v-if="position && asset"
        v-model="amount"
        label="Withdraw amount"
        :asset="asset"
        :vault="collateralVault"
        :balance="collateralAssets"
        maxable
      />

      <UiToast
        v-if="isGeoBlocked"
        title="Region restricted"
        description="This operation is not available in your region. You can still repay existing debt."
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

      <VaultFormInfoBlock
        v-if="position && borrowVault"
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
            {{ nanoToValue(position.price, 18) > 0 ? `$${formatNumber(nanoToValue(position.price, 18))}` : '-' }}
            <span v-if="nanoToValue(position.price, 18) > 0" class="text-content-tertiary text-p3">
              {{ collateralVault.asset.symbol }}/{{ borrowVault.asset.symbol }}
            </span>
          </p>
        </div>
        <div class="flex justify-between items-center flex-wrap gap-8">
          <p class="text-content-tertiary">
            Liquidation price
          </p>
          <p class="text-p2 flex items-center gap-4">
            {{ liquidationPrice ? `$${formatNumber(liquidationPrice)}` : '-' }}
            <span v-if="liquidationPrice" class="text-content-tertiary text-p3">
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

    <template #buttons>
      <VaultFormInfoButton
        :disabled="isLoading || isSubmitting"
        :vault="collateralVault"
      />
      <VaultFormSubmit
        :disabled="reviewWithdrawDisabled"
        :loading="isSubmitting"
      >
        {{ reviewWithdrawLabel }}
      </VaultFormSubmit>
    </template>
  </VaultForm>
</template>
