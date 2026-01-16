<script setup lang="ts">
import { useAccount } from '@wagmi/vue'
import { ethers } from 'ethers'
import { type Address, zeroAddress } from 'viem'
import { OperationReviewModal } from '#components'
import type { AccountBorrowPosition } from '~/entities/account'
import { type Vault, getVaultPrice } from '~/entities/vault'
import { useEulerProductOfVault } from '~/composables/useEulerLabels'
import { useSwapDebtOptions } from '~/composables/useSwapDebtOptions'
import { useSwapApi } from '~/composables/useSwapApi'
import { type SwapApiQuote, SwapperMode } from '~/entities/swap'
import type { TxPlan } from '~/entities/txPlan'
import { useModal } from '~/components/ui/composables/useModal'
import { useToast } from '~/components/ui/composables/useToast'
import { useMerkl } from '~/composables/useMerkl'
import { useIntrinsicApy } from '~/composables/useIntrinsicApy'

const route = useRoute()
const router = useRouter()
const { isConnected, address } = useAccount()
const { borrowPositions, isPositionsLoaded, isPositionsLoading } = useEulerAccount()
const { getSwapQuotes, logSwapFailure } = useSwapApi()
const { swap: executeSwap, buildSwapPlan } = useEulerOperations()
const modal = useModal()
const { error: showError } = useToast()
const { getOpportunityOfBorrowVault } = useMerkl()
const { withIntrinsicBorrowApy } = useIntrinsicApy()

const positionIndex = route.params.number as string

const isLoading = ref(false)
const isSubmitting = ref(false)
const plan = ref<TxPlan | null>(null)
const fromAmount = ref('')
const toAmount = ref('')
const slippage = ref(0.1)
const quotes = ref<SwapApiQuote[]>([])
const isQuoteLoading = ref(false)
const quoteError = ref<string | null>(null)
let quoteAbort: AbortController | null = null
let quoteRequestId = 0

const position: Ref<AccountBorrowPosition | null> = ref(null)

const fromVault = computed(() => position.value?.borrow)
const collateralVault = computed(() => position.value?.collateral)
const toVault: Ref<Vault | undefined> = ref()

const fromProduct = useEulerProductOfVault(computed(() => fromVault.value?.address || ''))
const toProduct = useEulerProductOfVault(computed(() => toVault.value?.address || ''))
const { borrowOptions, borrowVaults } = useSwapDebtOptions({
  collateralVault: computed(() => collateralVault.value as Vault | undefined),
  currentBorrowVault: computed(() => fromVault.value as Vault | undefined),
})

const loadPosition = async () => {
  isLoading.value = true
  await until(isPositionsLoaded).toBe(true)

  position.value = borrowPositions.value[+positionIndex - 1] || null
  if (position.value && !fromAmount.value) {
    fromAmount.value = `${nanoToValue(position.value.borrowed || 0n, position.value.borrow.decimals)}`
  }
  isLoading.value = false
}

watch([isPositionsLoaded, () => route.params.number], ([loaded]) => {
  if (loaded) {
    loadPosition()
  }
}, { immediate: true })

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

const getTargetAddress = () => (typeof route.query.to === 'string' ? route.query.to : '')

const syncToVault = () => {
  if (!fromVault.value) {
    return
  }
  if (!borrowVaults.value.length) {
    if (!toVault.value) {
      toVault.value = fromVault.value
    }
    return
  }

  const targetAddress = normalizeAddress(getTargetAddress())
  const currentAddress = toVault.value ? normalizeAddress(toVault.value.address) : ''
  const nextVault = borrowVaults.value.find(vault => normalizeAddress(vault.address) === targetAddress)
    || borrowVaults.value.find(vault => normalizeAddress(vault.address) === currentAddress)
    || borrowVaults.value[0]

  if (!toVault.value || normalizeAddress(toVault.value.address) !== normalizeAddress(nextVault.address)) {
    toVault.value = nextVault
  }
}

watch([borrowVaults, fromVault, () => route.query.to], () => {
  syncToVault()
}, { immediate: true })

const quote = computed(() => quotes.value[0] || null)
const currentDebt = computed(() => position.value?.borrowed || 0n)
const balance = computed(() => currentDebt.value)

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

