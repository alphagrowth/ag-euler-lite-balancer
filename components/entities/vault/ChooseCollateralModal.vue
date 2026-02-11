<script setup lang="ts">
import { getAssetLogoUrl } from '~/composables/useTokens'
import type { CollateralOption } from '~/entities/vault'
import { formatNumber } from '~/utils/string-utils'

const emits = defineEmits(['close'])
const { productName, symbol, collateralOptions, selected = 0, onSave } = defineProps<{
  productName: string
  symbol: string
  collateralOptions: CollateralOption[]
  selected?: number
  onSave: any
}>()

const searchQuery = ref('')
const selectedIdx = ref(selected)
const getOptionLabel = (option: CollateralOption) => option.label || productName
const getOptionSymbol = (option: CollateralOption) => option.symbol || symbol

const filteredOptions = computed(() => {
  if (!searchQuery.value) return collateralOptions.map((option, idx) => ({ option, idx }))
  const q = searchQuery.value.toLowerCase()
  return collateralOptions
    .map((option, idx) => ({ option, idx }))
    .filter(({ option }) =>
      getOptionSymbol(option).toLowerCase().includes(q)
      || getOptionLabel(option).toLowerCase().includes(q),
    )
})

const handleClose = () => {
  emits('close')
}
</script>

<template>
  <BaseModalWrapper
    title="Select collateral"
    full
    @close="handleClose"
  >
    <div class="px-16 pb-12">
      <input
        v-model="searchQuery"
        type="text"
        placeholder="Search by name or symbol"
        class="w-full px-12 py-10 rounded-12 border border-line-default bg-surface text-p2 text-content-primary placeholder:text-content-muted outline-none focus:border-accent-500 transition-colors"
      >
    </div>
    <div class="flex-1 overflow-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div
        v-for="{ option, idx } in filteredOptions"
        :key="`options-${idx}`"
        class="flex items-center py-12 px-16 rounded-16"
        :class="[
          option.disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
          selectedIdx === idx && !option.disabled ? 'bg-euler-dark-600' : '',
        ]"
        @click="
          if (!option.disabled) { selectedIdx = idx;onSave(idx) }
        "
      >
        <BaseAvatar
          :src="getAssetLogoUrl(option.assetAddress || '', getOptionSymbol(option))"
          :label="getOptionSymbol(option)"
          class="icon--36 mr-10"
        />
        <div class="flex-grow">
          <div class="text-euler-dark-900 mb-2">
            {{ getOptionLabel(option) }}
          </div>
          <div class="text-h5 flex items-center">
            {{ getOptionSymbol(option) }}
            <div
              v-if="option.type === 'wallet'"
              class="ml-6 text-[12px] leading-[16px] py-4 px-8 rounded-8 bg-[#A1F4E01A] text-aquamarine-600"
            >
              Wallet
            </div>
            <div
              v-else-if="option.type === 'saving'"
              class="ml-6 text-[12px] leading-[16px] py-4 px-8 rounded-8 bg-[#CBC0951A] text-yellow-600"
            >
              Savings
            </div>
            <div
              v-else-if="option.type === 'escrow'"
              class="ml-6 text-[12px] leading-[16px] py-4 px-8 rounded-8 bg-[var(--c-aquamarine-opaque-200)] text-aquamarine-600"
            >
              Escrowed collateral
            </div>
            <span
              v-for="tag in (option.tags || [])"
              :key="tag"
              class="ml-6 inline-flex items-center gap-4 rounded-8 px-8 py-2 bg-warning-100 text-warning-500 text-p5"
            >
              <SvgIcon name="warning" class="!w-14 !h-14" />
              {{ tag }}
            </span>
          </div>
        </div>
        <div class="text-right grow-1">
          <div class="text-euler-dark-900 mb-2">
            APY
          </div>
          <div class="text-h5">
            {{ option.apy !== undefined ? `${formatNumber(option.apy)}%` : '-' }}
          </div>
        </div>
      </div>
      <div
        v-if="!filteredOptions.length && searchQuery"
        class="py-24 text-center text-content-tertiary text-p3"
      >
        No results found
      </div>
    </div>
  </BaseModalWrapper>
</template>
