<script setup lang="ts">
import { useAccount } from '@wagmi/vue'
import { FixedNumber } from 'ethers'
import { useModal } from '~/components/ui/composables/useModal'
import { OperationReviewModal } from '#components'
import { useToast } from '~/components/ui/composables/useToast'
import { useEulerProductOfVault } from '~/composables/useEulerLabels'
import { getNetAPY, getVaultPrice } from '~/entities/vault'
import type { TxPlan } from '~/entities/txPlan'

const router = useRouter()
const route = useRoute()
const modal = useModal()
const { error } = useToast()
const { supply, buildSupplyPlan } = useEulerOperations()
const { isConnected } = useAccount()
const positionIndex = route.params.number as string
const { borrowPositions, isPositionsLoaded, getOperatorForSubAccount } = useEulerAccount()
const { getOpportunityOfBorrowVault, getOpportunityOfLendVault } = useMerkl()
const { getBalance } = useWallets()

const isLoading = ref(false)
const isSubmitting = ref(false)
const isEstimatesLoading = ref(false)
const amount = ref('')
const plan = ref<TxPlan | null>(null)
const balance = ref(0n)
const estimateNetAPY = ref(0)
const estimateUserLTV = ref(0n)
const estimateHealth = ref(0n)
const estimatesError = ref('')

const position = computed(() => borrowPositions.value[+positionIndex - 1])
const isPositionLoaded = computed(() => !!position.value)
const collateralVault = computed(() => position.value?.collateral)
const borrowVault = computed(() => position.value?.borrow)
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
const balanceFixed = computed(() => FixedNumber.fromValue(balance.value, collateralVault.value?.decimals || 18))
const liquidationPrice = computed(() => {
  if (nanoToValue(position.value?.health || 0n, 18) < 0.1) {
    return Infinity
  }
  return nanoToValue(position.value?.price || 0n, 18) / nanoToValue(position.value?.health || 1n, 18)
})
const asset = computed(() => collateralVault.value?.asset)
const assets = computed(() => [asset.value])
const isSubmitDisabled = computed(() => {
  if (!isConnected.value) return false
  return balance.value < valueToNano(amount.value, asset.value?.decimals)
    || isLoading.value || !(+amount.value) || !!estimatesError.value || isEstimatesLoading.value
})
const { name } = useEulerProductOfVault(collateralVault.value?.address)

