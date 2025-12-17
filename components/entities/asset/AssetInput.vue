<script setup lang="ts">
import { ethers } from 'ethers'
import { getVaultPrice, type Vault, type VaultAsset, type CollateralOption, type EarnVault, getEarnVaultPrice } from '~/entities/vault'
import { getAssetLogoUrl } from '~/entities/assets'
import { ChooseCollateralModal } from '#components'
import { useModal } from '~/components/ui/composables/useModal'

const { label, desc, maxable, vault, asset, balance = 0n, balanceLoading = false, collateralOptions = [] } = defineProps<{
  label?: string
  desc?: string
  maxable?: boolean
  vault?: Vault | EarnVault
  asset: VaultAsset
  balance?: bigint
  balanceLoading?: boolean
  collateralOptions?: CollateralOption[]
}>()
const emits = defineEmits(['input', 'change-collateral'])
const model = defineModel<string>({ default: '' })

const inputEl = useTemplateRef<HTMLInputElement>('inputEl')
const styles = useCssModule()
const modal = useModal()
const isFocused = ref(false)

const selectedIdx = ref(0)

const classes = computed(() => ({
  [styles._focused]: isFocused.value,
}))
const friendlyBalance = computed(() => nanoToValue(balance, asset?.decimals || 18))
const price = computed(() => {
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
const setMax = () => {
  model.value = ethers.formatUnits(balance, Number(asset.decimals))
  emits('input')
  if (inputEl.value) {
    inputEl.value.value = model.value || ''
  }
}
const onInput = (e: Event) => {
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
      onSave: (isSaving: boolean) => {
        selectedIdx.value = isSaving ? 1 : 0
        emits('change-collateral', isSaving)
        modal.close()
      },
    },
  })
}
</script>

<template>
  <div
    :class="[$style.AssetInput, classes]"
    class="column gap-12 p-16 bg-euler-dark-100 br-16"
  >
    <div
      v-if="label || desc"
      :class="$style.top"
      class="between text-euler-dark-800"
    >
      <p>
        {{ label }}
      </p>

      <p>
        {{ desc }}
      </p>
    </div>
    <div
      :class="$style.center"
      class="flex align-center gap-12"
    >
      <input
        ref="inputEl"
        v-text-fit
        :value="model"
        :class="$style.input"
        class="h1 text-euler-dark-1000"
        type="text"
        placeholder="0.00"
        maxlength="24"
        autocomplete="off"
        step="0.1"
        inputmode="decimal"
        @focus="isFocused = true"
        @blur="isFocused = false"
        @input="onInput"
      >

      <div
        :class="$style.assetChip"
        class="bg-euler-dark-500 p3 weight-600 gap-8 align-center justify-center px-12"
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
          class="text-euler-dark-800 icon--16"
          name="arrow-down"
        />
      </div>
    </div>
    <div
      :class="$style.bottom"
      class="between"
    >
      <p
        v-if="vault"
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
            class="text-aquamarine-700 weight-600 px-4"
            :class="$style.max"
          >Max</span> <!-- TODO: button -->
        </p>
      </BaseLoadableContent>
    </div>
  </div>
</template>

<style module lang="scss">
.AssetInput {
  &._focused {
    box-shadow: 0 0 0 1px var(--c-aquamarine-700);
  }
}

.input {
  width: 100%;
  height: 40px;
  outline: none;

  &::placeholder {
    color: rgb(var(--euler-dark-800));
  }
}

.assetChip {
  height: 36px;
  border-radius: 40px;
  white-space: nowrap;
  cursor: pointer;
}

.max {
  cursor: pointer;
  user-select: none;
  font-size: 12px;
  line-height: 16px;
}
</style>
