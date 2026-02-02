<script setup lang="ts">
import { ethers } from 'ethers'
import { getVaultPrice, getVaultPriceDisplay, type Vault } from '~/entities/vault'
import { useEulerEntitiesOfVault } from '~/composables/useEulerLabels'
import { getEulerLabelEntityLogo } from '~/entities/euler/labels'

const { vault } = defineProps<{ vault: Vault }>()

const { borrowList, isVaultGovernorVerified } = useVaults()

const product = useEulerProductOfVault(vault.address)
const entities = useEulerEntitiesOfVault(vault)
const isGovernorVerified = computed(() => isVaultGovernorVerified(vault))

// Count how many borrow pairs have this vault as collateral
const collateralCount = computed(() => {
  return borrowList.value.filter(pair => pair.collateral.address === vault.address).length
})

// Count how many borrow pairs have this vault as the liability (borrow) side
const borrowCount = computed(() => {
  return vault.collateralLTVs.filter(ltv => ltv.borrowLTV > 0n).length
})

const priceDisplay = computed(() => {
  const price = getVaultPriceDisplay(1, vault)
  return price.hasPrice ? `$${formatNumber(price.usdValue)}` : price.display
})

const vaultGovernanceType = computed(() => {
  // Escrow vault
  if ('type' in vault && vault.type === 'escrow') {
    return 'escrow'
  }
  // Has matching entity → governed
  if (entities.value.length) {
    return 'governed'
  }
  // Zero governorAdmin → ungoverned
  if (!vault.governorAdmin || vault.governorAdmin === ethers.ZeroAddress) {
    return 'ungoverned'
  }
  // Non-zero but no matching entity → unknown
  return 'unknown'
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
      <VaultOverviewLabelValue label="Risk manager(s)">
        <div
          v-if="entities.length && isGovernorVerified"
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
        <div
          v-else-if="!isGovernorVerified"
          class="flex gap-8 items-center py-8 px-12 rounded-8 bg-warning-100 text-warning-500"
        >
          <UiIcon
            class="mr-2 !w-20 !h-20"
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
          :type="vaultGovernanceType"
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
