<script setup lang="ts">
import { formatNumber } from '~/utils/string-utils'

const emits = defineEmits(['close'])
const {
  maxRoe,
  maxMultiplier,
  supplyAPY,
  borrowAPY,
  borrowLTV,
} = defineProps<{
  maxRoe: number
  maxMultiplier: number
  supplyAPY: number
  borrowAPY: number
  borrowLTV: number
  isBestInMarket?: boolean
}>()

const handleClose = () => {
  emits('close')
}
</script>

<template>
  <BaseModalWrapper
    :title="isBestInMarket ? 'Best Max ROE' : 'Max ROE'"
    @close="handleClose"
  >
    <p class="text-euler-dark-900 text-p3 mb-16">
      ROE (Return on Equity) estimates the annualized return on your own capital in a multiplied position. A positive ROE means the supply yield exceeds borrowing costs at the given multiplier. A negative ROE means the position is gradually losing value to interest costs.
      <template v-if="isBestInMarket">
        The value shown is the best max ROE out of all possible collateral/borrow pairs in this market.
      </template>
    </p>
    <div class="mb-24">
      <div class="pb-16 mb-16 border-b border-euler-dark-600">
        <div class="flex justify-between items-center mb-16">
          <div>
            <p class="mb-4">
              Max LTV
            </p>
            <p class="text-euler-dark-900">
              Maximum loan-to-value ratio
            </p>
          </div>
          <div class="text-h5">
            {{ formatNumber(borrowLTV, 2) }}%
          </div>
        </div>
        <div class="flex justify-between items-center mb-16">
          <div>
            <p class="mb-4">
              Max multiplier
            </p>
            <p class="text-euler-dark-900">
              Max multiplier at max LTV
            </p>
          </div>
          <div class="text-h5">
            {{ formatNumber(maxMultiplier, 2, 2) }}x
          </div>
        </div>
        <div class="flex justify-between items-center mb-16">
          <div>
            <p class="mb-4">
              Supply APY
            </p>
            <p class="text-euler-dark-900">
              Collateral yield (S)
            </p>
          </div>
          <div class="text-h5">
            {{ formatNumber(supplyAPY) }}%
          </div>
        </div>
        <div class="flex justify-between items-center">
          <div>
            <p class="mb-4">
              Borrow APY
            </p>
            <p class="text-euler-dark-900">
              Borrowing cost (B)
            </p>
          </div>
          <div class="text-h5">
            {{ formatNumber(borrowAPY) }}%
          </div>
        </div>
      </div>
      <div class="flex justify-between items-center mb-16">
        <div>
          <p class="mb-4">
            Formula
          </p>
          <p class="text-euler-dark-900">
            M &times; S - (M - 1) &times; B = ROE
          </p>
        </div>
      </div>
    </div>
    <div class="bg-euler-dark-600 rounded-12 p-16 flex justify-between items-center mb-16">
      <div>
        <p>Max ROE</p>
        <p class="text-euler-dark-900 text-p3">
          Maximum return on equity at max multiplier
        </p>
      </div>
      <p
        class="text-h4"
        :class="[maxRoe >= 0 ? 'text-accent-600' : 'text-error-500']"
      >
        = {{ formatNumber(maxRoe) }}%
      </p>
    </div>
  </BaseModalWrapper>
</template>
