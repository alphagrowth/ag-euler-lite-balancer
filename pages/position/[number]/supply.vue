<script setup lang="ts">
import { FixedNumber } from 'ethers'
import { Address, TonClient } from '@ton/ton'
import { useModal } from '~/components/ui/composables/useModal'
import OperationTrackerTransactionModal
  from '~/components/entities/operation/OperationTrackerTransactionModal.vue'
import { OperationReviewModal } from '#components'
import { useToast } from '~/components/ui/composables/useToast'
import { useEulerProductOfVault } from '~/composables/useEulerLabels'
import { nanoToValue } from '~/utils/ton-utils'
import { getNetAPY, getVaultPrice } from '~/entities/vault'

let tvmAssetAddress: string

const route = useRoute()
const modal = useModal()
const { error } = useToast()
const { supply } = useEulerOperations()
const { isLoaded: isSdkLoaded } = useTacSdk()
const { isConnected, address, tonConnectUI, friendlyAddress } = useTonConnect()
const positionIndex = route.params.number as string
const { borrowPositions } = useEulerAccount()
const { getOpportunityOfBorrowVault, getOpportunityOfLendVault } = useMerkl()
const { TVM_TONCENTER_URL } = useAppConfig()

const isLoading = ref(false)
const isSubmitting = ref(false)
const isEstimatesLoading = ref(false)
const amount = ref('')
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
    || isLoading.value || !isSdkLoaded.value || !(+amount.value) || !!estimatesError.value || isEstimatesLoading.value
})
const { name } = useEulerProductOfVault(collateralVault.value?.address)

const load = async () => {
  if (!isConnected.value) {
    showError('Wallet is not connected.')
  }
  isLoading.value = true
  await until(isPositionLoaded).toBe(true)
  try {
    const { tacSdk } = useTacSdk()
    tvmAssetAddress = await tacSdk.getTVMTokenAddress(collateralVault.value.asset.address)
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
  const { tacSdk } = useTacSdk()
  if (!isConnected.value) {
    balance.value = 0n
    return
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
}
const submit = async () => {
  if (!isConnected.value) {
    tonConnectUI.openModal()
    isSubmitting.value = false
    return
  }

  modal.open(OperationReviewModal, {
    props: {
      type: 'supply',
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
    const tl = await supply(
      collateralVault.value.address,
      asset.value.address,
      valueToNano(amount.value || '0', asset.value.decimals),
      asset.value.symbol,
      position.value.subAccount,
    )
    console.log(tl)

    modal.open(OperationTrackerTransactionModal, {
      props: { transactionLinker: tl },
      onClose: async () => {
        await updateBalance()
        await updateEstimates()
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
    const userLtvFixed = borrowedFixed.value
      .div((suppliedFixed.value.add(amountFixed.value)).mul(priceFixed.value))
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
    title="Supply"
    :loading="isLoading || !isSdkLoaded"
    @submit.prevent="submit"
  >
    <div v-if="!isConnected">
      Connect your wallet to see your positions
    </div>

    <template v-else-if="collateralVault">
      <div class="between">
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
        :disabled="isLoading || isSubmitDisabled"
        :loading="isSubmitting"
      >
        Review Supply
      </VaultFormSubmit>
    </template>
  </VaultForm>
</template>

<style module lang="scss">
.info {
  & > *:not(:last-child) {
    padding-bottom: 16px;
    margin-bottom: 16px;
    border-bottom: 1px solid rgba(var(--white), 0.1);
  }
}
</style>
