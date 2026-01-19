<script setup lang="ts">
import { useAccount } from '@wagmi/vue'
import { FixedNumber } from 'ethers'
import { useModal } from '~/components/ui/composables/useModal'
import { OperationReviewModal } from '#components'
import { useToast } from '~/components/ui/composables/useToast'
import { type BorrowVaultPair, getNetAPY, getVaultPrice, getVaultPriceInfo } from '~/entities/vault'
import { useEulerProductOfVault } from '~/composables/useEulerLabels'
import type { AccountBorrowPosition } from '~/entities/account'
import type { TxPlan } from '~/entities/txPlan'

const router = useRouter()
const route = useRoute()
const modal = useModal()
const { error } = useToast()
const { borrow, buildBorrowPlan } = useEulerOperations()
const { getBorrowVaultPair, updateVault } = useVaults()
const { isConnected } = useAccount()
const { borrowPositions, isPositionsLoading, isPositionsLoaded } = useEulerAccount()
const positionIndex = route.params.number as string
const { getBalance } = useWallets()
const { getOpportunityOfBorrowVault, getOpportunityOfLendVault } = useMerkl()
const { withIntrinsicBorrowApy, withIntrinsicSupplyApy } = useIntrinsicApy()

const ltv = ref(0)
const borrowAmount = ref('')
const collateralAmount = ref('')
const balance = ref(0n)
const isLoading = ref(false)
const isSubmitting = ref(false)
const isBalanceLoading = ref(false)
const isEstimatesLoading = ref(false)
const plan = ref<TxPlan | null>(null)
const pair: Ref<BorrowVaultPair | undefined> = ref()
const health = ref()
const netAPY = ref()
const liquidationPrice = ref()
const position: Ref<AccountBorrowPosition | undefined> = ref()
const userLTV = ref(0)

const errorText = computed(() => {
  if (isBalanceLoading.value) {
    return null
  }

  const currentSupplied = position.value?.supplied || 0n
  const newCollateralAmount = valueToNano(collateralAmount.value, collateralVault.value?.asset?.decimals)
  const additionalCollateralNeeded = newCollateralAmount > currentSupplied
    ? newCollateralAmount - currentSupplied
    : 0n

  if (additionalCollateralNeeded > 0n && balance.value < additionalCollateralNeeded) {
    return 'Not enough balance'
  }
  else if ((borrowVault.value?.supply || 0n) < valueToNano(borrowAmount.value, borrowVault.value?.decimals)) {
    return 'Not enough liquidity in the vault'
  }
  return null
})
const isSubmitDisabled = computed(() => {
  if (!isConnected.value) return false

  const currentSupplied = position.value?.supplied || 0n
  const newCollateralAmount = valueToNano(collateralAmount.value, collateralVault.value?.asset?.decimals)
  const additionalCollateralNeeded = newCollateralAmount > currentSupplied
    ? newCollateralAmount - currentSupplied
    : 0n

  return (additionalCollateralNeeded > 0n && balance.value < additionalCollateralNeeded)
    || isLoading.value || !(+collateralAmount.value)
    || ((borrowVault.value?.supply || 0n) < valueToNano(borrowAmount.value, borrowVault.value?.decimals))
})
const borrowVault = computed(() => pair.value?.borrow)
const collateralVault = computed(() => pair.value?.collateral)
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
const borrowProduct = useEulerProductOfVault(computed(() => borrowVault.value?.address || ''))
const collateralProduct = useEulerProductOfVault(computed(() => collateralVault.value?.address || ''))

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