const fromOpportunity = computed(() => {
  return fromVault.value ? getOpportunityOfBorrowVault(fromVault.value.asset.address) : null
})
const toOpportunity = computed(() => {
  return toVault.value ? getOpportunityOfBorrowVault(toVault.value.asset.address) : null
})
const fromBorrowApy = computed(() => {
  if (!fromVault.value) {
    return null
  }
  const base = nanoToValue(fromVault.value.interestRateInfo.borrowAPY || 0n, 25)
  return withIntrinsicBorrowApy(base, fromVault.value.asset.symbol) - (fromOpportunity.value?.apr || 0)
})
const toBorrowApy = computed(() => {
  if (!toVault.value) {
    return null
  }
  const base = nanoToValue(toVault.value.interestRateInfo.borrowAPY || 0n, 25)
  return withIntrinsicBorrowApy(base, toVault.value.asset.symbol) - (toOpportunity.value?.apr || 0)
})

const currentPrice = computed(() => {
  if (!quote.value || !fromVault.value || !toVault.value) {
    return null
  }
  const amountOut = Number(ethers.formatUnits(BigInt(quote.value.amountOut), Number(fromVault.value.asset.decimals)))
  const amountIn = Number(ethers.formatUnits(BigInt(quote.value.amountIn), Number(toVault.value.asset.decimals)))
  if (!amountOut || !amountIn) {
    return null
  }
  return {
    value: amountOut / amountIn,
    symbol: `${fromVault.value.asset.symbol}/${toVault.value.asset.symbol}`,
  }
})

const swapSummary = computed(() => {
  if (!quote.value || !fromVault.value || !toVault.value) {
    return null
  }
  const amountOut = ethers.formatUnits(BigInt(quote.value.amountOut), Number(fromVault.value.asset.decimals))
  const amountIn = ethers.formatUnits(BigInt(quote.value.amountIn), Number(toVault.value.asset.decimals))
  return {
    from: `${formatNumber(amountOut)} ${fromVault.value.asset.symbol}`,
    to: `${formatNumber(amountIn)} ${toVault.value.asset.symbol}`,
  }
})

const priceImpact = computed(() => {
  if (!quote.value || !fromVault.value || !toVault.value) {
    return null
  }
  const amountOutUsd = getVaultPrice(BigInt(quote.value.amountOut), fromVault.value)
  const amountInUsd = getVaultPrice(BigInt(quote.value.amountIn), toVault.value)
  if (!amountOutUsd || !amountInUsd) {
    return null
  }
  const impact = (amountInUsd / amountOutUsd - 1) * 100
  if (!Number.isFinite(impact)) {
    return null
  }
  return impact
})

const routedVia = computed(() => {
  if (!quote.value?.route?.length) {
    return null
  }
  return quote.value.route.map(route => route.providerName).join(', ')
})

const errorText = computed(() => {
  if (!fromVault.value?.asset || !fromAmount.value) {
    return null
  }
  try {
    const amount = valueToNano(fromAmount.value, fromVault.value.asset.decimals)
    if (amount > currentDebt.value) {
      return 'Amount exceeds current debt'
    }
  }
  catch {
    return null
  }
  return null
})