const load = async () => {
  if (!isConnected.value) {
    showError('Wallet is not connected.')
  }
  isLoading.value = true
  await until(isPositionLoaded).toBe(true)
  try {
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

  balance.value = getBalance(collateralVault.value?.asset.address as `0x${string}`) || 0n
}
const submit = async () => {
  if (!collateralVault.value?.asset.address) {
    return
  }

  try {
    plan.value = await buildSupplyPlan(
      collateralVault.value.address,
      collateralVault.value.asset.address,
      valueToNano(amount.value || '0', collateralVault.value.asset.decimals),
      collateralVault.value.asset.symbol,
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
      type: 'supply',
      asset: asset.value,
      amount: amount.value,
      plan: plan.value || undefined,
      subAccount: position.value?.subAccount,
      hasBorrows: (position.value?.borrowed || 0n) > 0n,
      onConfirm: (disableOperator?: boolean, transferAssets?: boolean) => {
        setTimeout(() => {
          send(disableOperator, transferAssets)
        }, 400)
      },
    },
  })
}
const send = async (disableOperator?: boolean, transferAssets?: boolean) => {
  try {
    isSubmitting.value = true
    if (!asset.value?.address) {
      return
    }

    await supply(
      collateralVault.value.address,
      asset.value.address,
      valueToNano(amount.value || '0', asset.value.decimals),
      asset.value.symbol,
      position.value?.subAccount,
    )

    if (disableOperator && position.value?.subAccount) {
      const { getSwapPoolForSubAccount } = useSwapPools()
      const { disableOperator: disableOperatorFn } = useEulerOperations()
      const operator = getOperatorForSubAccount(position.value.subAccount)

      if (operator) {
        const swapPool = transferAssets ? await getSwapPoolForSubAccount(position.value.subAccount as Address) : null

        await disableOperatorFn(
          operator,
          position.value.subAccount as Address,
          true,
          swapPool?.factory,
          swapPool
            ? {
                vault0: swapPool.vault0.address,
                vault1: swapPool.vault1.address,
              }
            : undefined,
        )
      }
    }

    modal.close()
    await updateBalance()
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
    if (balanceFixed.value.lt(amountFixed.value)) {
      throw new Error('Not enough balance')
    }
    estimateNetAPY.value = getNetAPY(
      getVaultPrice((position.value!.supplied || 0n) + valueToNano(amount.value, collateralVault.value.decimals), collateralVault.value!),
      nanoToValue(collateralVault.value?.interestRateInfo.supplyAPY || 0n, 25), // TODO: consider calculated supplyAPY after withdraw
      getVaultPrice(position.value!.borrowed || 0n, borrowVault.value!),
      nanoToValue(borrowVault.value?.interestRateInfo.borrowAPY || 0n, 25),
      opportunityInfoForCollateral.value?.apr || null,
      opportunityInfoForBorrow.value?.apr || null,
    )
    const collateralValue = (suppliedFixed.value.add(amountFixed.value)).mul(priceFixed.value)
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
    title="Supply"
    :loading="isLoading"
    @submit.prevent="submit"
  >
    <div v-if="!isConnected">
      Connect your wallet to see your positions
    </div>

    <template v-else-if="collateralVault">
      <div class="flex justify-between">
        <VaultLabelsAndAssets
          :vault="collateralVault"
          :assets="assets"
          size="large"
        />
      </div>

      <AssetInput
        v-if="asset"
        v-model="amount"
        label="Deposit amount"
        :desc="name"
        :asset="asset"
        :vault="collateralVault"
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
        v-if="position"
        :loading="isEstimatesLoading"
        class="flex flex-col gap-16"
      >
        <div class="flex justify-between items-center flex-wrap gap-8">
          <p class="text-euler-dark-900">
            Net APY
          </p>

          <p
            v-if="netAPY !== estimateNetAPY"
            class="text-p2 text-euler-dark-900"
          >
            {{ formatNumber(netAPY) }}% → <span class="text-white">{{ formatNumber(estimateNetAPY) }}%</span>
          </p>
          <p
            v-else
            class="text-p2 text-white"
          >
            {{ formatNumber(netAPY) }}%
          </p>
        </div>
        <div class="flex justify-between items-center flex-wrap gap-8">
          <p class="text-euler-dark-900">
            Current price
          </p>
          <p class="text-p2 flex items-center gap-4">
            ${{ formatNumber(nanoToValue(position.price, 18)) }}
            <span class="text-euler-dark-900 text-p3">
              {{ collateralVault.asset.symbol }}/{{ borrowVault.asset.symbol }}
            </span>
          </p>
        </div>
        <div class="flex justify-between items-center flex-wrap gap-8">
          <p class="text-euler-dark-900">
            Liquidation price
          </p>
          <p class="text-p2 flex items-center gap-4">
            ${{ formatNumber(liquidationPrice) }}
            <span class="text-euler-dark-900 text-p3">
              {{ collateralVault.asset.symbol }}
            </span>
          </p>
        </div>
        <div class="flex justify-between items-center flex-wrap gap-8">
          <p class="text-euler-dark-900">
            Your LTV (LLTV)
          </p>
          <p
            v-if="position.userLTV !== estimateUserLTV"
            class="text-p2 text-euler-dark-900"
          >
            {{ formatNumber(nanoToValue(position.userLTV, 18)) }}%
            <span class="text-p3">
              ({{ formatNumber(nanoToValue(position.liquidationLTV, 2)) }}%)
            </span>
            → <span class="text-white">
              {{ formatNumber(nanoToValue(estimateUserLTV, 18)) }}%
              <span class="text-euler-dark-900 text-p3">
                ({{ formatNumber(nanoToValue(position.liquidationLTV, 2)) }}%)
              </span>
            </span>
          </p>
          <p
            v-else
            class="text-p2 flex items-center gap-4"
          >
            {{ formatNumber(nanoToValue(position.userLTV, 18)) }}%
            <span class="text-euler-dark-900 text-p3">
              ({{ formatNumber(nanoToValue(position.liquidationLTV, 2)) }}%)
            </span>
          </p>
        </div>
        <div class="flex justify-between items-center flex-wrap gap-8">
          <p class="text-euler-dark-900">
            Your health
          </p>

          <p
            v-if="position.health !== estimateHealth"
            class="text-p2 text-euler-dark-900"
          >
            {{ formatNumber(nanoToValue(position.health, 18)) }} → <span class="text-white">{{ formatNumber(nanoToValue(estimateHealth, 18)) }}</span>
          </p>
          <p
            v-else
            class="text-p2 text-white"
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
        Review Supply
      </VaultFormSubmit>
    </template>
  </VaultForm>
</template>
