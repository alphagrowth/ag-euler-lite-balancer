<script setup lang="ts">
import { useAccount } from '@wagmi/vue'
import { ethers, FixedNumber } from 'ethers'
import { useModal } from '~/components/ui/composables/useModal'
import { OperationReviewModal } from '#components'
import { useToast } from '~/components/ui/composables/useToast'
import {
  type SecuritizeBorrowVaultPair,
  type SecuritizeVault,
  type Vault,
  type VaultAsset,
  getVaultPriceInfo,
} from '~/entities/vault'
import { useEulerProductOfVault } from '~/composables/useEulerLabels'
import VaultFormInfoBlock from '~/components/entities/vault/form/VaultFormInfoBlock.vue'
import VaultFormSubmit from '~/components/entities/vault/form/VaultFormSubmit.vue'
import SecuritizeVaultOverview from '~/components/entities/vault/overview/SecuritizeVaultOverview.vue'

const router = useRouter()
const route = useRoute()
const modal = useModal()
const { error } = useToast()
const { borrow, buildBorrowPlan } = useEulerOperations()
const { getSecuritizeBorrowVaultPair, updateVault, isReady: areVaultsReady } = useVaults()
const { address, isConnected } = useAccount()
const { updateBorrowPositions } = useEulerAccount()
const { eulerLensAddresses } = useEulerAddresses()
const { getBalance } = useWallets()

const collateralAddress = route.params.collateral as string
const borrowAddress = route.params.borrow as string

const ltv = ref(0)
const borrowAmount = ref('')
const collateralAmount = ref('')
const balance = ref(0n)
const isSubmitting = ref(false)
const isEstimatesLoading = ref(false)

// Try to load securitize vault pair - if it fails, redirect to regular borrow page
let initialPair: SecuritizeBorrowVaultPair | undefined
try {
  initialPair = await getSecuritizeBorrowVaultPair(collateralAddress, borrowAddress)
}
catch (e) {
  console.warn('[borrow-securitize] Failed to load securitize vault pair, redirecting to regular borrow:', e)
  navigateTo(`/borrow/${collateralAddress}/${borrowAddress}`, { replace: true })
}
const pair: Ref<SecuritizeBorrowVaultPair | undefined> = ref(initialPair)
const health = ref()
const liquidationPrice = ref()

const borrowVault = computed(() => pair.value?.borrow)
const collateralVault = computed(() => pair.value?.collateral)


const borrowProduct = useEulerProductOfVault(computed(() => borrowVault.value?.address || ''))
const collateralProduct = useEulerProductOfVault(computed(() => collateralVault.value?.address || ''))

const pairAssets = computed(() => [collateralVault.value?.asset, borrowVault.value?.asset])

// For securitize vaults, we need to get price differently
// Using the borrow vault's collateral prices to get the securitize vault price
const collateralPriceInfo = computed(() => {
  if (!borrowVault.value || !collateralVault.value) return null
  return borrowVault.value.collateralPrices.find(
    p => p.asset === collateralVault.value?.address,
  )
})

const borrowPriceInfo = computed(() => {
  if (!borrowVault.value) return null
  return getVaultPriceInfo(borrowVault.value)
})

const priceFixed = computed(() => {
  const ask = collateralPriceInfo.value?.amountOutAsk || collateralPriceInfo.value?.amountOutMid || 0n
  const bid = borrowPriceInfo.value?.amountOutBid || 1n
  if (!ask || !bid) return FixedNumber.fromValue(0n, 18)
  return FixedNumber.fromValue(ask, 18).div(FixedNumber.fromValue(bid, 18))
})

const collateralAmountFixed = computed(() => FixedNumber.fromValue(
  valueToNano(collateralAmount.value || '0', collateralVault.value?.decimals),
  Number(collateralVault.value?.decimals || 18),
))

const borrowAmountFixed = computed(() => FixedNumber.fromValue(
  valueToNano(borrowAmount.value || '0', borrowVault.value?.decimals),
  Number(borrowVault.value?.decimals || 18),
))

const ltvFixed = computed(() => {
  const fn = FixedNumber.fromValue(valueToNano(ltv.value, 4), 4)
  if (fn.gte(FixedNumber.fromValue(pair.value?.borrowLTV || 0n, 2))) {
    return fn.sub(FixedNumber.fromValue(100n, 4))
  }
  return fn
})

