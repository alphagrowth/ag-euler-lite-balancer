<script setup lang="ts">
import { getVaultPrice, getVaultPriceDisplay, type Vault } from '~/entities/vault'
import { useEulerEntitiesOfVault } from '~/composables/useEulerLabels'
import { getEulerLabelEntityLogo } from '~/entities/euler/labels'

const { vault } = defineProps<{ vault: Vault }>()

const { list } = useVaults()

const product = useEulerProductOfVault(vault.address)
const entities = useEulerEntitiesOfVault(vault)

const collateralCount = computed(() => {
  return list.value.filter(v =>
    v.collateralLTVs.some(ltv => ltv.collateral === vault.address && ltv.borrowLTV > 0n),
  ).length
})

const borrowCount = computed(() => {
  return list.value.filter(v =>
    v.address === vault.address && v.collateralLTVs.some(ltv => ltv.borrowLTV > 0n),
  ).length
})

const priceDisplay = computed(() => {
  const price = getVaultPriceDisplay(1, vault)
  return price.hasPrice ? `$${formatNumber(price.usdValue)}` : price.display
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
        label="Market"
        :value="product.name"
      />
      <VaultOverviewLabelValue label="Risk curator(s)">
        <div
          v-if="entities.length"
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
              class="text-p2 text-content-primary hover:text-accent-600 underline transition-colors"
            >{{ entity.name }}</a>
          </div>
        </div>
        <div v-else>
          -
        </div>
      </VaultOverviewLabelValue>
      <VaultOverviewLabelValue label="Market type">
        <VaultTypeChip
          :vault="vault"
          :type="entities.length ? 'governed' : 'type' in vault ? vault.type as string : ''"
        />
      </VaultOverviewLabelValue>
      <VaultOverviewLabelValue label="Can be borrowed">
        <div class="flex items-center gap-8">
          <div>
            <UiIcon :name="borrowCount ? 'green-tick' : 'red-cross'" />
          </div>
          <span class="text-p2 text-content-primary">
            {{ borrowCount ? `Yes in ${borrowCount} markets` : 'No' }}
          </span>
        </div>
      </VaultOverviewLabelValue>
      <VaultOverviewLabelValue label="Can be used as collateral">
        <div class="flex items-center gap-8">
          <div>
            <UiIcon :name="collateralCount ? 'green-tick' : 'red-cross'" />
          </div>
          <span class="text-p2 text-content-primary">
            {{ collateralCount ? `Yes in ${collateralCount} markets` : 'No' }}
          </span>
        </div>
      </VaultOverviewLabelValue>
    </div>
  </div>
</template>
