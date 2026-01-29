<script setup lang="ts">
import { ethers } from 'ethers'
import type { EarnVault, EscrowVault, Vault, VaultAsset } from '~/entities/vault'
import { useEulerProductOfVault, useEulerVaultLabelOfVault } from '~/composables/useEulerLabels'
import { getAssetLogoUrl } from '~/composables/useTokens'

const { vault, assets, size, assetsLabel, pairVault } = defineProps<{
  vault: Vault | EarnVault | EscrowVault
  assets: VaultAsset[]
  size?: 'large'
  assetsLabel?: string
  pairVault?: Vault
}>()
const vaultAddress = computed(() => ethers.getAddress(vault.address))
const product = useEulerProductOfVault(vaultAddress)
const vaultLabel = useEulerVaultLabelOfVault(vaultAddress)
const displayName = computed(() => vaultLabel.name || product.name || vault.name)

const pairVaultAddress = computed(() => pairVault ? ethers.getAddress(pairVault.address) : '')
const pairProduct = useEulerProductOfVault(pairVaultAddress)

const getVaultLabel = (v: Vault | EarnVault | EscrowVault) => {
  if ('type' in v && v.type === 'escrow') {
    return 'Ungoverned'
  }
  const addr = ethers.getAddress(v.address)
  if (addr === vaultAddress.value) {
    return product.name || vault.name
  }
  return pairProduct.name || v.name
}

const displayLabel = computed(() => {
  const collateralLabel = getVaultLabel(vault)

  if (!pairVault) {
    return collateralLabel
  }

  const borrowLabel = getVaultLabel(pairVault)

  if (collateralLabel === borrowLabel) {
    return collateralLabel
  }

  return `${collateralLabel} / ${borrowLabel}`
})

const displayAssetsLabel = computed(() => assetsLabel || assets.map(asset => asset.symbol).join('/'))
const avatarSrcs = computed(() => assets.map(asset => getAssetLogoUrl(asset.symbol)))
const avatarLabels = computed(() => assets.map(asset => asset.symbol))
</script>

<template>
  <div
    :class="[size === 'large' ? 'gap-16' : 'gap-12']"
    class="flex items-center"
  >
    <BaseAvatar
      :class="size === 'large' ? 'icon--46' : 'icon--38'"
      :src="avatarSrcs"
      :label="avatarLabels"
    />

    <div>
      <p
        v-if="'verified' in vault && !vault.verified"
        class="flex text-yellow-600 mb-4 items-center gap-4"
      >
        <SvgIcon
          name="warning"
          class="!w-20 !h-20"
        />
        Unknown vault
      </p>
      <p
        v-else-if="'type' in vault && vault.type === 'escrow'"
        class="text-euler-dark-900 mb-4"
      >
        {{ displayLabel }}
      </p>
      <p
        v-else
        class="text-euler-dark-900 mb-4"
      >
        {{ displayName }}
      </p>

      <p class="text-p2 font-semibold">
        {{ displayAssetsLabel }}
      </p>
    </div>
  </div>
</template>
