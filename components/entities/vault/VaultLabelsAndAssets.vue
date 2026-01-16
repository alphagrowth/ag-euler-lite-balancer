<script setup lang="ts">
import { ethers } from 'ethers'
import type { EarnVault, EscrowVault, Vault, VaultAsset } from '~/entities/vault'
import { useEulerProductOfVault } from '~/composables/useEulerLabels'
import { getAssetLogoUrl } from '~/composables/useTokens'

const { vault, assets, size, assetsLabel } = defineProps<{
  vault: Vault | EarnVault | EscrowVault
  assets: VaultAsset[]
  size?: 'large'
  assetsLabel?: string
}>()
const { name } = useEulerProductOfVault(ethers.getAddress(vault.address))

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
        Ungoverned
      </p>
      <p
        v-else
        class="text-euler-dark-900 mb-4"
      >
        {{ name || vault.name }}
      </p>

      <p class="text-p2 font-semibold">
        {{ displayAssetsLabel }}
      </p>
    </div>
  </div>
</template>
