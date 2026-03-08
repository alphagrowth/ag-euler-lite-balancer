<script setup lang="ts">
import { formatUnits } from 'viem'
import { useLoopZap } from '~/composables/useLoopZap'

defineOptions({ name: 'LoopZapPage' })

const {
  pools,
  multiplierOptions,
  selectedPoolId,
  selectedPool,
  selectedMultiplier,
  inputAmount,
  selectedInputToken,
  inputAmountNano,
  debtAmount,
  walletBalance,
  expectedBptFromZap,
  bptReceivedFromZap,
  availableLiquidity,
  isInsufficientLiquidity,
  isInsufficient,
  borrowAmountFormatted,
  totalExposureFormatted,
  phase,
  isQuoting,
  isZapping,
  isMultiplying,
  quoteError,
  isZapReady,
  isMultiplyReady,
  executeZapIn,
  executeMultiply,
  resetState,
} = useLoopZap()

const { isConnected } = useWagmi()

function trimDecimals(raw: string, maxDecimals: number): string {
  const [int, frac] = raw.split('.')
  if (!frac) return int
  const trimmed = frac.slice(0, maxDecimals).replace(/0+$/, '')
  return trimmed ? `${int}.${trimmed}` : int
}

const walletBalanceFormatted = computed(() => {
  const token = selectedInputToken.value
  if (!token || walletBalance.value <= 0n) return '0'
  return trimDecimals(formatUnits(walletBalance.value, token.decimals), 6)
})

const expectedBptFormatted = computed(() => {
  if (expectedBptFromZap.value <= 0n) return '0'
  return trimDecimals(formatUnits(expectedBptFromZap.value, 18), 6)
})

const bptReceivedFormatted = computed(() => {
  if (bptReceivedFromZap.value <= 0n) return '0'
  return trimDecimals(formatUnits(bptReceivedFromZap.value, 18), 6)
})

const availableLiquidityFormatted = computed(() => {
  if (availableLiquidity.value <= 0n) return '0'
  return trimDecimals(formatUnits(availableLiquidity.value, selectedPool.value?.borrowAssetDecimals ?? 18), 6)
})

const setMax = () => {
  const token = selectedInputToken.value
  if (!token || walletBalance.value <= 0n) return
  inputAmount.value = formatUnits(walletBalance.value, token.decimals)
}

const zapButtonLabel = computed(() => {
  if (!isConnected.value) return 'Connect Wallet'
  if (isInsufficient.value) return 'Insufficient Balance'
  if (isInsufficientLiquidity.value) return 'Insufficient Vault Liquidity'
  if (isQuoting.value) return 'Getting Quote...'
  if (isZapping.value) return 'Zapping In...'
  if (quoteError.value) return 'Quote Error'
  if (!inputAmountNano.value || inputAmountNano.value <= 0n) return 'Enter Amount'
  return `Step 1: Zap ${selectedInputToken.value?.symbol} → BPT`
})

const isZapButtonDisabled = computed(() => {
  if (!isConnected.value) return false
  return !isZapReady.value || isZapping.value || isQuoting.value
})

const handleZap = () => {
  if (!isConnected.value) {
    const { open } = useAppKit()
    open()
    return
  }
  executeZapIn()
}
</script>