const errorText = computed(() => {
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
  return balance.value < valueToNano(collateralAmount.value, collateralVault.value?.asset?.decimals)
    || !(+collateralAmount.value)
    || ((borrowVault.value?.supply || 0n) < valueToNano(borrowAmount.value, borrowVault.value?.decimals))
    || !valueToNano(borrowAmount.value, borrowVault.value?.decimals)
})

const updateBalance = async () => {
  if (!isConnected.value || !collateralVault.value) {
    balance.value = 0n
    return
  }
  balance.value = getBalance(collateralVault.value.asset.address as `0x${string}`) || 0n
}

const onCollateralInput = async () => {
  await nextTick()
  if (priceFixed.value.isZero()) return
  borrowAmount.value = collateralAmountFixed.value
    .mul(priceFixed.value)
    .mul(ltvFixed.value)
    .div(FixedNumber.fromValue(100n))
    .round(Number(borrowVault.value?.decimals || 18))
    .toString()
}

const onBorrowInput = async () => {
  await nextTick()
  if (!collateralAmount.value || priceFixed.value.isZero()) {
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

const submit = async () => {
  if (!isConnected.value) {
    isSubmitting.value = false
    return
  }

  if (!borrowVault.value || !collateralVault.value) {
    return
  }

  const collateralAmountNano = valueToNano(collateralAmount.value || '0', collateralVault.value.decimals)
  const borrowAmountNano = valueToNano(borrowAmount.value || '0', borrowVault.value.decimals)

  let plan = null
  try {
    plan = await buildBorrowPlan(
      collateralVault.value.address,
      collateralVault.value.asset.address,
      collateralAmountNano,
      borrowVault.value.address,
      borrowAmountNano,
      undefined,
      { includePermit2Call: false },
    )
  }
  catch (e) {
    console.warn('[OperationReviewModal] failed to build plan', e)
  }

  modal.open(OperationReviewModal, {
    props: {
      type: 'borrow',
      asset: borrowVault.value.asset,
      amount: borrowAmount.value,
      plan: plan || undefined,
      supplyingAssetForBorrow: collateralVault.value.asset,
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

    const collateralAmountNano = collateralAmountFixed.value.toFormat({ decimals: Number(collateralVault.value.decimals) }).value
    const borrowAmountNano = borrowAmountFixed.value.toFormat({ decimals: Number(borrowVault.value.decimals) }).value

    await borrow(
      collateralVault.value.address,
      collateralVault.value.asset.address,
      collateralAmountNano,
      borrowVault.value.address,
      borrowVault.value.asset.address,
      borrowAmountNano,
      collateralVault.value.asset.symbol,
    )

    modal.close()
    updateBalance()
    updateBorrowPositions(eulerLensAddresses.value, address.value || '')
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
  if (!pair.value || !borrowVault.value) {
    return
  }
  try {
    await updateVault(borrowVault.value.address)
  }
  catch (e) {
    console.error(e)
  }
  try {
    health.value = ltvFixed.value.toUnsafeFloat() <= 0
      ? Infinity
      : (Number(pair.value.liquidationLTV) / 100) / ltvFixed.value.toUnsafeFloat()
    liquidationPrice.value = health.value < 0.1 ? Infinity : priceFixed.value.toUnsafeFloat() / health.value
  }
  catch (e) {
    console.warn(e)
    health.value = undefined
    liquidationPrice.value = undefined
  }
  finally {
    isEstimatesLoading.value = false
  }
}, 1000)

// Tab state for overview panel
const tab = ref<'collateral' | 'borrow' | undefined>(undefined)
const tabs = computed(() => {
  if (!pair.value) return []
  return [
    {
      label: 'Pair details',
      value: undefined,
      avatars: [getAssetLogoUrl(pair.value.collateral.asset.symbol), getAssetLogoUrl(pair.value.borrow.asset.symbol)],
    },
    {
      label: pair.value.collateral.asset.symbol,
      value: 'collateral' as const,
      avatars: [getAssetLogoUrl(pair.value.collateral.asset.symbol)],
    },
    {
      label: pair.value.borrow.asset.symbol,
      value: 'borrow' as const,
      avatars: [getAssetLogoUrl(pair.value.borrow.asset.symbol)],
    },
  ]
})

watch(pair, (val) => {
  if (!val) return
  updateBalance()
}, { immediate: true })

watch([collateralAmount, borrowAmount], async () => {
  if (!pair.value) return
  if (!isEstimatesLoading.value) {
    isEstimatesLoading.value = true
  }
  updateEstimates()
})

watch(areVaultsReady, async (ready) => {
  if (ready && collateralAddress && borrowAddress) {
    try {
      pair.value = await getSecuritizeBorrowVaultPair(collateralAddress, borrowAddress)
    }
    catch (e) {
      console.error('Error refreshing securitize vault pair:', e)
    }
  }
}, { immediate: false })
</script>

<template>
  <div class="flex gap-32">
    <VaultForm
      title="Open borrow position"
      class="flex flex-col gap-16 w-full min-w-0"
      @submit.prevent="submit"
    >
      <template v-if="pair && collateralVault && borrowVault">
        <!-- Header showing collateral and borrow assets -->
        <div class="flex items-center gap-12">
          <div class="flex items-center gap-8">
            <BaseAvatar
              :src="getAssetLogoUrl(collateralVault.asset.symbol)"
              :label="collateralVault.asset.symbol"
            />
            <BaseAvatar
              :src="getAssetLogoUrl(borrowVault.asset.symbol)"
              :label="borrowVault.asset.symbol"
            />
          </div>
          <div>
            <p class="text-h3">
              {{ collateralVault.name }}
            </p>
            <p class="text-euler-dark-900">
              {{ collateralVault.asset.symbol }} / {{ borrowVault.asset.symbol }}
            </p>
          </div>
        </div>

        <!-- Collateral Input -->
        <AssetInput
          v-model="collateralAmount"
          :desc="collateralProduct.name"
          :label="`Supply ${collateralVault.asset.symbol}`"
          :asset="collateralVault.asset"
          :balance="balance"
          maxable
          @input="onCollateralInput"
        />

        <!-- LTV Slider -->
        <UiRange
          v-model="ltv"
          label="LTV"
          :step="0.1"
          :max="Number(pair.borrowLTV / 100n)"
          :number-filter="(n: number) => `${n}%`"
          @update:model-value="onLtvInput"
        />

        <!-- Borrow Input -->
        <AssetInput
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

        <!-- Info Block -->
        <VaultFormInfoBlock
          :loading="isEstimatesLoading"
          class="bg-euler-dark-400 p-16 rounded-16 flex flex-col gap-16"
        >
          <div class="flex justify-between items-center">
            <p class="text-euler-dark-900">
              Current Price
            </p>
            <p class="text-p2">
              {{ !priceFixed.isZero() ? formatNumber(priceFixed.toUnsafeFloat()) : '-' }}
              <span class="text-euler-dark-900 text-p3">
                {{ collateralVault.asset.symbol }}/{{ borrowVault.asset.symbol }}
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
                {{ collateralVault.asset.symbol }}
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
          <div class="flex justify-between items-center">
            <p class="text-euler-dark-900">
              Max LTV
            </p>
            <p class="text-p2">
              {{ formatNumber(nanoToValue(pair.borrowLTV, 2), 2) }}%
            </p>
          </div>
          <div class="flex justify-between items-center">
            <p class="text-euler-dark-900">
              Liquidation LTV
            </p>
            <p class="text-p2">
              {{ formatNumber(nanoToValue(pair.liquidationLTV, 2), 2) }}%
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

    <!-- Overview Panel -->
    <div
      v-if="pair"
      class="w-full min-w-0 mobile:hidden"
    >
      <UiTabs
        v-if="tabs.length"
        v-model="tab"
        class="mb-12 min-w-0"
        :list="tabs"
      >
        <template #default="{ tab: slotTab }">
          <div class="flex items-center gap-8">
            <BaseAvatar :src="slotTab.avatars as string[]" />
            {{ slotTab.label }}
          </div>
        </template>
      </UiTabs>

      <Transition
        name="page"
        mode="out-in"
      >
        <!-- Default: show pair details -->
        <SecuritizeVaultOverviewPair
          v-if="!tab"
          :pair="pair"
          desktop-overview
        />
        <!-- Securitize collateral overview -->
        <SecuritizeVaultOverview
          v-else-if="tab === 'collateral'"
          :vault="pair.collateral"
          desktop-overview
        />
        <!-- Borrow vault overview (EVK) -->
        <VaultOverview
          v-else-if="tab === 'borrow'"
          :vault="pair.borrow"
          desktop-overview
        />
      </Transition>
    </div>
  </div>
</template>
