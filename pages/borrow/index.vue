<script setup lang="ts">
import { useVaults } from '~/composables/useVaults'
import { getAssetLogoUrl } from '~/composables/useTokens'
import { getVaultPrice } from '~/entities/vault'
import type { BorrowVaultPair } from '~/entities/vault'

defineOptions({
  name: 'BorrowPage',
})

const { borrowList, isLoading } = useVaults()

const selectedCollateral = ref<string[]>([])
const selectedDebt = ref<string[]>([])
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

const filteredBorrowList = computed(() => {
  if (!selectedCollateral.value.length && !selectedDebt.value.length) {
    return borrowList.value
  }
  return borrowList.value.filter(pair =>
    (!selectedCollateral.value.length || selectedCollateral.value.includes(pair.collateral.asset.address))
    && (!selectedDebt.value.length || selectedDebt.value.includes(pair.borrow.asset.address)),
  )
})

const sortedBorrowList = computed(() => {
  switch (sortBy.value) {
    case 'Liquidity':
      return [...filteredBorrowList.value].sort((a: BorrowVaultPair, b: BorrowVaultPair) => {
        return getVaultPrice(b.borrow.supply - b.borrow.borrow, b.borrow) - getVaultPrice(a.borrow.supply - a.borrow.borrow, a.borrow)
      })
    case 'Borrow APY':
      return [...filteredBorrowList.value].sort((a: BorrowVaultPair, b: BorrowVaultPair) => {
        return Number(b.borrow.interestRateInfo.borrowAPY) - Number(a.borrow.interestRateInfo.borrowAPY)
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
      <h3 class="text-h3 mb-16">
        Discover vaults
      </h3>
      <div class="flex justify-start items-center w-full gap-8">
        <VaultSortButton
          v-model="sortBy"
          class="shrink-0"
          :options="['Liquidity', 'Borrow APY']"
          placeholder="Sort By"
          title="Sorting type"
        />
        <UiSelect
          v-model="selectedCollateral"
          class="flex-1 min-w-0"
          :options="collateralAssetOptions"
          placeholder="Collateral asset"
          title="Collateral asset"
          show-selected-options
        />
        <UiSelect
          v-model="selectedDebt"
          class="flex-1 min-w-0"
          :options="debtAssetOptions"
          placeholder="Debt asset"
          title="Debt asset"
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
