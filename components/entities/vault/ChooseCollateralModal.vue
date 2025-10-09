<script setup lang="ts">
import { getAssetLogoUrl } from '~/entities/assets'
import { type CollateralOption } from '~/entities/vault'

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
      :class="[$style.row, selectedIdx === idx ? $style._selected : null]"
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
        <div class="h5 align-center">
          {{ symbol }}
          <div
            v-if="option.type === 'wallet'"
            :class="$style.wallet"
          >
            Wallet
          </div>
          <div
            v-else
            :class="$style.saving"
          >
            Saving
          </div>
        </div>
      </div>
      <div class="right">
        <div class="h5">
          ${{ compactNumber(option.price, 2) }}
        </div>
        <div class="text-euler-dark-900">
          {{ option.amount }} {{ symbol }}
        </div>
      </div>
    </div>
    <UiButton
      :class="$style.btn"
      size="large"
      type="submit"
      @click="onSave(selectedIdx !== 0)"
    >
      Save Changes
    </UiButton>
  </BaseModalWrapper>
</template>

<style lang="scss" module>
.row {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  cursor: pointer;
  border-radius: 16px;

  &._selected {
    background-color: var(--c-euler-dark-600);
  }
}

.saving {
  margin-left: 6px;
  font-size: 12px;
  line-height: 16px;
  padding: 4px 8px;
  border-radius: 8px;
  background-color: #CBC0951A;
  color: var(--c-yellow-600);
}

.wallet {
  margin-left: 6px;
  font-size: 12px;
  line-height: 16px;
  padding: 4px 8px;
  border-radius: 8px;
  background-color: #A1F4E01A;
  color: var(--c-aquamarine-600);
}

.btn {
  width: 100%;
  margin-top: 12px;
}
</style>
