<script setup lang="ts">
import { getVaultPrice, type Vault } from '~/entities/vault'
import { useEulerEntitiesOfVault } from '~/composables/useEulerLabels'
import { getEulerLabelEntityLogo } from '~/entities/euler/labels'

const { vault } = defineProps<{ vault: Vault }>()

const { borrowList } = useVaults()

const product = useEulerProductOfVault(vault.address)
const entities = useEulerEntitiesOfVault(vault.address)

const collateralCount = computed(() =>
  borrowList.value.filter(pair => pair.collateral.address === vault.address).length,
)
const borrowCount = computed(() =>
  borrowList.value.filter(pair => pair.borrow.address === vault.address).length,
)
</script>

<template>
  <div class="bg-euler-dark-300 br-16 column gap-24 p-24">
    <p class="h3 text-white">
      Overview
    </p>
    <div class="column align-start gap-24">
      <VaultOverviewLabelValue
        label="Price"
        value="$0.00"
      >
        ${{ formatNumber(getVaultPrice(1, vault)) }}
      </VaultOverviewLabelValue>
      <VaultOverviewLabelValue
        label="Market"
        :value="product.name"
      />
      <VaultOverviewLabelValue label="Governor(s)">
        <div
          v-if="entities.length"
          class="column gap-16"
        >
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
        <div v-else>
          -
        </div>
      </VaultOverviewLabelValue>
      <VaultOverviewLabelValue label="Market type">
        <VaultTypeChip
          :vault="vault"
          :type="entities.length ? 'governed' : ''"
        />
      </VaultOverviewLabelValue>
      <VaultOverviewLabelValue label="Can be borrowed">
        <div class="align-center gap-8">
          <div>
            <UiIcon :name="borrowCount ? 'green-tick' : 'red-cross'" />
          </div>
          <span class="p2 text-white">
            {{ borrowCount ? `Yes in ${borrowCount} markets` : 'No' }}
          </span>
        </div>
      </VaultOverviewLabelValue>
      <VaultOverviewLabelValue label="Can be used as collateral">
        <div class="align-center gap-8">
          <div>
            <UiIcon :name="collateralCount ? 'green-tick' : 'red-cross'" />
          </div>
          <span class="p2 text-white">
            {{ collateralCount ? `Yes in ${collateralCount} markets` : 'No' }}
          </span>
        </div>
      </VaultOverviewLabelValue>
    </div>
  </div>
</template>

<style scoped lang="scss">
</style>
