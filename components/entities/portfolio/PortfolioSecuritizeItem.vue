<script setup lang="ts">
import { getAssetLogoUrl } from '~/composables/useTokens'
import type { AccountSecuritizePosition } from '~/entities/account'

const { position } = defineProps<{ position: AccountSecuritizePosition }>()

const vault = computed(() => position.vault)
const displayName = computed(() => vault.value.name || 'Securitize Vault')

// Calculate asset value (for now just show the amount, no USD conversion for securitize vaults)
const assetAmount = computed(() => {
  return nanoToValue(position.assets, vault.value.asset.decimals)
})
</script>

<template>
  <div
    class="block no-underline text-white bg-euler-dark-500 rounded-16"
  >
    <div class="flex py-16 px-16 pb-12 border-b border-border-primary">
      <div
        class="flex w-full"
      >
        <BaseAvatar
          class="icon--40"
          :src="getAssetLogoUrl(vault.asset.symbol)"
          :label="vault.asset.symbol"
        />
        <div class="flex-grow ml-12">
          <div class="text-euler-dark-900 text-p3 mb-4">
            {{ displayName }}
          </div>
          <div class="text-h5">
            {{ vault.asset.symbol }}
          </div>
        </div>
        <div class="flex flex-col items-end">
          <div class="text-euler-dark-900 text-p3 mb-4">
            Type
          </div>
          <div class="text-p2 text-aquamarine-700">
            Securitize
          </div>
        </div>
      </div>
    </div>
    <div class="flex py-12 px-16 pb-16">
      <div
        class="flex flex-col gap-12 w-full"
      >
        <div class="flex justify-between">
          <div class="text-euler-dark-900 text-p3">
            Supply value
          </div>
          <div class="flex justify-between gap-8 text-right">
            <div class="text-white text-p3">
              {{ formatNumber(assetAmount) }} {{ vault.asset.symbol }}
            </div>
          </div>
        </div>
        <div class="flex justify-between">
          <div class="text-euler-dark-900 text-p3">
            Shares
          </div>
          <div class="flex justify-between gap-8 text-right">
            <div class="text-white text-p3">
              {{ formatNumber(nanoToValue(position.shares, vault.decimals)) }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
