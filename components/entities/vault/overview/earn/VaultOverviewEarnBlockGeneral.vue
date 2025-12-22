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
  <div class="bg-euler-dark-300 br-16 column gap-24 p-24">
    <p class="h3 text-white">
      Overview
    </p>
    <div class="column align-start gap-24">
      <VaultOverviewLabelValue label="Vault status">
        <VaultTypeChip
          :vault="vault"
          :type="entities.length ? 'managed' : ''"
        />
      </VaultOverviewLabelValue>
      <VaultOverviewLabelValue label="Capital allocator">
        <div class="column gap-16">
          <div
            v-for="(entity, idx) in entities"
            :key="idx"
            class="flex align-center gap-8"
          >
            <BaseAvatar
              :label="entity.name"
              :src="getEulerLabelEntityLogo(entity.logo)"
            />
            <a
              :href="entity.url"
              target="_blank"
              class="p2 text-white underline"
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
