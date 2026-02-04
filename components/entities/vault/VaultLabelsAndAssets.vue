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

const isVaultDeprecated = computed(() => {
  const addr = vaultAddress.value
  return product.deprecatedVaults?.includes(addr) ?? false
})
const isPairVaultDeprecated = computed(() => {
  if (!pairVault) return false
  const addr = pairVaultAddress.value
  return pairProduct.deprecatedVaults?.includes(addr) ?? false
})
const isDeprecated = computed(() => isVaultDeprecated.value || isPairVaultDeprecated.value)
const deprecationReason = computed(() => {
  if (isVaultDeprecated.value && product.deprecationReason) {
    return product.deprecationReason
  }
  if (isPairVaultDeprecated.value && pairProduct.deprecationReason) {
    return pairProduct.deprecationReason
  }
  return ''
})

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
          :is-unverified="('verified' in vault && !vault.verified) || !!(pairVault && 'verified' in pairVault && !pairVault.verified)"
        />
      </p>
      <p v-if="isDeprecated" class="mb-4">
        <span
          class="inline-flex items-center gap-6 rounded-8 px-10 py-4 bg-[var(--c-red-opaque-200)] text-red-700 text-p4 max-w-[520px]"
          :title="deprecationReason || 'This vault has been deprecated.'"
        >
          <SvgIcon name="warning" class="!w-16 !h-16" />
          <span class="truncate">
            Deprecated<span v-if="deprecationReason">: {{ deprecationReason }}</span>
          </span>
        </span>
      </p>

      <p class="text-p2 font-semibold text-content-primary">
        {{ displayAssetsLabel }}
      </p>
    </div>
  </div>
</template>