const isSubmitDisabled = computed(() => {
  if (!isConnected.value) return false
  if (!fromVault.value?.asset || !toVault.value?.asset || !quote.value) {
    return true
  }
  return isLoading.value
    || isQuoteLoading.value
    || !(+fromAmount.value)
    || !toAmount.value
    || !!errorText.value
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

  if (!fromVault.value || !toVault.value || !fromAmount.value || !position.value) {
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
  if (amount > currentDebt.value) {
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
    const accountIn = (address.value || zeroAddress) as Address
    const accountOut = (position.value.subAccount || accountIn) as Address
    const data = await getSwapQuotes({
      tokenIn: toVault.value.asset.address as Address,
      tokenOut: fromVault.value.asset.address as Address,
      accountIn,
      accountOut,
      amount,
      vaultIn: toVault.value.address as Address,
      receiver: fromVault.value.address as Address,
      slippage: slippage.value,
      swapperMode: SwapperMode.TARGET_DEBT,
      isRepay: true,
      targetDebt: 0n,
      currentDebt: 0n,
    }, { signal: controller.signal })

    if (requestId !== quoteRequestId) {
      return
    }

    quotes.value = data
    const best = data[0]
    if (best && toVault.value) {
      toAmount.value = ethers.formatUnits(BigInt(best.amountIn), Number(toVault.value.decimals))
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
      swapperMode: SwapperMode.TARGET_DEBT,
      isRepay: true,
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
  const nextVault = borrowVaults.value[selectedIndex]
  if (!nextVault) {
    return
  }
  if (!toVault.value || normalizeAddress(toVault.value.address) !== normalizeAddress(nextVault.address)) {
    toVault.value = nextVault
  }
}

const submit = async () => {
  if (isSubmitting.value || !fromVault.value || !quote.value) {
    return
  }

  try {
    plan.value = await buildSwapPlan({
      quote: quote.value,
      swapperMode: SwapperMode.TARGET_DEBT,
      isRepay: true,
      targetDebt: 0n,
      currentDebt: 0n,
    })
  }
  catch (e) {
    console.warn('[OperationReviewModal] failed to build plan', e)
    plan.value = null
  }

  modal.open(OperationReviewModal, {
    props: {
      type: 'swap',
      asset: fromVault.value.asset,
      amount: fromAmount.value,
      plan: plan.value || undefined,
      onConfirm: () => {
        setTimeout(() => {
          send()
        }, 400)
      },
    },
  })
}

const send = async () => {
  if (!fromVault.value || !quote.value) {
    return
  }

  isSubmitting.value = true
  try {
    await executeSwap({
      quote: quote.value,
      swapperMode: SwapperMode.TARGET_DEBT,
      isRepay: true,
      targetDebt: 0n,
      currentDebt: 0n,
    })
    modal.close()
    setTimeout(() => {
      router.replace('/portfolio')
    }, 400)
  }
  catch (e) {
    showError('Transaction failed')
    console.warn(e)
  }
  finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <div class="flex gap-32">
    <VaultForm
      title="Debt swap"
      class="flex flex-col gap-16 w-full"
      :loading="isLoading || isPositionsLoading"
      @submit.prevent="submit"
    >
      <template v-if="fromVault && toVault">
        <div class="grid gap-16 laptop:grid-cols-[minmax(0,1fr)_360px] laptop:items-start">
          <div class="flex flex-col gap-16 w-full">
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

            <AssetInput
              v-model="toAmount"
              :desc="toProduct.name"
              label="To"
              :asset="toVault.asset"
              :vault="toVault"
              :collateral-options="borrowOptions"
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
          </div>

          <VaultFormInfoBlock
            :loading="isQuoteLoading"
            class="bg-euler-dark-400 p-16 rounded-16 flex flex-col gap-16 w-full laptop:max-w-[360px]"
          >
            <div class="flex justify-between items-center">
              <p class="text-euler-dark-900">
                {{ fromVault.asset.symbol || 'Token1' }} borrow APY
              </p>
              <p class="text-p2">
                {{ fromBorrowApy !== null ? `${formatNumber(fromBorrowApy)}%` : '-' }}
              </p>
            </div>
            <div class="flex justify-between items-center">
              <p class="text-euler-dark-900">
                {{ toVault.asset.symbol || 'Token2' }} borrow APY
              </p>
              <p class="text-p2">
                {{ toBorrowApy !== null ? `${formatNumber(toBorrowApy)}%` : '-' }}
              </p>
            </div>
            <div class="flex justify-between items-center">
              <p class="text-euler-dark-900">
                Current price
              </p>
              <p class="text-p2">
                {{ currentPrice ? `${formatNumber(currentPrice.value)} ${currentPrice.symbol}` : '-' }}
              </p>
            </div>
            <div class="flex justify-between items-start">
              <p class="text-euler-dark-900">
                Swap
              </p>
              <p class="text-p2 text-right flex flex-col items-end">
                <span>{{ swapSummary ? swapSummary.from : '-' }}</span>
                <span
                  v-if="swapSummary"
                  class="text-euler-dark-900 text-p3"
                >
                  {{ swapSummary.to }}
                </span>
              </p>
            </div>
            <div class="flex justify-between items-center">
              <p class="text-euler-dark-900">
                Price impact
              </p>
              <p class="text-p2">
                {{ priceImpact !== null ? `${formatNumber(priceImpact, 2, 2)}%` : '-' }}
              </p>
            </div>
            <div class="flex justify-between items-center">
              <p class="text-euler-dark-900">
                Routed via
              </p>
              <p class="text-p2 text-right">
                {{ routedVia || '-' }}
              </p>
            </div>
          </VaultFormInfoBlock>

          <div class="flex flex-col gap-8 laptop:col-start-1 laptop:row-start-2">
            <VaultFormSubmit
              :disabled="isSubmitDisabled"
              :loading="isSubmitting"
            >
              Review Swap
            </VaultFormSubmit>
          </div>
        </div>
      </template>
    </VaultForm>
  </div>
</template>
