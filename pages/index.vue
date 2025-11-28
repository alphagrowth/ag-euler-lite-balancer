<script setup lang="ts">
import { useVaults } from '~/composables/useVaults'
import { getAssetLogoUrl } from '~/entities/assets'
import { getVaultPrice } from '~/entities/vault'
import type { Vault } from '~/entities/vault'

defineOptions({
  name: 'IndexPage',
})

const { list, isLoading } = useVaults()
const route = useRoute()

const selectedCollateral = ref<string[]>([])

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

const filteredList = computed(() => {
  if (!selectedCollateral.value.length) {
    return list.value
  }
  return list.value.filter(vault => selectedCollateral.value.includes(vault.asset.address))
})

const sortedList = computed(() => {
  return [...filteredList.value].sort((a: Vault, b: Vault) => {
    return getVaultPrice(b.totalAssets, b) - getVaultPrice(a.totalAssets, a)
  })
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
    :class="$style.lendPage"
    class="column"
  >
    <BasePageHeader
      title="Lend"
      description="Earn yield on assets by lending them out."
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
      <UiSelect
        v-model="selectedCollateral"
        class="px-16"
        :class="$style.filterSelect"
        :options="assetOptions"
        placeholder="Choose asset"
        title="Choose asset"
        icon="filter"
        options-chips
      />
    </div>
    <div
      :class="$style.contentArea"
      class="column"
    >
      <UiLoader
        v-if="isLoading"
        class="my-16 mx-auto"
      />

      <VaultsList
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

<style lang="scss" module>
.lendPage {
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
