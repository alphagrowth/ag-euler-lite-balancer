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

const handleClose = () => {
  emits('close')
}
</script>

<template>
  <BaseModalWrapper
    title="Accepted collateral"
    @close="handleClose"
  >
    <div
      v-for="(option, idx) in collateralOptions"
      :key="`options-${idx}`"
      class="flex items-center py-12 px-16 cursor-pointer rounded-16"
      :class="[selectedIdx === idx ? 'bg-euler-dark-600' : '']"
      @click="selectedIdx = idx"
    >
      <BaseAvatar
        :src="getAssetLogoUrl(symbol)"
        class="icon--36 mr-10"
      />
      <div class="grow-1">
        <div class="text-euler-dark-900 mb-2">
          {{ productName }}
        </div>
        <div class="text-h5 flex items-center">
          {{ symbol }}
          <div
            v-if="option.type === 'wallet'"
            class="ml-6 text-[12px] leading-[16px] py-4 px-8 rounded-8 bg-[#A1F4E01A] text-aquamarine-600"
          >
            Wallet
          </div>
          <div
            v-else
            class="ml-6 text-[12px] leading-[16px] py-4 px-8 rounded-8 bg-[#CBC0951A] text-yellow-600"
          >
            Saving
          </div>
        </div>
      </div>
      <div class="text-right">
        <div class="text-h5">
          ${{ compactNumber(option.price, 2) }}
        </div>
        <div class="text-euler-dark-900">
          {{ option.amount }} {{ symbol }}
        </div>
      </div>
    </div>
    <UiButton
      class="w-full mt-12"
      size="large"
      type="submit"
      @click="onSave(selectedIdx !== 0)"
    >
      Save Changes
    </UiButton>
  </BaseModalWrapper>
</template>
