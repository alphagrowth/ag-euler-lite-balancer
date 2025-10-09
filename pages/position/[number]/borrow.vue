<script setup lang="ts">
import { FixedNumber } from 'ethers'
import { Address, TonClient } from '@ton/ton'
import { useModal } from '~/components/ui/composables/useModal'
// import OperationTrackerTransactionModal
//   from '~/components/entities/operation/OperationTrackerTransactionModal.vue'
import { OperationReviewModal } from '#components'
import { useToast } from '~/components/ui/composables/useToast'
import { type BorrowVaultPair, getNetAPY, getVaultPrice, type VaultAsset } from '~/entities/vault'
import OperationTrackerTransactionModal
  from '~/components/entities/operation/OperationTrackerTransactionModal.vue'
import { useEulerProductOfVault } from '~/composables/useEulerLabels'
import type { AccountBorrowPosition } from '~/entities/account'

let tvmAssetAddress: string
const router = useRouter()
const route = useRoute()
const modal = useModal()
const { error } = useToast()
const { borrow } = useEulerOperations()
const { getBorrowVaultPair, updateVault } = useVaults()
const { isLoaded: isSdkLoaded } = useTacSdk()
const { isConnected, address, tonConnectUI, friendlyAddress } = useTonConnect()
const { updateBorrowPositions, borrowPositions, isPositionsLoading, isPositionsLoaded } = useEulerAccount()
const positionIndex = route.params.number as string
const { walletState } = useWallets()
const { getOpportunityOfBorrowVault, getOpportunityOfLendVault } = useMerkl()
const { TVM_TONCENTER_URL } = useConfig()

const ltv = ref(0)
const borrowAmount = ref('')
const collateralAmount = ref('')
const balance = ref(0n)
const isLoading = ref(false)
const isSubmitting = ref(false)
const isBalanceLoading = ref(false)
const isEstimatesLoading = ref(false)
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

  if (balance.value < valueToNano(collateralAmount.value, collateralVault.value?.asset?.decimals)) {
    return 'Not enough balance'
  }
  else if ((borrowVault.value?.supply || 0n) < valueToNano(borrowAmount.value, borrowVault.value?.decimals)) {
    return 'Not enough liquidity in the vault'
  }
  return null
})
const isSubmitDisabled = computed(() => {
  if (!isConnected.value) return false
  if (walletState.value !== 'active') return true
  return balance.value < valueToNano(collateralAmount.value, collateralVault.value?.asset?.decimals)
    || isLoading.value || !isSdkLoaded.value || !(+collateralAmount.value)
    || ((borrowVault.value?.supply || 0n) < valueToNano(borrowAmount.value, borrowVault.value?.decimals))
})
const borrowVault = computed(() => pair.value?.borrow)
const collateralVault = computed(() => pair.value?.collateral)
const pairAssets = computed(() => [collateralVault.value?.asset, borrowVault.value?.asset])
const priceFixed = computed(() => (
  FixedNumber.fromValue(collateralVault.value?.liabilityPriceInfo?.amountOutAsk || 0n, 18))
  .div(FixedNumber.fromValue(borrowVault.value?.liabilityPriceInfo?.amountOutBid || 1n, 18)))
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

