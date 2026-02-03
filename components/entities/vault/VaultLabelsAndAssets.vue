<script setup lang="ts">
import { ethers } from 'ethers'
import type { EarnVault, SecuritizeVault, Vault, VaultAsset } from '~/entities/vault'
import { useEulerProductOfVault } from '~/composables/useEulerLabels'
import { getAssetLogoUrl } from '~/composables/useTokens'

const { vault, assets, size, assetsLabel, pairVault } = defineProps<{
  vault: Vault | EarnVault | SecuritizeVault
  assets: VaultAsset[]
  size?: 'large'
  assetsLabel?: string
  pairVault?: Vault
}>()
const vaultAddress = computed(() => ethers.getAddress(vault.address))
const product = useEulerProductOfVault(vaultAddress)
const displayName = computed(() => {
  if ('vaultCategory' in vault && vault.vaultCategory === 'escrow') {
    return 'Escrowed collateral'
  }
  return product.name || vault.name
})

const pairVaultAddress = computed(() => pairVault ? ethers.getAddress(pairVault.address) : '')
const pairProduct = useEulerProductOfVault(pairVaultAddress)

const getVaultLabel = (v: Vault | EarnVault | SecuritizeVault) => {
  if ('vaultCategory' in v && v.vaultCategory === 'escrow') {
    return 'Escrowed collateral'
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
      <p class="text-content-tertiary mb-4">
        <VaultDisplayName
          :name="pairVault ? displayLabel : displayName"
          :is-unverified="('verified' in vault && !vault.verified) || (pairVault && 'verified' in pairVault && !pairVault.verified)"
        />
      </p>

      <p class="text-p2 font-semibold text-content-primary">
        {{ displayAssetsLabel }}
      </p>
    </div>
  </div>
</template>
