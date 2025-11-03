<script setup lang="ts">
import { useVaults } from '~/composables/useVaults'
import { getAssetLogoUrl } from '~/entities/assets'

defineOptions({
  name: 'BorrowPage',
})

const { borrowList, isLoading } = useVaults()

const selectedCollateral = ref<string[]>([])
const selectedDebt = ref<string[]>([])

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
</script>

<template>
  <section
    :class="$style.borrowPage"
    class="column"
  >
    <BasePageHeader
      title="Borrow"
      description="Borrow against your collateral"
      class="mb-24"
    />
    <div class="mb-16">
      <h3 class="h3 mb-16">
        Discover vaults
      </h3>
      <div class="flex gap-8">
        <UiSelect
          v-model="selectedCollateral"
          :class="$style.filterSelect"
          :options="collateralAssetOptions"
          placeholder="Collateral asset"
          title="Collateral asset"
          show-selected-options
        />
        <UiSelect
          v-model="selectedDebt"
          :class="$style.filterSelect"
          :options="debtAssetOptions"
          placeholder="Debt asset"
          title="Debt asset"
          show-selected-options
        />
      </div>
    </div>
    <div
      :class="$style.contentArea"
      class="column"
    >
      <UiLoader
        v-if="isLoading"
        :class="$style.loader"
      />
      <VaultsBorrowList
        v-else-if="filteredBorrowList.length"
        :items="filteredBorrowList"
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
.borrowPage {
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

.filterSelect {
  flex: 1;
  max-width: 50%;
  align-self: stretch;
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
