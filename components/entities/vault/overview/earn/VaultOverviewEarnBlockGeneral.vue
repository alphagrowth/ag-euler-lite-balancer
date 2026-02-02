<script setup lang="ts">
import type { EarnVault } from '~/entities/vault'
import { getVaultPriceDisplay } from '~/entities/vault'
import { useEulerEntitiesOfEarnVault } from '~/composables/useEulerLabels'
import { getEulerLabelEntityLogo } from '~/entities/euler/labels'

const { vault } = defineProps<{ vault: EarnVault }>()

const { isEarnVaultOwnerVerified } = useVaults()
const entities = useEulerEntitiesOfEarnVault(vault)
const isOwnerVerified = computed(() => isEarnVaultOwnerVerified(vault))

const priceDisplay = computed(() => {
  const price = getVaultPriceDisplay(1, vault)
  return price.hasPrice ? `$${formatNumber(price.usdValue)}` : price.display
})

const feeDisplay = computed(() => {
  return `${compactNumber(nanoToValue(vault.performanceFee, 18) * 100, 2, 2)}%`
})
</script>

<template>
  <div class="bg-surface-secondary rounded-xl flex flex-col gap-24 p-20 shadow-card">
    <p class="text-h3 text-content-primary">
      Overview
    </p>
    <div class="flex flex-col items-start gap-24">
      <VaultOverviewLabelValue
        label="Price"
        :value="priceDisplay"
        />
      <VaultOverviewLabelValue
        label="Performance fee"
        :value="feeDisplay"
      />
      <VaultOverviewLabelValue label="Capital allocator(s)">
        <div
          v-if="entities.length && isOwnerVerified"
          class="flex flex-col gap-16"
        >
          <div
            v-for="(entity, idx) in entities"
            :key="idx"
            class="flex items-center gap-8"
          >
            <BaseAvatar
              :label="entity.name"
              :src="getEulerLabelEntityLogo(entity.logo)"
            />
            <a
              :href="entity.url"
              target="_blank"
              class="text-p2 text-neutral-800 hover:text-accent-600 underline transition-colors"
            >{{ entity.name }}</a>
          </div>
        </div>
        <div
          v-else-if="!isOwnerVerified"
          class="flex gap-8 items-center py-8 px-12 rounded-8 bg-[var(--c-yellow-opaque-200)] text-yellow-700"
        >
          <UiIcon
            class="mr-2 !w-20 !h-20 text-yellow-600"
            name="warning"
          />
          Unknown
        </div>
        <div v-else>
          -
        </div>
      </VaultOverviewLabelValue>
      <VaultOverviewLabelValue label="Vault type">
        <VaultTypeChip
          :vault="vault"
          :type="entities.length ? 'managed' : ''"
      />
      </VaultOverviewLabelValue>
    </div>
  </div>
</template>
