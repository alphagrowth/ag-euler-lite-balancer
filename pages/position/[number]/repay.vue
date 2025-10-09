<script setup lang="ts">
import { FixedNumber } from 'ethers'
import { useModal } from '~/components/ui/composables/useModal'
import OperationTrackerTransactionModal
  from '~/components/entities/operation/OperationTrackerTransactionModal.vue'
import { OperationReviewModal } from '#components'
import { useToast } from '~/components/ui/composables/useToast'
import { useEulerProductOfVault } from '~/composables/useEulerLabels'
import { getNetAPY, getVaultPrice, type VaultAsset } from '~/entities/vault'
import { nanoToValue } from '~/utils/ton-utils'
import type { AccountBorrowPosition } from '~/entities/account'

const route = useRoute()
const router = useRouter()
const modal = useModal()
const { error } = useToast()
const { repay, fullRepay } = useEulerOperations()
const { isLoaded: isSdkLoaded } = useTacSdk()
const { isConnected, tonConnectUI } = useTonConnect()
const positionIndex = route.params.number as string
const { borrowPositions, isPositionsLoading, isPositionsLoaded } = useEulerAccount()
const { updateBorrowPositions } = useEulerAccount()
const { getOpportunityOfBorrowVault, getOpportunityOfLendVault } = useMerkl()

const isLoading = ref(false)
const isSubmitting = ref(false)
const isEstimatesLoading = ref(false)
const amount = ref('')
const balance = ref(0n)
const position: Ref<AccountBorrowPosition | undefined> = ref()
const estimateNetAPY = ref(0)
const estimateUserLTV = ref(0n)
const estimateHealth = ref(0n)
const estimatesError = ref('')

const borrowVault = computed(() => position.value?.borrow)
const collateralVault = computed(() => position.value?.collateral)
const assets = computed(() => [collateralVault.value?.asset, borrowVault.value?.asset])
const isSubmitDisabled = computed(() => {
  if (!isConnected.value) return false
  return isLoading.value || !isSdkLoaded.value || !(+amount.value) || !!estimatesError.value || isEstimatesLoading.value
})
const opportunityInfoForBorrow = computed(() => getOpportunityOfBorrowVault(borrowVault.value?.asset.address || ''))
const opportunityInfoForCollateral = computed(() => getOpportunityOfLendVault(collateralVault.value?.address || ''))
const netAPY = computed(() => {
  return getNetAPY(
    getVaultPrice(position.value?.supplied || 0n, collateralVault.value!),
    nanoToValue(collateralVault.value?.interestRateInfo.supplyAPY || 0n, 25),
    getVaultPrice(position.value?.borrowed || 0n || 0, borrowVault.value!),
    nanoToValue(borrowVault.value?.interestRateInfo.borrowAPY || 0n, 25),
    opportunityInfoForCollateral.value?.apr || null,
    opportunityInfoForBorrow.value?.apr || null,
  )
})
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