const load = async () => {
  isLoading.value = true
  position.value = borrowPositions.value[+positionIndex - 1]
  const collateralAddress = position.value.collateral.address
  const borrowAddress = position.value.borrow.address
  collateralAmount.value = `${nanoToValue(position.value.supplied, position.value.collateral.decimals)}`
  userLTV.value = Number(formatNumber(nanoToValue(position.value.userLTV, 18)))
  ltv.value = userLTV.value
  try {
    pair.value = await getBorrowVaultPair(collateralAddress as string, borrowAddress as string)
    updateBalance()
  }
  catch (e) {
    showError('Unable to load Vault')
    console.warn(e)
  }
  finally {
    isLoading.value = false
  }
}
const updateBalance = async () => {
  if (!isConnected.value) {
    balance.value = 0n
    return
  }

  balance.value = getBalance(collateralVault.value?.asset.address as `0x${string}`) || 0n
  isBalanceLoading.value = false
}
const submit = async () => {
  if (!borrowVault.value || !collateralVault.value) {
    return
  }

  try {
    plan.value = await buildBorrowPlan(
      collateralVault.value.address,
      collateralVault.value.asset.address,
      0n,
      borrowVault.value.address,
      valueToNano(borrowAmount.value || '0', borrowVault.value.decimals),
      position.value?.subAccount,
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
const send = async () => {
  try {
    isSubmitting.value = true
    if (!collateralVault.value || !borrowVault.value || !position.value) {
      return
    }
    // Note: borrow operation doesn't support operator parameter
    await borrow(
      collateralVault.value.address,
      collateralVault.value.asset.address,
      0n,
      borrowVault.value.address,
      borrowVault.value.asset.address,
      borrowAmountFixed.value.toFormat({ decimals: Number(borrowVault.value.decimals) }).value,
      collateralVault.value.asset.symbol,
      position.value.subAccount, // Pass the subaccount to borrow on the same position
    )

    modal.close()
    updateBalance()
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
const onCollateralInput = async () => {
  await nextTick()
  const result = collateralAmountFixed.value
    .mul(priceFixed.value)
    .mul(ltvFixed.value)
    .div(FixedNumber.fromValue(100n)).round(Number(borrowVault.value?.decimals || 18))
    .subUnsafe(FixedNumber.fromValue(position.value?.borrowed || 0n, position.value?.borrow.decimals || 18))
  const zero = FixedNumber.fromValue(0n, Number(borrowVault.value?.decimals || 18))
  borrowAmount.value = result.lt(zero) ? zero.toString() : result.toString()
}
const onBorrowInput = async () => {
  await nextTick()
  if (!collateralAmount.value) {
    return
  }
  ltv.value = +borrowAmountFixed.value
    .addUnsafe(FixedNumber.fromValue(position.value?.borrowed || 0n, position.value?.borrow.decimals || 18))
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
  await Promise.all([updateVault(collateralVault.value!.address), updateVault(borrowVault.value!.address)])
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

watch(isPositionsLoaded, (val) => {
  if (val) {
    load()
  }
}, { immediate: true })
watch(isConnected, () => {
  updateBalance()
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

const interval = setInterval(() => {
  updateBalance()
}, 5000)

onUnmounted(() => {
  clearInterval(interval)
})
</script>

<template>
  <VaultForm
    title="Borrow"
    :loading="isLoading || isPositionsLoading"
    class="flex flex-col gap-16"
    @submit.prevent="submit"
  >
    <template v-if="pair">
      <AssetInput
        v-if="borrowVault"
        v-model="borrowAmount"
        :desc="borrowProduct.name"
        :label="`Borrow ${borrowVault.asset.symbol}`"
        :asset="borrowVault.asset"
        :vault="borrowVault"
        @input="onBorrowInput"
      />

      <UiRange
        v-model="ltv"
        label="LTV"
        :step="0.1"
        :max="Number(pair.borrowLTV / 100n)"
        :min="userLTV"
        :number-filter="(n: number) => `${n}%`"
        @update:model-value="onLtvInput"
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

    <template #buttons>
      <VaultFormSubmit
        :disabled="isSubmitDisabled"
        :loading="isSubmitting"
      >
        Review Borrow
      </VaultFormSubmit>
    </template>
  </VaultForm>
</template>
