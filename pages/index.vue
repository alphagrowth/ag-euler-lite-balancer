<script setup lang="ts">
import { useVaults } from '~/composables/useVaults'
import { useVaultRegistry } from '~/composables/useVaultRegistry'
import { getAssetLogoUrl } from '~/composables/useTokens'
import { getVaultPrice, getVaultUtilization } from '~/entities/vault'
import type { Vault } from '~/entities/vault'
import { getProductByVault } from '~/composables/useEulerLabels'

defineOptions({
  name: 'IndexPage',
})

const { borrowList, isUpdating } = useVaults()
const { getEvkVaults } = useVaultRegistry()
const list = computed(() => getEvkVaults())

const isLoading = computed(() => isUpdating.value)
const { products, entities } = useEulerLabels()
const route = useRoute()

const selectedCollateral = ref<string[]>([])
const selectedMarkets = ref<string[]>([])
const sortBy = ref<string>('Total Supply')

const borrowableVaults = computed(() => {
  return list.value.filter(vault =>
    borrowList.value.some(pair => pair.borrow.address === vault.address),
  )
})

const marketOptions = computed(() => {
  return borrowableVaults.value.reduce((result, vault) => {
    const market = Object.values(products).find(product => product.vaults.includes(vault.address))
    const entityName = Array.isArray(market?.entity) ? market?.entity[0] : market?.entity
    const entityObj = entityName ? entities[entityName] : null

    if (market && !result.find(option => option.label === market.name)) {
      return [...result, { label: market.name, value: market.name, icon: entityObj?.logo ? `/entities/${entityObj?.logo}` : undefined }]
    }

    return result
  }, [] as { label: string, value: string, icon?: string }[])
})

const assetOptions = computed(() => {
  return borrowableVaults.value
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
  const sortedBySupply = [...borrowableVaults.value].sort((a: Vault, b: Vault) => {
    return getVaultPrice(b.totalAssets, b) - getVaultPrice(a.totalAssets, a)
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
  return borrowableVaults.value
    .filter(vault => selectedCollateral.value.length ? selectedCollateral.value.includes(vault.asset.address) : true)
    .filter(vault => selectedMarkets.value.length ? selectedMarkets.value.includes(getProductByVault(vault.address).name) : true)
})

const sortedList = computed(() => {
  switch (sortBy.value) {
    case 'Total Supply':
      return [...filteredList.value].sort((a: Vault, b: Vault) => {
        return getVaultPrice(b.totalAssets, b) - getVaultPrice(a.totalAssets, a)
      })
    case 'Supply APY':
      return [...filteredList.value].sort((a: Vault, b: Vault) => {
        return Number(b.interestRateInfo.supplyAPY) - Number(a.interestRateInfo.supplyAPY)
      })
    case 'Utilization':
      return [...filteredList.value].sort((a: Vault, b: Vault) => {
        return getVaultUtilization(b) - getVaultUtilization(a)
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
  <section class="flex flex-col min-h-[calc(100dvh-178px)]">
    <BasePageHeader
      title="Lend"
      description="Earn yield on assets by lending them out."
      class="mb-24"
      arrow-down
    />

    <div class="mb-16 -mx-16">
      <h3 class="text-h3 mb-16 pl-16">
        Discover vaults
      </h3>
      <div class="flex items-center overflow-auto [scrollbar-width:none] gap-8 px-16">
        <VaultSortButton
          v-model="sortBy"
          :options="['Total Supply', 'Utilization', 'Supply APY']"
          placeholder="Sort By"
          title="Sorting type"
        />
        <UiSelect
          v-model="selectedMarkets"
          :options="marketOptions"
          placeholder="Choose market"
          title="Choose market"
          modal-input-placeholder="Search market"
          icon="filter"
        />
        <UiSelect
          v-model="selectedCollateral"
          :options="assetOptions"
          placeholder="Choose asset"
          title="Choose asset"
          modal-input-placeholder="Search asset"
          icon="filter"
          :chip-options="topOptions"
        />
      </div>
    </div>

    <div class="flex flex-col flex-1">
      <UiLoader
        v-if="isLoading"
        class="flex-1 self-center justify-self-center"
      />

      <VaultsList
        v-else-if="sortedList.length"
        type="lend"
        :items="sortedList"
      />

      <div
        v-else
        class="flex flex-col flex-1 gap-3 items-center justify-center text-euler-dark-900"
      >
        <UiIcon
          name="search"
          class="!w-24 !h-24"
        />
        <div class="text-center max-w-[180px]">
          No markets were found by these filters
        </div>
      </div>
    </div>
  </section>
</template>
