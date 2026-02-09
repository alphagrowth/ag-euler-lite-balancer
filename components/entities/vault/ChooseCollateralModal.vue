<script setup lang="ts">
import { getAssetLogoUrl } from '~/composables/useTokens'
import type { CollateralOption } from '~/entities/vault'

const emits = defineEmits(['close'])
const { productName, symbol, collateralOptions, selected = 0, onSave } = defineProps<{
  productName: string
  symbol: string
  collateralOptions: CollateralOption[]
  selected?: number
  onSave: any
}>()

const selectedIdx = ref(selected)
const getOptionLabel = (option: CollateralOption) => option.label || productName
const getOptionSymbol = (option: CollateralOption) => option.symbol || symbol

const handleClose = () => {
  emits('close')
}
</script>

<template>
  <BaseModalWrapper
    title="Select collateral"
    @close="handleClose"
  >
    <div
      v-for="(option, idx) in collateralOptions"
      :key="`options-${idx}`"
      class="flex items-center py-12 px-16 cursor-pointer rounded-16"
      :class="[selectedIdx === idx ? 'bg-euler-dark-600' : '']"
      @click="
        selectedIdx = idx;onSave(idx)
      "
    >
      <BaseAvatar
        :src="getAssetLogoUrl(getOptionSymbol(option))"
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
  </BaseModalWrapper>
</template>
