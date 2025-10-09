<script setup lang="ts">
import { FixedNumber } from 'ethers'
import { useModal } from '~/components/ui/composables/useModal'
import OperationTrackerTransactionModal
  from '~/components/entities/operation/OperationTrackerTransactionModal.vue'
import { OperationReviewModal } from '#components'
import { useToast } from '~/components/ui/composables/useToast'
import { nanoToValue } from '~/utils/ton-utils'
import { getNetAPY, getVaultPrice } from '~/entities/vault'
import type { AccountBorrowPosition } from '~/entities/account'

const { withdraw } = useEulerOperations()
const { error } = useToast()
const modal = useModal()

const route = useRoute()
const { isPositionsLoaded, borrowPositions, updateBorrowPositions } = useEulerAccount()
const { isLoaded: isSdkLoaded } = useTacSdk()
const { isConnected, tonConnectUI } = useTonConnect()
const { getOpportunityOfBorrowVault, getOpportunityOfLendVault } = useMerkl()

const positionIndex = route.params.number as string

const isLoading = ref(false)
const isSubmitting = ref(false)
const isEstimatesLoading = ref(false)
const amount = ref('')
const estimateNetAPY = ref(0)
const estimateUserLTV = ref(0n)
const estimateHealth = ref(0n)
const position: Ref<AccountBorrowPosition | undefined> = ref()
const estimatesError = ref('')

const collateralVault = computed(() => position.value?.collateral)
const borrowVault = computed(() => position.value?.borrow)
const asset = computed(() => collateralVault.value?.asset)
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
  valueToNano(amount.value || '0', collateralVault.value?.decimals),
  Number(collateralVault.value?.decimals),
))
const borrowedFixed = computed(() => FixedNumber.fromValue(position.value?.borrowed || 0n, position.value?.borrow.decimals || 18))
const suppliedFixed = computed(() => FixedNumber.fromValue(position.value?.supplied || 0n, position.value?.collateral.decimals || 18))
const priceFixed = computed(() => FixedNumber.fromValue(position.value?.price || 0n, 18))
const liquidationPrice = computed(() => {
  if (nanoToValue(position.value?.health || 0n, 18) < 0.1) {
    return Infinity
  }
  return nanoToValue(position.value?.price || 0n, 18) / nanoToValue(position.value?.health || 1n, 18)
})
const isSubmitDisabled = computed(() => {
  if (!isConnected.value) return false
  return (position.value?.supplied || 0n) < valueToNano(amount.value, asset.value?.decimals)
    || isLoading.value || !isSdkLoaded.value || !(+amount.value) || !!estimatesError.value || isEstimatesLoading.value
})

const load = async () => {
  if (!isConnected.value) {
    showError('Wallet is not connected.')
  }
  isLoading.value = true
  await until(isPositionsLoaded).toBe(true)
  try {
    position.value = borrowPositions.value[+positionIndex - 1]
    if (!position.value) {
      showError('Position is not found.')
    }
    // updateEstimates()
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
  if (!isConnected.value) {
    tonConnectUI.openModal()
    isSubmitting.value = false
    return
  }

  modal.open(OperationReviewModal, {
    props: {
      type: 'withdraw',
      asset: asset.value,
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
    if (!asset.value?.address) {
      return
    }
    const tl = await withdraw(
      collateralVault.value!.address,
      asset.value!.address,
      valueToNano(amount.value || '0', asset.value.decimals),
      asset.value.symbol,
      position.value?.subAccount,
    )
    modal.open(OperationTrackerTransactionModal, {
      props: { transactionLinker: tl },
      onClose: async () => {
        await updateBorrowPositions()
        await updateEstimates()
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
  if (!collateralVault.value) {
    return
  }
  try {
    if (suppliedFixed.value.lte(amountFixed.value)) {
      throw new Error('Not enough liquidity in your position')
    }
    estimateNetAPY.value = getNetAPY(
      getVaultPrice((position.value!.supplied || 0n) - valueToNano(amount.value, collateralVault.value.decimals), collateralVault.value!),
      nanoToValue(collateralVault.value?.interestRateInfo.supplyAPY || 0n, 25), // TODO: consider calculated supplyAPY after withdraw
      getVaultPrice(position.value!.borrowed || 0n || 0, borrowVault.value!),
      nanoToValue(borrowVault.value?.interestRateInfo.borrowAPY || 0n, 25),
      opportunityInfoForCollateral.value?.apr || null,
      opportunityInfoForBorrow.value?.apr || null,
    )
    const userLtvFixed = borrowedFixed.value
      .div((suppliedFixed.value.sub(amountFixed.value)).mul(priceFixed.value))
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

load()
watch(amount, async () => {
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
    :loading="isLoading || !isSdkLoaded"
    @submit.prevent="submit"
  >
    <template v-if="collateralVault && asset">
      <div class="between">
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
        :balance="position.supplied"
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
        v-if="position && borrowVault"
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
        :disabled="isLoading || !isSdkLoaded || isSubmitting"
        :vault="collateralVault"
      />
      <VaultFormSubmit
        :disabled="isSubmitDisabled"
        :loading="isSubmitting"
      >
        Review Withdraw
      </VaultFormSubmit>
    </template>
  </VaultForm>
</template>

<style module lang="scss">
.LendVaultPage {
  min-height: calc(100dvh - 178px);
}
</style>
