<script setup lang="ts">
import { useAccount } from '@wagmi/vue'
import { FixedNumber, ethers } from 'ethers'
import { type BorrowVaultPair, getVaultPriceInfo, type Vault } from '~/entities/vault'
import { useEulerProductOfVault } from '~/composables/useEulerLabels'
import { useSwapCollateralOptions } from '~/composables/useSwapCollateralOptions'

const route = useRoute()
const { getVault } = useVaults()
const { isConnected } = useAccount()
const { getBalance } = useWallets()

const isLoading = ref(false)
const isSubmitting = ref(false)
const fromAmount = ref('')
const toAmount = ref('')
const slippage = ref(0.5)
const tab = ref()

const fromVault: Ref<Vault | undefined> = ref()
const toVault: Ref<Vault | undefined> = ref()

const fromProduct = useEulerProductOfVault(computed(() => fromVault.value?.address || ''))
const toProduct = useEulerProductOfVault(computed(() => toVault.value?.address || ''))
const { collateralOptions, collateralVaults } = useSwapCollateralOptions(fromVault)

const getVaultAddress = () => route.params.vault as string
const getTargetAddress = () => (typeof route.query.to === 'string' ? route.query.to : '')

const loadVaults = async () => {
  isLoading.value = true
  try {
    const baseAddress = getVaultAddress()
    const targetAddress = getTargetAddress()

    fromVault.value = await getVault(baseAddress)
    if (targetAddress && ethers.isAddress(targetAddress) && ethers.getAddress(targetAddress) !== ethers.getAddress(baseAddress)) {
      toVault.value = await getVault(targetAddress)
    }
    else {
      toVault.value = fromVault.value
    }
  }
  catch (e) {
    console.warn('[lend swap] failed to load vaults', e)
  }
  finally {
    isLoading.value = false
  }
}

await loadVaults()

watch([() => route.params.vault, () => route.query.to], () => {
  loadVaults()
})

const normalizeAddress = (address?: string) => {
  if (!address) {
    return ''
  }
  try {
    return ethers.getAddress(address)
  }
  catch {
    return ''
  }
}

const syncToVault = () => {
  if (!fromVault.value) {
    return
  }
  if (!collateralVaults.value.length) {
    if (!toVault.value) {
      toVault.value = fromVault.value
    }
    return
  }

  const currentAddress = toVault.value ? normalizeAddress(toVault.value.address) : ''
  const nextVault = collateralVaults.value.find(vault => normalizeAddress(vault.address) === currentAddress)
    || collateralVaults.value[0]

  if (!toVault.value || normalizeAddress(toVault.value.address) !== normalizeAddress(nextVault.address)) {
    toVault.value = nextVault
  }
}

watch([collateralVaults, fromVault], () => {
  syncToVault()
}, { immediate: true })

const pair = computed<BorrowVaultPair | undefined>(() => {
  if (!fromVault.value || !toVault.value) {
    return undefined
  }
  return {
    collateral: fromVault.value,
    borrow: toVault.value,
    borrowLTV: 0n,
    liquidationLTV: 0n,
    initialLiquidationLTV: 0n,
  }
})

const priceFixed = computed(() => {
  const fromPrice = fromVault.value ? getVaultPriceInfo(fromVault.value) : undefined
  const toPrice = toVault.value ? getVaultPriceInfo(toVault.value) : undefined
  const ask = fromPrice?.amountOutAsk || 0n
  const bid = toPrice?.amountOutBid || 1n
  return FixedNumber.fromValue(ask, 18).div(FixedNumber.fromValue(bid, 18))
})

const fromAmountFixed = computed(() => FixedNumber.fromValue(
  valueToNano(fromAmount.value || '0', Number(fromVault.value?.decimals || 18)),
  Number(fromVault.value?.decimals || 18),
))

const balance = computed(() => {
  if (!fromVault.value?.asset.address) {
    return 0n
  }
  return getBalance(fromVault.value?.asset.address as `0x${string}`) || 0n
})

const errorText = computed(() => {
  if (!fromVault.value?.asset) {
    return null
  }
  if (balance.value < valueToNano(fromAmount.value, fromVault.value.asset.decimals)) {
    return 'Not enough balance'
  }
  return null
})

const isSubmitDisabled = computed(() => {
  if (!isConnected.value) return false
  if (!fromVault.value?.asset || !toVault.value?.asset) {
    return true
  }
  return isLoading.value
    || balance.value < valueToNano(fromAmount.value, fromVault.value.asset.decimals)
    || !(+fromAmount.value)
    || !toAmount.value
})

const minReceived = computed(() => {
  const output = Number(toAmount.value || 0)
  if (!output) {
    return null
  }
  const factor = Math.max(0, 1 - slippage.value / 100)
  return output * factor
})

