<script setup lang="ts">
import { ethers } from 'ethers'
import { getVaultPrice, type Vault, type VaultAsset, type CollateralOption, type EarnVault, getEarnVaultPrice } from '~/entities/vault'
import { getAssetLogoUrl } from '~/composables/useTokens'
import { ChooseCollateralModal } from '#components'
import { useModal } from '~/components/ui/composables/useModal'

const { label, desc, maxable, vault, asset, balance = 0n, balanceLoading = false, collateralOptions = [], readonly = false, priceOverride } = defineProps<{
  label?: string
  desc?: string
  maxable?: boolean
  vault?: Vault | EarnVault
  asset: VaultAsset
  balance?: bigint
  balanceLoading?: boolean
  collateralOptions?: CollateralOption[]
  readonly?: boolean
  priceOverride?: number // For vaults without standard price info (e.g., securitize)
}>()
const emits = defineEmits(['input', 'change-collateral'])
const model = defineModel<string>({ default: '' })

const inputEl = useTemplateRef<HTMLInputElement>('inputEl')
const modal = useModal()
const isFocused = ref(false)

const selectedIdx = ref(0)
const friendlyBalance = computed(() => nanoToValue(balance, asset?.decimals || 18))
const price = computed(() => {
  // Use priceOverride if provided (for securitize vaults etc.)
  if (priceOverride !== undefined) {
    return priceOverride * (+model.value || 0)
  }

  if (!vault) {
    return 0
  }

  if ('type' in vault && vault.type === 'earn') {
    return getEarnVaultPrice(+model.value || 0, vault)
  }
  else {
    return getVaultPrice(+model.value || 0, vault as Vault)
  }
})

const hasPrice = computed(() => vault !== undefined || priceOverride !== undefined)
const setMax = () => {
  model.value = ethers.formatUnits(balance, Number(asset.decimals))
  emits('input')
  if (inputEl.value) {
    inputEl.value.value = model.value || ''
  }
}
const onInput = (e: InputEvent) => {
  if (readonly || e.data === '-') {
    (e.target as HTMLInputElement).value = String(model.value ?? '')
    return
  }
  let value = (e.target as HTMLInputElement).value
  value = value.replace(',', '.')
  if (isNaN(Number(value)) && Boolean(value)) {
    (e.target as HTMLInputElement).value = String(model.value)
  }
  else {
    model.value = value
  }
  emits('input', e)
}
const openChooseCollateralModal = () => {
  if (collateralOptions?.length < 2) {
    return
  }
  modal.open(ChooseCollateralModal, {
    props: {
      productName: desc,
      symbol: asset.symbol,
      collateralOptions: collateralOptions,
      selected: selectedIdx.value,
      onSave: (selectedIndex: number) => {
        selectedIdx.value = selectedIndex
        emits('change-collateral', selectedIndex)
        modal.close()
      },
    },
  })
}
</script>

<template>
  <div
    class="flex flex-col gap-12 p-16 bg-euler-dark-100 rounded-16"
    :class="[isFocused ? 'shadow-[0_0_0_1px_hsl(var(--aquamarine-700))]' : '']"
  >
    <div
      v-if="label || desc"
      class="flex justify-between text-euler-dark-800"
    >
      <p>
        {{ label }}
      </p>

      <p>
        {{ desc }}
      </p>
    </div>
    <div
      class="flex items-center gap-12"
    >
      <input
        ref="inputEl"
        v-text-fit
        :value="model"
        class="text-h1 text-euler-dark-1000 w-full h-40 outline-none placeholder:text-euler-dark-800"
        type="text"
        placeholder="0.00"
        maxlength="24"
        autocomplete="off"
        step="0.1"
        :readonly="readonly"
        :inputmode="readonly ? 'none' : 'decimal'"
        @focus="isFocused = true"
        @blur="isFocused = false"
        @input="onInput"
      >

      <div
        class="bg-euler-dark-500 text-p3 font-semibold gap-8 flex items-center justify-center px-12 h-36 rounded-[40px] whitespace-nowrap cursor-pointer"
        @click="openChooseCollateralModal"
      >
        <BaseAvatar
          :src="getAssetLogoUrl(asset.symbol)"
          :label="asset.symbol"
          class="icon--20"
        />
        {{ asset.symbol }}
        <SvgIcon
          v-if="collateralOptions.length > 1"
          class="text-euler-dark-800 !w-16 !h-16"
          name="arrow-down"
        />
      </div>
    </div>
    <div
      class="flex"
      :class="hasPrice ? 'justify-between' : 'justify-end'"
    >
      <p
        v-if="hasPrice"
        class="text-euler-dark-800"
      >
        <template v-if="price > 10 ** 18">
          A lot
        </template>
        <template v-else>
          ${{ compactNumber(price, 2) }}
        </template>
      </p>

      <BaseLoadableContent
        v-if="maxable"
        :loading="balanceLoading"
      >
        <p @click="setMax">
          <span class="text-euler-dark-800">{{ formatNumber(friendlyBalance) }} {{ asset.symbol }}</span> <span
            class="text-aquamarine-700 font-semibold px-4 cursor-pointer select-none text-[12px] leading-[16px]"
          >Max</span> <!-- TODO: button -->
        </p>
      </BaseLoadableContent>
    </div>
  </div>
</template>
