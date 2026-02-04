<script setup lang="ts">
import { useVaults } from '~/composables/useVaults'
import { getAssetLogoUrl } from '~/composables/useTokens'
import { getVaultUtilization } from '~/entities/vault'
import type { AnyBorrowVaultPair, BorrowVaultPair } from '~/entities/vault'
import { getAssetUsdValue } from '~/services/pricing/priceProvider'
import { getProductByVault } from '~/composables/useEulerLabels'

const getMaxRoe = (pair: BorrowVaultPair) => {
  const borrowLTV = nanoToValue(pair.borrowLTV, 2)
  const maxMultiplier = Math.max(1, Math.floor(100 / (100 - borrowLTV) * 100) / 100)
  const supplyApy = nanoToValue(pair.collateral.interestRateInfo?.supplyAPY || 0n, 25)
  const borrowApy = nanoToValue(pair.borrow.interestRateInfo.borrowAPY, 25)
  const netApy = supplyApy - borrowApy
  return supplyApy + (maxMultiplier - 1) * netApy
}

defineOptions({
  name: 'BorrowPage',
})

const { borrowList, isUpdating, isEscrowUpdating } = useVaults()

const isLoading = computed(() => isUpdating.value || isEscrowUpdating.value)
const { products, entities } = useEulerLabels()

const selectedCollateral = ref<string[]>([])
const selectedDebt = ref<string[]>([])
const selectedMarkets = ref<string[]>([])
const sortBy = ref<string>('Liquidity')

const collateralAssetOptions = computed(() => {
  return borrowList.value
    .filter((item, idx, self) => idx === self.findIndex(t => t.collateral.asset.address === item.collateral.asset.address))
    .map(pair => ({
      label: pair.collateral.asset.symbol,
      value: pair.collateral.asset.address,
      icon: getAssetLogoUrl(pair.collateral.asset.symbol),
    }))
    .reduce((prev, curr) =>
      prev.find(vault => vault.value === curr.value) ? prev : [...prev, curr], [] as { label: string, value: string, icon: string }[],
    )
})

const debtAssetOptions = computed(() => {
  return borrowList.value
    .filter((item, idx, self) => idx === self.findIndex(t => t.borrow.asset.address === item.borrow.asset.address))
    .map(pair => ({
      label: pair.borrow.asset.symbol,
      value: pair.borrow.asset.address,
      icon: getAssetLogoUrl(pair.borrow.asset.symbol),
    }))
    .reduce((prev, curr) =>
      prev.find(vault => vault.value === curr.value) ? prev : [...prev, curr], [] as { label: string, value: string, icon: string }[],
    )
})

const marketOptions = computed(() => {
  return borrowList.value.reduce((result, pair) => {
    const market = Object.values(products).find(product => product.vaults.includes(pair.collateral.address))
    const entityName = Array.isArray(market?.entity) ? market?.entity[0] : market?.entity
    const entityObj = entityName ? entities[entityName] : null

    if (market && !result.find(option => option.label === market.name)) {
      return [...result, { label: market.name, value: market.name, icon: entityObj?.logo ? `/entities/${entityObj?.logo}` : undefined }]
    }

    return result
  }, [] as { label: string, value: string, icon?: string }[])
})

const filteredBorrowList = computed(() => {
  return borrowList.value
    .filter(pair =>
      selectedCollateral.value.length || selectedDebt.value.length
        ? ((!selectedCollateral.value.length || selectedCollateral.value.includes(pair.collateral.asset.address))
          && (!selectedDebt.value.length || selectedDebt.value.includes(pair.borrow.asset.address)))
        : true,
    )
    .filter(pair => selectedMarkets.value.length ? selectedMarkets.value.includes(getProductByVault(pair.collateral.address).name) : true)
})

const sortedBorrowList = computed(() => {
  switch (sortBy.value) {
    case 'Liquidity':
      return [...filteredBorrowList.value].sort((a: AnyBorrowVaultPair, b: AnyBorrowVaultPair) => {
        return getAssetUsdValue(b.borrow.supply - b.borrow.borrow, b.borrow) - getAssetUsdValue(a.borrow.supply - a.borrow.borrow, a.borrow)
      })
    case 'Borrow APY':
      return [...filteredBorrowList.value].sort((a: AnyBorrowVaultPair, b: AnyBorrowVaultPair) => {
        return Number(a.borrow.interestRateInfo.borrowAPY) - Number(b.borrow.interestRateInfo.borrowAPY)
      })
    case 'Utilization':
      return [...filteredBorrowList.value].sort((a: BorrowVaultPair, b: BorrowVaultPair) => {
        return getVaultUtilization(b.borrow) - getVaultUtilization(a.borrow)
      })
    case 'Total Borrowed':
      return [...filteredBorrowList.value].sort((a: BorrowVaultPair, b: BorrowVaultPair) => {
        return getAssetUsdValue(b.borrow.borrow, b.borrow) - getAssetUsdValue(a.borrow.borrow, a.borrow)
      })
    case 'Max ROE':
      return [...filteredBorrowList.value].sort((a: BorrowVaultPair, b: BorrowVaultPair) => {
        return getMaxRoe(b) - getMaxRoe(a)
      })
    default:
      return filteredBorrowList.value
  }
})
</script>

<template>
  <section class="flex flex-col min-h-[calc(100dvh-178px)]">
    <BasePageHeader
      title="Borrow"
      description="Borrow against your collateral"
      class="mb-24"
    />

    <div class="mb-16">
      <h3 class="text-h3 mb-16 text-neutral-900">
        Discover vaults
      </h3>
      <div class="flex justify-start items-center w-full gap-8 mobile:flex-wrap">
        <VaultSortButton
          v-model="sortBy"
          class="shrink-0 mobile:flex-1 mobile:basis-[calc(50%-4px)]"
          :options="['Liquidity', 'Total Borrowed', 'Utilization', 'Borrow APY', 'Max ROE']"
          placeholder="Sort By"
          title="Sorting type"
        />
        <UiSelect
          v-model="selectedMarkets"
          class="shrink-0 mobile:flex-1 mobile:basis-[calc(50%-4px)]"
          :options="marketOptions"
          placeholder="Choose market"
          title="Choose market"
          modal-input-placeholder="Search market"
          icon="filter"
        />
        <UiSelect
          v-model="selectedCollateral"
          class="flex-1 min-w-0 mobile:basis-[calc(50%-4px)]"
          :options="collateralAssetOptions"
          placeholder="Collateral asset"
          title="Collateral asset"
          modal-input-placeholder="Search asset"
          show-selected-options
        />
        <UiSelect
          v-model="selectedDebt"
          class="flex-1 min-w-0 mobile:basis-[calc(50%-4px)]"
          :options="debtAssetOptions"
          placeholder="Debt asset"
          title="Debt asset"
          modal-input-placeholder="Search asset"
          show-selected-options
        />
      </div>
    </div>

    <div class="flex flex-col flex-1">
      <UiLoader
        v-if="isLoading"
        class="flex-1 self-center justify-self-center"
      />

      <VaultsBorrowList
        v-else-if="sortedBorrowList.length"
        :items="sortedBorrowList"
      />

      <div
        v-else
        class="flex flex-col flex-1 gap-3 items-center justify-center text-neutral-500"
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