const tabs = computed(() => {
  if (!pair.value) {
    return []
  }
  return [
    {
      label: 'Pair details',
      value: undefined,
      avatars: [getAssetLogoUrl(pair.value.collateral.asset.symbol), getAssetLogoUrl(pair.value.borrow.asset.symbol)],
    },
    {
      label: pair.value.collateral.asset.symbol,
      value: 'collateral',
      avatars: [getAssetLogoUrl(pair.value.collateral.asset.symbol)],
    },
    {
      label: pair.value.borrow.asset.symbol,
      value: 'borrow',
      avatars: [getAssetLogoUrl(pair.value.borrow.asset.symbol)],
    },
  ]
})

const onFromInput = async () => {
  if (!fromVault.value || !toVault.value || !fromAmount.value || priceFixed.value.isZero()) {
    toAmount.value = ''
    return
  }
  await nextTick()
  toAmount.value = fromAmountFixed.value
    .mul(priceFixed.value)
    .round(Number(toVault.value?.decimals || 18))
    .toString()
}

watch(toVault, () => {
  if (!toVault.value) {
    toAmount.value = ''
    return
  }
  if (fromAmount.value) {
    onFromInput()
  }
})

const onToVaultChange = (selectedIndex: number) => {
  const nextVault = collateralVaults.value[selectedIndex]
  if (!nextVault) {
    return
  }
  if (!toVault.value || normalizeAddress(toVault.value.address) !== normalizeAddress(nextVault.address)) {
    toVault.value = nextVault
  }
}

const submit = async () => {
  if (isSubmitting.value) {
    return
  }
  isSubmitting.value = true
  try {
    await nextTick()
  }
  finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <div class="flex gap-32">
    <VaultForm
      title="Asset swap"
      class="flex flex-col gap-16 w-full"
      :loading="isLoading"
      @submit.prevent="submit"
    >
      <template v-if="fromVault && toVault">

        <AssetInput
          v-model="fromAmount"
          :desc="fromProduct.name"
          label="From"
          :asset="fromVault.asset"
          :vault="fromVault"
          :balance="balance"
          maxable
          @input="onFromInput"
        />

        <UiRange
          v-model="slippage"
          label="Slippage tolerance"
          :step="0.1"
          :max="5"
          :number-filter="(n: number) => `${n}%`"
        />

        <AssetInput
          v-model="toAmount"
          :desc="toProduct.name"
          label="To"
          :asset="toVault.asset"
          :vault="toVault"
          :collateral-options="collateralOptions"
          @change-collateral="onToVaultChange"
        />

        <UiToast
          v-show="errorText"
          title="Error"
          variant="error"
          :description="errorText || ''"
          size="compact"
        />

        <VaultFormInfoBlock
          class="bg-euler-dark-400 p-16 rounded-16 flex flex-col gap-16"
        >
          <div class="flex justify-between items-center">
            <p class="text-euler-dark-900">
              Rate
            </p>
            <p class="text-p2">
              {{ !priceFixed.isZero() ? formatNumber(priceFixed.toUnsafeFloat()) : '-' }}
              <span class="text-euler-dark-900 text-p3">
                {{ fromVault.asset.symbol }}/{{ toVault.asset.symbol }}
              </span>
            </p>
          </div>
          <div class="flex justify-between items-center">
            <p class="text-euler-dark-900">
              Estimated received
            </p>
            <p class="text-p2">
              {{ toAmount ? formatNumber(toAmount) : '-' }}
              <span class="text-euler-dark-900 text-p3">
                {{ toVault.asset.symbol }}
              </span>
            </p>
          </div>
          <div class="flex justify-between items-center">
            <p class="text-euler-dark-900">
              Minimum received
            </p>
            <p class="text-p2">
              {{ minReceived ? formatNumber(minReceived) : '-' }}
              <span class="text-euler-dark-900 text-p3">
                {{ toVault.asset.symbol }}
              </span>
            </p>
          </div>
          <div class="flex justify-between items-center">
            <p class="text-euler-dark-900">
              Slippage tolerance
            </p>
            <p class="text-p2">
              {{ formatNumber(slippage, 2, 0) }}%
            </p>
          </div>
        </VaultFormInfoBlock>
      </template>

      <template #buttons>
        <VaultFormInfoButton
          :pair="pair"
          class="laptop:!hidden"
        />
        <VaultFormSubmit
          :disabled="isSubmitDisabled"
          :loading="isSubmitting"
        >
          Review Swap
        </VaultFormSubmit>
      </template>
    </VaultForm>
    <div
      v-if="pair"
      class="w-full mobile:hidden"
    >
      <UiTabs
        v-if="tabs.length"
        v-model="tab"
        class="mb-12"
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
        <VaultOverviewPair
          v-if="!tab"
          :pair="pair"
          style="flex-grow: 1"
          desktop-overview
        />
        <VaultOverview
          v-else-if="tab === 'collateral'"
          :vault="pair.collateral"
          desktop-overview
        />
        <VaultOverview
          v-else-if="tab === 'borrow'"
          :vault="pair.borrow"
          desktop-overview
        />
      </Transition>
    </div>
  </div>
</template>
