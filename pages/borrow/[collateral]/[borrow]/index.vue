<script setup lang="ts">
import { useAccount } from '@wagmi/vue'
import { FixedNumber } from 'ethers'
import { useModal } from '~/components/ui/composables/useModal'
import { OperationReviewModal } from '#components'
import { useToast } from '~/components/ui/composables/useToast'
import { type BorrowVaultPair, getNetAPY, getVaultPrice, type VaultAsset, type CollateralOption, convertAssetsToShares } from '~/entities/vault'
import { useEulerProductOfVault } from '~/composables/useEulerLabels'

const router = useRouter()
const route = useRoute()
const modal = useModal()
const { error } = useToast()
const { borrowBySaving, borrow } = useEulerOperations()
const { getBorrowVaultPair, updateVault } = useVaults()
const { address, isConnected } = useAccount()
const { updateBorrowPositions, depositPositions, isPositionsLoading } = useEulerAccount()
const { getOpportunityOfBorrowVault, getOpportunityOfLendVault } = useMerkl()
const { eulerLensAddresses } = useEulerAddresses()
const { getBalance } = useWallets()

const ltv = ref(0)
const borrowAmount = ref('')
const collateralAmount = ref('')
const balance = ref(0n)
const savingBalance = ref(0n)
const savingAssets = ref(0n)
const isSubmitting = ref(false)
const isEstimatesLoading = ref(false)
const pair: Ref<BorrowVaultPair | undefined> = ref(await getBorrowVaultPair(route.params.collateral as string, route.params.borrow as string))
const health = ref()
const netAPY = ref()
const liquidationPrice = ref()
const isSavingCollateral = ref(false)

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

const opportunityInfoForBorrow = computed(() => getOpportunityOfBorrowVault(pair.value?.borrow.asset.address || ''))
const opportunityInfoForCollateral = computed(() => getOpportunityOfLendVault(pair.value?.collateral.address || ''))

const savingCollateral = computed(() => {
  return depositPositions.value.find(position => position.vault.address === route.params.collateral)
})
const collateralOptions = computed(() => {
  const options = [
    {
      type: 'wallet',
      amount: nanoToValue(balance.value, collateralVault.value?.asset.decimals),
      price: getVaultPrice(nanoToValue(balance.value, collateralVault.value?.asset.decimals) || 0, collateralVault.value!),
    },
  ]

  if (savingCollateral.value) {
    options.push({
      type: 'saving',
      amount: nanoToValue(savingCollateral.value.assets, collateralVault.value?.asset.decimals),
      price: getVaultPrice(nanoToValue(savingCollateral.value.assets, collateralVault.value?.asset.decimals) || 0, collateralVault.value!),
    })
  }
  return options
})
const computedBalance = computed(() => {
  if (isSavingCollateral.value) return savingAssets.value || 0n
  return balance.value
})
const updateBalance = async () => {
  if (!isConnected.value) {
    balance.value = 0n
    return
  }
  balance.value = getBalance(collateralVault.value?.asset.address as `0x${string}`) || 0n
  savingBalance.value = getBalance(collateralVault.value?.address as `0x${string}`) || 0n
}
const submit = async () => {
  // TODO: Validate
  if (!isConnected.value) {
    isSubmitting.value = false
    return
  }

  modal.open(OperationReviewModal, {
    props: {
      type: 'borrow',
      asset: borrowVault.value?.asset,
      amount: borrowAmount.value,
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
    updateBorrowPositions(eulerLensAddresses.value, address.value || '', false)
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
const onChangeCollateral = (isSaving: boolean) => {
  isSavingCollateral.value = isSaving
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

watch(pair, (val) => {
  if (!val) {
    return
  }
  updateBalance()
}, { immediate: true })
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
</script>

<template>
  <VaultForm
    title="Open borrow position"
    class="column gap-16"
    @submit.prevent="submit"
  >
    <template v-if="pair">
      <VaultLabelsAndAssets
        v-if="collateralVault && borrowVault"
        :vault="collateralVault"
        :assets="pairAssets as VaultAsset[]"
        size="large"
      />

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

    <template #buttons>
      <VaultFormInfoButton
        :pair="pair"
        :disabled="isSubmitting || isPositionsLoading"
      />
      <VaultFormSubmit
        :disabled="isSubmitDisabled"
        :loading="isSubmitting"
      >
        Review Borrow
      </VaultFormSubmit>
    </template>
  </VaultForm>
</template>
