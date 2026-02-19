<script setup lang="ts">
import type { SecuritizeVault } from '~/entities/vault'
import { formatAssetValue } from '~/services/pricing/priceProvider'
import { formatCompactUsdValue } from '~/utils/string-utils'
import { nanoToValue } from '~/utils/crypto-utils'

const { vault } = defineProps<{ vault: SecuritizeVault }>()

const isUnverified = computed(() => !vault.verified)
const supplyApy = computed(() => nanoToValue(vault.interestRateInfo.supplyAPY, 25))

const totalSupplyDisplay = ref('-')

watchEffect(async () => {
  const result = await formatAssetValue(vault.totalAssets, vault, 'off-chain')
  totalSupplyDisplay.value = result.hasPrice ? formatCompactUsdValue(result.usdValue) : result.display
})
</script>

<template>
  <NuxtLink
    class="block no-underline text-content-primary bg-surface rounded-12 border border-line-default shadow-card hover:shadow-card-hover hover:border-line-emphasis transition-all"
    :to="`/lend/${vault.address}`"
  >
    <div class="flex pb-12 p-16 border-b border-line-subtle">
      <AssetAvatar
        :asset="vault.asset"
        size="40"
      />
      <div class="flex-grow ml-12">
        <div class="text-content-tertiary text-p3 mb-4 flex items-center gap-8">
          <VaultDisplayName
            :name="vault.name"
            :is-unverified="isUnverified"
          />
          <span class="inline-flex items-center gap-4 rounded-8 px-8 py-2 bg-accent-100 text-accent-600 text-p5">
            <SvgIcon
              name="shield"
              class="!w-14 !h-14"
            />
            Securitize
          </span>
        </div>
        <div class="text-h5 text-content-primary">
          {{ vault.asset.symbol }}
        </div>
      </div>
      <div
        v-if="supplyApy > 0"
        class="flex flex-col items-end"
      >
        <div class="text-content-tertiary text-p3 mb-4 text-right">
          Supply APY
        </div>
        <div class="text-p2 text-accent-600 font-semibold">
          {{ supplyApy.toFixed(2) }}%
        </div>
      </div>
    </div>
    <div class="flex py-12 px-16 pb-12 justify-between">
      <div class="flex-1">
        <div class="text-content-tertiary text-p3 mb-4">Total supply</div>
        <div class="text-p2 text-content-primary">
          {{ totalSupplyDisplay }}
        </div>
      </div>
      <div class="flex-1 flex flex-col items-end">
        <div class="text-content-tertiary text-p3 mb-4">Type</div>
        <div class="text-p2 text-content-primary">
          Collateral only
        </div>
      </div>
    </div>
  </NuxtLink>
</template>
