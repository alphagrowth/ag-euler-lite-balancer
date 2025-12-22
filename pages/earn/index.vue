<script setup lang="ts">
import { useVaults } from '~/composables/useVaults'
import { getAssetLogoUrl } from '~/composables/useTokens'
import { getEarnVaultPrice } from '~/entities/vault'
import type { EarnVault } from '~/entities/vault'

defineOptions({
  name: 'EarnPage',
})

const { earnList: list, isLoading } = useVaults()
const route = useRoute()

const selectedCollateral = ref<string[]>([])
const sortBy = ref<string>('Total Supply')

const assetOptions = computed(() => {
  return list.value
    .map(vault => ({
      label: vault.asset.symbol,
      value: vault.asset.address,
      icon: getAssetLogoUrl(vault.asset.symbol),
    }))
    .reduce((prev, curr) =>
      prev.find(vault => vault.value === curr.value) ? prev : [...prev, curr], [] as { label: string, value: string, icon: string }[],
    )
})

const topOptions = computed(() => {
  const sortedBySupply = [...list.value].sort((a: EarnVault, b: EarnVault) => {
    return getEarnVaultPrice(b.totalAssets, b) - getEarnVaultPrice(a.totalAssets, a)
  })

  return sortedBySupply
    .slice(0, 3)
    .map(vault => ({
      label: vault.asset.symbol,
      value: vault.asset.address,
      icon: getAssetLogoUrl(vault.asset.symbol),
    }))
    .reduce((prev, curr) =>
      prev.find(vault => vault.value === curr.value) ? prev : [...prev, curr], [] as { label: string, value: string, icon: string }[],
    )
})

const filteredList = computed(() => {
  if (!selectedCollateral.value.length) {
    return list.value
  }
  return list.value.filter(vault => selectedCollateral.value.includes(vault.asset.address))
})

const sortedList = computed(() => {
  switch (sortBy.value) {
    case 'Total Supply':
      return [...filteredList.value].sort((a: EarnVault, b: EarnVault) => {
        return getEarnVaultPrice(b.totalAssets, b) - getEarnVaultPrice(a.totalAssets, a)
      })
    case 'Supply APY':
      return [...filteredList.value].sort((a: EarnVault, b: EarnVault) => {
        return Number(b.supplyAPY) - Number(a.supplyAPY)
      })
    default:
      return filteredList.value
  }
})

const load = () => {
  let collateral = route.query.collateral
  if (!collateral) return
  if (typeof collateral === 'string') {
    collateral = [collateral]
  }
  selectedCollateral.value = collateral as string[]
}

load()
</script>

<template>
  <section
    :class="$style.EarnPage"
    class="column"
  >
    <BasePageHeader
      title="Earn"
      description="Deposit once, earn passive yield across multiple professionally curated strategies."
      class="mb-24"
      arrow-down
    />
    <div
      class="mb-16"
      :class="$style.filterSelectWrap"
    >
      <h3 class="h3 mb-16 pl-16">
        Discover vaults
      </h3>
      <div
        class="align-center"
        :class="$style.filterSelectScroll"
      >
        <VaultSortButton
          v-model="sortBy"
          :options="['Total Supply', 'Supply APY']"
          placeholder="Sort By"
          title="Sorting type"
        />
        <UiSelect
          v-model="selectedCollateral"
          :class="$style.filterSelect"
          :options="assetOptions"
          placeholder="Choose asset"
          title="Choose asset"
          icon="filter"
          :chip-options="topOptions"
        />
      </div>
    </div>
    <div
      :class="$style.contentArea"
      class="column"
    >
      <UiLoader
        v-if="isLoading"
        class="my-16 mx-auto"
      />

      <VaultsEarnList
        v-else-if="sortedList.length"
        type="lend"
        :items="sortedList"
      />
      <div
        v-else
        :class="$style.emptyState"
        class="column gap-12 align-center justify-center text-euler-dark-900"
      >
        <UiIcon
          name="search"
          :class="$style.searchIcon"
        />
        <div
          :class="$style.emptyDescription"
          class="center"
        >
          No markets were found by these filters
        </div>
      </div>
    </div>
  </section>
</template>

<style module lang="scss">
.EarnPage {
  min-height: calc(100dvh - 178px);
}
.loader {
  flex: 1;
  align-self: center;
  justify-self: center;
}

.contentArea {
  flex: 1;
}

.filterSelectWrap {
  margin: 0 -16px;
}

.filterSelectScroll {
  overflow: auto;
  scrollbar-width: none;
  gap: 8px;
  padding: 0 16px;
}

.searchIcon {
  width: 24px;
  height: 24px;
}

.emptyState {
  flex: 1;
}

.emptyDescription {
  max-width: 180px;
}
</style>