<template>
  <section class="flex flex-col min-h-[calc(100dvh-178px)]">
    <BasePageHeader
      title="Loop Zap"
      description="Two-step leveraged Balancer positions"
      class="mb-24"
      arrow-right
    />

    <div class="max-w-[520px] w-full mx-auto flex flex-col gap-16">
      <!-- Progress Steps -->
      <div class="flex items-center gap-12 px-4">
        <div
          class="flex items-center gap-6"
          :class="phase === 'input' ? 'text-accent-400' : 'text-green-400'"
        >
          <div
            class="w-24 h-24 rounded-full flex items-center justify-center text-body-xs font-bold border-2"
            :class="phase === 'input' ? 'border-accent-400 bg-accent-400/20' : 'border-green-400 bg-green-400/20'"
          >
            {{ phase === 'input' ? '1' : '✓' }}
          </div>
          <span class="text-body-sm font-medium">Zap In</span>
        </div>
        <div class="flex-1 h-px bg-line-default" />
        <div
          class="flex items-center gap-6"
          :class="phase === 'zapped' ? 'text-accent-400' : phase === 'done' ? 'text-green-400' : 'text-content-quaternary'"
        >
          <div
            class="w-24 h-24 rounded-full flex items-center justify-center text-body-xs font-bold border-2"
            :class="phase === 'zapped' ? 'border-accent-400 bg-accent-400/20' : phase === 'done' ? 'border-green-400 bg-green-400/20' : 'border-line-default'"
          >
            {{ phase === 'done' ? '✓' : '2' }}
          </div>
          <span class="text-body-sm font-medium">Multiply</span>
        </div>
      </div>

      <!-- Phase 1: Input & Zap -->
      <template v-if="phase === 'input'">
        <!-- Pool Selector -->
        <div class="bg-surface-secondary rounded-xl p-24 shadow-card">
          <h3 class="text-body-sm font-medium text-content-tertiary mb-12">
            Select Pool
          </h3>
          <div class="grid grid-cols-2 gap-8">
            <button
              v-for="pool in pools"
              :key="pool.id"
              class="rounded-12 p-12 text-left transition-all border text-body-sm"
              :class="selectedPoolId === pool.id
                ? 'bg-accent-400/20 border-accent-400 text-accent-400'
                : 'bg-surface border-line-default text-content-secondary hover:border-line-emphasis'"
              @click="selectedPoolId = pool.id"
            >
              <div class="font-medium truncate">
                {{ pool.name }}
              </div>
              <div class="text-body-xs mt-4 opacity-70">
                Borrow {{ pool.borrowAssetSymbol }}
              </div>
            </button>
          </div>
        </div>

        <!-- Amount Input -->
        <div class="bg-surface-secondary rounded-xl p-24 shadow-card">
          <div class="flex justify-between items-center mb-8">
            <h3 class="text-body-sm font-medium text-content-tertiary">
              Deposit Amount
            </h3>
            <button
              v-if="walletBalance > 0n"
              class="text-body-xs text-accent-400 hover:text-accent-300 transition-colors"
              @click="setMax"
            >
              Balance: {{ walletBalanceFormatted }} {{ selectedInputToken?.symbol }}
            </button>
          </div>

          <div class="flex items-center gap-8 bg-surface rounded-12 border border-line-default p-12 focus-within:border-accent-400 transition-colors">
            <input
              v-model="inputAmount"
              type="text"
              inputmode="decimal"
              placeholder="0.0"
              class="flex-1 bg-transparent text-content-primary text-h3 outline-none placeholder:text-content-quaternary"
            >
            <div class="px-12 py-6 bg-euler-dark-600 rounded-8 text-body-sm font-medium text-content-secondary shrink-0">
              {{ selectedInputToken?.symbol || '—' }}
            </div>
          </div>

          <div v-if="isInsufficient" class="mt-8 text-body-xs text-red-400">
            Insufficient balance
          </div>
        </div>

        <!-- Leverage Selector -->
        <div class="bg-surface-secondary rounded-xl p-24 shadow-card">
          <h3 class="text-body-sm font-medium text-content-tertiary mb-12">
            Leverage
          </h3>
          <div class="flex gap-8">
            <button
              v-for="m in multiplierOptions"
              :key="m"
              class="flex-1 py-10 rounded-12 text-body-sm font-semibold transition-all border"
              :class="selectedMultiplier === m
                ? 'bg-accent-400 text-euler-dark-900 border-accent-400 shadow-md'
                : 'bg-surface border-line-default text-content-secondary hover:border-line-emphasis'"
              @click="selectedMultiplier = m"
            >
              {{ m }}x
            </button>
          </div>
        </div>

        <!-- Summary -->
        <div v-if="inputAmountNano > 0n" class="bg-surface-secondary rounded-xl p-24 shadow-card">
          <h3 class="text-body-sm font-medium text-content-tertiary mb-12">
            Summary
          </h3>
          <div class="flex flex-col gap-10">
            <div class="flex justify-between text-body-sm">
              <span class="text-content-tertiary">Your Deposit</span>
              <span class="text-content-primary font-medium">{{ inputAmount }} {{ selectedInputToken?.symbol }}</span>
            </div>
            <div class="flex justify-between text-body-sm">
              <span class="text-content-tertiary">Borrow Amount</span>
              <span class="text-content-primary font-medium">{{ borrowAmountFormatted }} {{ selectedPool.borrowAssetSymbol }}</span>
            </div>
            <div class="flex justify-between text-body-sm">
              <span class="text-content-tertiary">Available Liquidity</span>
              <span
                class="font-medium"
                :class="isInsufficientLiquidity ? 'text-red-400' : 'text-content-primary'"
              >{{ availableLiquidityFormatted }} {{ selectedPool.borrowAssetSymbol }}</span>
            </div>
            <div v-if="isInsufficientLiquidity" class="p-10 rounded-8 bg-red-500/10 text-red-400 text-body-xs">
              Borrow amount exceeds available vault liquidity. Reduce your deposit or leverage.
            </div>
            <div class="flex justify-between text-body-sm">
              <span class="text-content-tertiary">Total Exposure</span>
              <span class="text-content-primary font-medium">{{ totalExposureFormatted }} {{ selectedPool.borrowAssetSymbol }}</span>
            </div>
            <div v-if="expectedBptFromZap > 0n" class="flex justify-between text-body-sm">
              <span class="text-content-tertiary">Expected BPT (Zap In)</span>
              <span class="text-content-primary font-medium">~{{ expectedBptFormatted }}</span>
            </div>
            <div class="flex justify-between text-body-sm">
              <span class="text-content-tertiary">Leverage</span>
              <span class="text-accent-400 font-semibold">{{ selectedMultiplier }}x</span>
            </div>
          </div>

          <div v-if="quoteError" class="mt-12 p-10 rounded-8 bg-red-500/10 text-red-400 text-body-xs">
            {{ quoteError }}
          </div>

          <div v-if="isQuoting" class="mt-12 flex items-center gap-8 text-body-xs text-content-tertiary">
            <UiLoader class="!w-14 !h-14" />
            Fetching quote...
          </div>
        </div>

        <!-- Zap In Button -->
        <button
          class="w-full py-16 rounded-12 text-body-md font-semibold transition-all"
          :class="isZapButtonDisabled
            ? 'bg-euler-dark-600 text-content-quaternary cursor-not-allowed'
            : 'bg-accent-400 text-euler-dark-900 hover:bg-accent-300 shadow-lg hover:shadow-xl'"
          :disabled="isZapButtonDisabled"
          @click="handleZap"
        >
          <span v-if="isZapping" class="flex items-center justify-center gap-8">
            <UiLoader class="!w-16 !h-16" />
            Zapping In...
          </span>
          <span v-else>{{ zapButtonLabel }}</span>
        </button>
      </template>

      <!-- Phase 2: Multiply -->
      <template v-if="phase === 'zapped'">
        <div class="bg-surface-secondary rounded-xl p-24 shadow-card">
          <div class="flex items-center gap-8 mb-16">
            <div class="w-32 h-32 rounded-full bg-green-400/20 flex items-center justify-center text-green-400 text-body-sm font-bold">
              ✓
            </div>
            <div>
              <div class="text-body-sm font-medium text-content-primary">
                Zap In Complete
              </div>
              <div class="text-body-xs text-content-tertiary">
                {{ bptReceivedFormatted }} BPT received
              </div>
            </div>
          </div>

          <div class="flex flex-col gap-10 border-t border-line-default pt-16">
            <div class="flex justify-between text-body-sm">
              <span class="text-content-tertiary">BPT to Deposit</span>
              <span class="text-content-primary font-medium">{{ bptReceivedFormatted }}</span>
            </div>
            <div class="flex justify-between text-body-sm">
              <span class="text-content-tertiary">Borrow Amount</span>
              <span class="text-content-primary font-medium">{{ borrowAmountFormatted }} {{ selectedPool.borrowAssetSymbol }}</span>
            </div>
            <div class="flex justify-between text-body-sm">
              <span class="text-content-tertiary">Leverage</span>
              <span class="text-accent-400 font-semibold">{{ selectedMultiplier }}x</span>
            </div>
          </div>
        </div>

        <button
          class="w-full py-16 rounded-12 text-body-md font-semibold transition-all"
          :class="!isMultiplyReady || isMultiplying
            ? 'bg-euler-dark-600 text-content-quaternary cursor-not-allowed'
            : 'bg-accent-400 text-euler-dark-900 hover:bg-accent-300 shadow-lg hover:shadow-xl'"
          :disabled="!isMultiplyReady || isMultiplying"
          @click="executeMultiply"
        >
          <span v-if="isMultiplying" class="flex items-center justify-center gap-8">
            <UiLoader class="!w-16 !h-16" />
            Opening Position...
          </span>
          <span v-else-if="!isMultiplyReady">Preparing Multiply...</span>
          <span v-else>Step 2: Open {{ selectedMultiplier }}x Position</span>
        </button>

        <button
          class="w-full py-10 text-body-sm text-content-tertiary hover:text-content-secondary transition-colors"
          @click="resetState"
        >
          Cancel &amp; Start Over
        </button>
      </template>
    </div>
  </section>
</template>
