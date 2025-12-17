<script setup lang="ts">
import { ethers } from 'ethers'
import type { EarnVault, Vault, VaultAsset } from '~/entities/vault'
import { useEulerProductOfVault } from '~/composables/useEulerLabels'
import { getAssetLogoUrl } from '~/composables/useTokens'

const { vault, assets, size } = defineProps<{
  vault: Vault | EarnVault
  assets: VaultAsset[]
  size?: 'large'
}>()
const { name } = useEulerProductOfVault(ethers.getAddress(vault.address))

const assetsLabel = computed(() => assets.map(asset => asset.symbol).join('/'))
const avatarSrcs = computed(() => assets.map(asset => getAssetLogoUrl(asset.symbol)))
const avatarLabels = computed(() => assets.map(asset => asset.symbol))
</script>

<template>
  <div
    :class="[$style.VaultLabelsAndAssets, size === 'large' ? 'gap-16' : 'gap-12']"
    class="flex align-center"
  >
    <BaseAvatar
      :class="size === 'large' ? 'icon--46' : 'icon--38'"
      :src="avatarSrcs"
      :label="avatarLabels"
    />

    <div>
      <p class="text-euler-dark-900 mb-4">
        {{ name || vault.name }}
      </p>

      <p class="p2 weight-600">
        {{ assetsLabel }}
      </p>
    </div>
  </div>
</template>

<style module lang="scss">
.VaultLabelsAndAssets {
  //
}
</style>
