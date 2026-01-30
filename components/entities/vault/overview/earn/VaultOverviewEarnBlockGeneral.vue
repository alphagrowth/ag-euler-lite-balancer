<script setup lang="ts">
import type { EarnVault } from '~/entities/vault'
import { useEulerEntitiesOfEarnVault } from '~/composables/useEulerLabels'
import { getEulerLabelEntityLogo } from '~/entities/euler/labels'

const { vault } = defineProps<{ vault: EarnVault }>()

const entities = useEulerEntitiesOfEarnVault(vault)

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
      <VaultOverviewLabelValue label="Vault status">
        <VaultTypeChip
          :vault="vault"
          :type="entities.length ? 'managed' : ''"
        />
      </VaultOverviewLabelValue>
      <VaultOverviewLabelValue label="Capital allocator">
        <div class="flex flex-col gap-16">
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
      </VaultOverviewLabelValue>
      <VaultOverviewLabelValue
        label="Perfomance fee"
        :value="feeDisplay"
      />
    </div>
  </div>
</template>
