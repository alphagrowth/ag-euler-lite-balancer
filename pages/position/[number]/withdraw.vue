<script setup lang="ts">
import { useAccount } from '@wagmi/vue'
import { FixedNumber } from 'ethers'
import { useModal } from '~/components/ui/composables/useModal'
import { OperationReviewModal } from '#components'
import { useToast } from '~/components/ui/composables/useToast'
import { getNetAPY, getVaultPrice } from '~/entities/vault'

const router = useRouter()
const route = useRoute()
const { withdraw } = useEulerOperations()
const { error } = useToast()
const modal = useModal()
const { isPositionsLoaded, borrowPositions, updateBorrowPositions, getOperatorForSubAccount } = useEulerAccount()
const { isConnected, address } = useAccount()
const { getOpportunityOfBorrowVault, getOpportunityOfLendVault } = useMerkl()
const { eulerLensAddresses } = useEulerAddresses()

const positionIndex = route.params.number as string

const isLoading = ref(false)
const isSubmitting = ref(false)
const isEstimatesLoading = ref(false)
const amount = ref('')
const estimateNetAPY = ref(0)
const estimateUserLTV = ref(0n)
const estimateHealth = ref(0n)
const estimatesError = ref('')

const position = computed(() => borrowPositions.value[+positionIndex - 1])
const isPositionLoaded = computed(() => !!position.value)
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
// Use the correct collateral/borrow price ratio for LTV calculations (not the liquidation price)
const priceFixed = computed(() =>
  FixedNumber.fromValue(collateralVault.value?.liabilityPriceInfo?.amountOutAsk || 0n, 18)
    .div(FixedNumber.fromValue(borrowVault.value?.liabilityPriceInfo?.amountOutBid || 1n, 18)),
)
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
  return (position.value?.supplied || 0n) < valueToNano(amount.value, asset.value?.decimals)
    || isLoading.value || !(+amount.value) || !!estimatesError.value || isEstimatesLoading.value
})

const load = async () => {
  if (!isConnected.value) {
    showError('Wallet is not connected.')
  }
  isLoading.value = true
  await until(isPositionLoaded).toBe(true)
  try {
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
  modal.open(OperationReviewModal, {
    props: {
      type: 'withdraw',
      asset: asset.value,
      amount: amount.value,
      subAccount: position.value?.subAccount,
      onConfirm: (disableOperator: boolean) => {
        setTimeout(() => {
          send(disableOperator)
        }, 400)
      },
    },
  })
}
const send = async (disableOperator?: boolean) => {
  try {
    isSubmitting.value = true
    if (!asset.value?.address) {
      return
    }
    const operator = disableOperator ? (getOperatorForSubAccount(position.value?.subAccount) ?? undefined) : undefined
    await withdraw(
      collateralVault.value!.address,
      asset.value!.address,
      valueToNano(amount.value || '0', asset.value.decimals),
      asset.value.symbol,
      position.value?.subAccount,
      undefined,
      undefined,
      operator,
    )

    modal.close()
    updateBorrowPositions(eulerLensAddresses.value, address.value as string)
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
    const collateralValue = (suppliedFixed.value.sub(amountFixed.value)).mul(priceFixed.value)

    const userLtvFixed = collateralValue.isZero()
      ? FixedNumber.fromValue(0n, 18)
      : borrowedFixed.value
          .div(collateralValue)
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

watch(isPositionsLoaded, (val) => {
  if (val) {
    load()
  }
}, { immediate: true })
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
    :loading="isLoading"
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
        :disabled="isLoading || isSubmitting"
        :vault="collateralVault"
      />
      <VaultFormSubmit
        :disabled="isLoading || isSubmitDisabled"
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
