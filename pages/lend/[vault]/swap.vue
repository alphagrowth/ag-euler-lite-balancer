<script setup lang="ts">
import { useAccount } from '@wagmi/vue'
import { ethers } from 'ethers'
import { type Address, zeroAddress } from 'viem'
import { type BorrowVaultPair, type Vault } from '~/entities/vault'
import { useEulerProductOfVault } from '~/composables/useEulerLabels'
import { useSwapCollateralOptions } from '~/composables/useSwapCollateralOptions'
import { useSwapApi } from '~/composables/useSwapApi'
import { type SwapApiQuote, SwapperMode } from '~/entities/swap'

const route = useRoute()
const { getVault } = useVaults()
const { isConnected, address } = useAccount()
const { depositPositions } = useEulerAccount()
const { getSwapQuotes, logSwapFailure } = useSwapApi()

const isLoading = ref(false)
const isSubmitting = ref(false)
const fromAmount = ref('')
const toAmount = ref('')
const slippage = ref(0.5)
const tab = ref()
const quotes = ref<SwapApiQuote[]>([])
const isQuoteLoading = ref(false)
const quoteError = ref<string | null>(null)
let quoteAbort: AbortController | null = null
let quoteRequestId = 0

const fromVault: Ref<Vault | undefined> = ref()
const toVault: Ref<Vault | undefined> = ref()

const fromProduct = useEulerProductOfVault(computed(() => fromVault.value?.address || ''))
const toProduct = useEulerProductOfVault(computed(() => toVault.value?.address || ''))
const { collateralOptions, collateralVaults } = useSwapCollateralOptions({ currentVault: fromVault })

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

const quote = computed(() => quotes.value[0] || null)

const resetQuoteState = () => {
  quotes.value = []
  quoteError.value = null
  toAmount.value = ''
  if (quoteAbort) {
    quoteAbort.abort()
    quoteAbort = null
  }
  quoteRequestId += 1
  isQuoteLoading.value = false
}

const quoteRate = computed(() => {
  if (!quote.value || !fromVault.value || !toVault.value) {
    return null
  }
  const amountIn = Number(ethers.formatUnits(BigInt(quote.value.amountIn), Number(fromVault.value.decimals)))
  const amountOut = Number(ethers.formatUnits(BigInt(quote.value.amountOut), Number(toVault.value.decimals)))
  if (!amountIn || !amountOut) {
    return null
  }
  return amountOut / amountIn
})

const savingPosition = computed(() => {
  if (!fromVault.value) {
    return null
  }
  const currentAddress = normalizeAddress(fromVault.value.address)
  if (!currentAddress) {
    return null
  }
  return depositPositions.value.find(position => normalizeAddress(position.vault.address) === currentAddress) || null
})

const balance = computed(() => {
  return savingPosition.value?.assets || 0n
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
  if (quote.value && toVault.value) {
    return Number(ethers.formatUnits(BigInt(quote.value.amountOutMin), Number(toVault.value.decimals)))
  }
  return null
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
  if (!fromVault.value || !toVault.value || !fromAmount.value) {
    toAmount.value = ''
    resetQuoteState()
    return
  }
  toAmount.value = ''
  requestQuote()
}

const requestQuote = useDebounceFn(async () => {
  quoteError.value = null

  if (!fromVault.value || !toVault.value || !fromAmount.value) {
    resetQuoteState()
    return
  }

  let amount: bigint
  try {
    amount = valueToNano(fromAmount.value, fromVault.value.asset.decimals)
  }
  catch {
    resetQuoteState()
    return
  }
  if (!amount || amount <= 0n) {
    resetQuoteState()
    return
  }

  toAmount.value = ''

  if (quoteAbort) {
    quoteAbort.abort()
  }
  const controller = new AbortController()
  quoteAbort = controller
  const requestId = ++quoteRequestId

  isQuoteLoading.value = true
  try {
    const data = await getSwapQuotes({
      tokenIn: fromVault.value.asset.address as Address,
      tokenOut: toVault.value.asset.address as Address,
      accountIn: (address.value || zeroAddress) as Address,
      accountOut: (address.value || zeroAddress) as Address,
      amount,
      vaultIn: fromVault.value.address as Address,
      receiver: toVault.value.address as Address,
      slippage: slippage.value,
      swapperMode: SwapperMode.EXACT_IN,
      isRepay: false,
      targetDebt: 0n,
      currentDebt: 0n,
    }, { signal: controller.signal })

    if (requestId !== quoteRequestId) {
      return
    }

    quotes.value = data
    const best = data[0]
    if (best && toVault.value) {
      toAmount.value = ethers.formatUnits(BigInt(best.amountOut), Number(toVault.value.decimals))
    }
  }
  catch (err) {
    const error = err as { name?: string; message?: string }
    if (error?.name === 'CanceledError' || error?.name === 'AbortError') {
      return
    }
    quoteError.value = 'Unable to fetch swap quote'
    quotes.value = []
    logSwapFailure({
      reason: error?.message || 'Unknown error',
      fromVault: fromVault.value?.address,
      toVault: toVault.value?.address,
      amount: fromAmount.value,
      slippage: slippage.value,
    })
  }
  finally {
    if (requestId === quoteRequestId) {
      isQuoteLoading.value = false
    }
  }
}, 500)

watch(toVault, () => {
  if (!toVault.value) {
    toAmount.value = ''
    resetQuoteState()
    return
  }
  if (fromAmount.value) {
    onFromInput()
  }
})

watch([fromVault, slippage], () => {
  if (fromAmount.value) {
    requestQuote()
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
          :readonly="true"
          @change-collateral="onToVaultChange"
        />

        <UiToast
          v-show="errorText"
          title="Error"
          variant="error"
          :description="errorText || ''"
          size="compact"
        />

        <UiToast
          v-if="quoteError"
          title="Swap quote"
          variant="warning"
          :description="quoteError"
          size="compact"
        />

        <VaultFormInfoBlock
          :loading="isQuoteLoading"
          class="bg-euler-dark-400 p-16 rounded-16 flex flex-col gap-16"
        >
          <div class="flex justify-between items-center">
            <p class="text-euler-dark-900">
              Rate
            </p>
            <p class="text-p2">
              {{ quoteRate !== null ? formatNumber(quoteRate) : '-' }}
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