const load = async () => {
  if (!isConnected.value) {
    showError('Wallet is not connected.')
  }
  isLoading.value = true
  await until(isPositionsLoaded).toBe(true)

  try {
    position.value = borrowPositions.value[+positionIndex - 1]
    await updateBalance()
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
const updateBalance = async () => {
  if (!isConnected.value) {
    balance.value = 0n
    return
  }

  const borrowedUsd = getVaultPrice(position.value!.borrowed, borrowVault.value!) || 0.01
  const factor = Math.pow(10, 2)
  const borrowedRounded = Math.ceil(borrowedUsd * factor) / factor
  balance.value = FixedNumber.fromValue(valueToNano(borrowedRounded, 4), 4)
    .div(FixedNumber.fromValue(borrowVault.value!.liabilityPriceInfo.amountOutMid, Number(borrowVault.value!.decimals)))
    .value
}
const submit = async () => {
  if (!isConnected.value) {
    tonConnectUI.openModal()
    isSubmitting.value = false
    return
  }

  modal.open(OperationReviewModal, {
    props: {
      type: 'repay',
      asset: position.value!.borrow.asset,
      amount: amount.value,
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
    if (!position.value || !borrowVault.value || !collateralVault.value) {
      return
    }
    const method = balance.value <= valueToNano(amount.value, borrowVault.value.asset.decimals)
      ? fullRepay
      : repay
    console.log(balance.value <= valueToNano(amount.value, borrowVault.value.asset.decimals))
    const tl = await method(
      position.value.subAccount,
      collateralVault.value.address,
      collateralVault.value.asset.address,
      valueToNano(amount.value, borrowVault.value.asset.decimals),
      borrowVault.value.address,
      borrowVault.value.asset.address,
      borrowVault.value.asset.symbol,
    )

    modal.open(OperationTrackerTransactionModal, {
      props: { transactionLinker: tl },
      onClose: () => {
        setTimeout(() => {
          updateBorrowPositions()
          router.replace('/portfolio')
        }, 400)
      },
    })
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
  estimatesError.value = ''
  if (!position.value || !collateralVault.value || !borrowVault.value) {
    return
  }
  try {
    if (balanceFixed.value.lt(amountFixed.value)) {
      throw new Error('You repaying more than required')
    }
    estimateNetAPY.value = getNetAPY(
      getVaultPrice((position.value.supplied || 0n), collateralVault.value!),
      nanoToValue(collateralVault.value?.interestRateInfo.supplyAPY || 0n, 25), // TODO: consider calculated supplyAPY after withdraw
      getVaultPrice((position.value.borrowed || 0n) - valueToNano(amount.value, borrowVault.value.decimals), borrowVault.value),
      nanoToValue(borrowVault.value.interestRateInfo.borrowAPY || 0n, 25),
      opportunityInfoForCollateral.value?.apr || null,
      opportunityInfoForBorrow.value?.apr || null,
    )
    const userLtvFixed = (borrowedFixed.value.sub(amountFixed.value))
      .div((suppliedFixed.value).mul(priceFixed.value))
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

watch(isSdkLoaded, (val) => {
  if (val) {
    load()
  }
}, { immediate: true })
watch(isConnected, () => {
  updateBalance()
})
watch(amount, async () => {
  if (!collateralVault.value) {
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
    :loading="isLoading || !isSdkLoaded || isPositionsLoading"
    title="Repay position"
    @submit.prevent="submit"
  >
    <div v-if="!isConnected">
      Connect your wallet to see your positions
    </div>

    <div v-else-if="!position">
      Position not found
    </div>

    <template v-else>
      <div class="between">
        <VaultLabelsAndAssets
          :vault="position.borrow"
          :assets="assets as VaultAsset[]"
          size="large"
        />
      </div>

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

      <VaultFormInfoBlock
        v-if="collateralVault && borrowVault"
        :loading="isEstimatesLoading"
        class="column gap-16"
      >
        <div class="between align-center flex-wrap gap-8">
          <p class="text-euler-dark-900">
            Net APY
          </p>

          <p
            v-if="netAPY !== estimateNetAPY"
            class="p2 text-euler-dark-900"
          >
            {{ formatNumber(netAPY) }}% → <span class="text-white">{{ formatNumber(estimateNetAPY) }}%</span>
          </p>
          <p
            v-else
            class="p2 text-white"
          >
            {{ formatNumber(netAPY) }}%
          </p>
        </div>
        <div class="between align-center flex-wrap gap-8">
          <p class="text-euler-dark-900">
            Current price
          </p>
          <p class="p2 align-center gap-4">
            ${{ formatNumber(nanoToValue(position.price, 18)) }}
            <span class="text-euler-dark-900 p3">
              {{ collateralVault.asset.symbol }}/{{ borrowVault.asset.symbol }}
            </span>
          </p>
        </div>
        <div class="between align-center flex-wrap gap-8">
          <p class="text-euler-dark-900">
            Liquidation price
          </p>
          <p class="p2 align-center gap-4">
            ${{ formatNumber(liquidationPrice) }}
            <span class="text-euler-dark-900 p3">
              {{ collateralVault.asset.symbol }}
            </span>
          </p>
        </div>
        <div class="between align-center flex-wrap gap-8">
          <p class="text-euler-dark-900">
            Your LTV (LLTV)
          </p>
          <p
            v-if="position.userLTV !== estimateUserLTV"
            class="p2 text-euler-dark-900"
          >
            {{ formatNumber(nanoToValue(position.userLTV, 18)) }}%
            <span class="p3">
              ({{ formatNumber(nanoToValue(position.liquidationLTV, 2)) }}%)
            </span>
            → <span class="text-white">
              {{ formatNumber(nanoToValue(estimateUserLTV, 18)) }}%
              <span class="text-euler-dark-900 p3">
                ({{ formatNumber(nanoToValue(position.liquidationLTV, 2)) }}%)
              </span>
            </span>
          </p>
          <p
            v-else
            class="p2 align-center gap-4"
          >
            {{ formatNumber(nanoToValue(position.userLTV, 18)) }}%
            <span class="text-euler-dark-900 p3">
              ({{ formatNumber(nanoToValue(position.liquidationLTV, 2)) }}%)
            </span>
          </p>
        </div>
        <div class="between align-center flex-wrap gap-8">
          <p class="text-euler-dark-900">
            Your health
          </p>

          <p
            v-if="position.health !== estimateHealth"
            class="p2 text-euler-dark-900"
          >
            {{ formatNumber(nanoToValue(position.health, 18)) }} → <span class="text-white">{{ formatNumber(nanoToValue(estimateHealth, 18)) }}</span>
          </p>
          <p
            v-else
            class="p2 text-white"
          >
            {{ formatNumber(nanoToValue(position.health, 18)) }}
          </p>
        </div>
      </VaultFormInfoBlock>
    </template>

    <template #buttons>
      <VaultFormInfoButton
        :pair="position"
        :disabled="isLoading || !isSdkLoaded || isSubmitting"
      >
        Pair information
      </VaultFormInfoButton>
      <VaultFormSubmit
        :disabled="isSubmitDisabled"
        :loading="isSubmitting"
      >
        Review Repay
      </VaultFormSubmit>
    </template>
  </VaultForm>
</template>