const load = async () => {
  isLoading.value = true
  console.warn('index', positionIndex)
  position.value = borrowPositions.value[+positionIndex - 1]
  console.warn('pos', position.value)
  const collateralAddress = position.value.collateral.address
  const borrowAddress = position.value.borrow.address
  collateralAmount.value = `${nanoToValue(position.value.supplied, position.value.collateral.decimals)}`
  userLTV.value = Number(formatNumber(nanoToValue(position.value.userLTV, 18)))
  ltv.value = userLTV.value
  try {
    const { tacSdk } = useTacSdk()
    pair.value = await getBorrowVaultPair(collateralAddress as string, borrowAddress as string)
    tvmAssetAddress = await tacSdk.getTVMTokenAddress(collateralVault.value!.asset.address)
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
const updateBalance = async (isInitialLoading = true) => {
  const { tacSdk } = useTacSdk()
  if (!isConnected.value) {
    balance.value = 0n
    return
  }
  if (isInitialLoading) {
    isBalanceLoading.value = true
  }

  if (collateralVault.value?.asset.symbol === 'TON') {
    const client = new TonClient({
      endpoint: `${TVM_TONCENTER_URL}/api/v2/jsonRPC`,
    })
    balance.value = await client.getBalance(Address.parse(friendlyAddress.value))
  }
  else {
    balance.value = await tacSdk.getUserJettonBalance(address.value, tvmAssetAddress).catch((e) => {
      console.warn(e)
      return 0n
    })
  }
  isBalanceLoading.value = false
}
const submit = async () => {
  // TODO: Validate
  if (!isConnected.value) {
    tonConnectUI.openModal()
    isSubmitting.value = false
    return
  }

  modal.open(OperationReviewModal, {
    props: {
      type: 'borrow',
      asset: borrowVault.value?.asset,
      amount: borrowAmount.value,
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
    const tl = await borrow(
      collateralVault.value.address,
      collateralVault.value.asset.address,
      0n,
      borrowVault.value.address,
      borrowVault.value.asset.address,
      borrowAmountFixed.value.toFormat({ decimals: Number(borrowVault.value.decimals) }).value,
      collateralVault.value.asset.symbol,
      position.value?.subAccount,
    )
    modal.open(OperationTrackerTransactionModal, {
      props: { transactionLinker: tl },
      onClose: () => {
        updateEstimates()
        updateBalance()
        updateBorrowPositions()
        setTimeout(() => {
          router.replace('/portfolio')
        }, 400)
      },
    })
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
  borrowAmount.value = collateralAmountFixed.value
    .mul(priceFixed.value)
    .mul(ltvFixed.value)
    .div(FixedNumber.fromValue(100n)).round(Number(borrowVault.value?.decimals || 18))
    .subUnsafe(FixedNumber.fromValue(position.value?.borrowed, position.value?.borrow.decimals))
    .toString()
}
const onBorrowInput = async () => {
  await nextTick()
  if (!collateralAmount.value) {
    return
  }
  ltv.value = +borrowAmountFixed.value
    .addUnsafe(FixedNumber.fromValue(position.value?.borrowed, position.value?.borrow.decimals))
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
      nanoToValue(collateralVault.value?.interestRateInfo.supplyAPY || 0n, 25),
      getVaultPrice(+borrowAmount.value || 0, borrowVault.value!),
      nanoToValue(borrowVault.value?.interestRateInfo.borrowAPY || 0n, 25),
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

watch(isSdkLoaded, (val) => {
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
  updateBalance(false)
}, 5000)

onUnmounted(() => {
  clearInterval(interval)
})
</script>

<template>
  <VaultForm
    title="Borrow"
    :loading="isLoading || !isSdkLoaded"
    class="column gap-16"
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
        class="bg-euler-dark-400 p-16 br-16 column gap-16"
      >
        <div class="between align-center">
          <p class="text-euler-dark-900 ">
            Net APY
          </p>
          <p class="p2">
            {{ netAPY ? `${formatNumber(netAPY)}%` : '-' }}
          </p>
        </div>
        <div class="between align-center">
          <p class="text-euler-dark-900 ">
            Current Price
          </p>
          <p class="p2">
            {{ !priceFixed.isZero() ? formatNumber(priceFixed.toUnsafeFloat()) : '-' }}
            <span class="text-euler-dark-900 p3">
              {{ collateralVault?.asset.symbol }}/{{ borrowVault?.asset.symbol }}
            </span>
          </p>
        </div>
        <div class="between align-center">
          <p class="text-euler-dark-900 ">
            Liquidation price
          </p>
          <p class="p2">
            {{ liquidationPrice ? formatNumber(liquidationPrice, 4) : '-' }}
            <span class="text-euler-dark-900 p3">
              {{ collateralVault?.asset.symbol }}
            </span>
          </p>
        </div>
        <div class="between align-center">
          <p class="text-euler-dark-900 ">
            Health
          </p>
          <p class="p2">
            {{ health ? formatNumber(health, 2) : '-' }}
          </p>
        </div>
      </VaultFormInfoBlock>
    </template>

    <WalletInactiveDisclaimer
      v-if="walletState && walletState !== 'active'"
    />

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
