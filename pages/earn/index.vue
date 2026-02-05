<script setup lang="ts">
import { useVaults } from '~/composables/useVaults'
import { useVaultRegistry } from '~/composables/useVaultRegistry'
import { useEulerAddresses } from '~/composables/useEulerAddresses'
import { getAssetLogoUrl } from '~/composables/useTokens'
import type { EarnVault } from '~/entities/vault'
import { getAssetUsdValue } from '~/services/pricing/priceProvider'

defineOptions({
  name: 'EarnPage',
})

const { isEarnUpdating: isLoading } = useVaults()
const { getEarnVaults } = useVaultRegistry()
const { chainId } = useEulerAddresses()
const list = computed(() => getEarnVaults().filter(v => v.verified))
const route = useRoute()

const selectedCollateral = ref<string[]>([])
const sortBy = ref<string>('Total Supply')

// Cache for USD values used in sorting (keyed by vault address)
const vaultTotalSupplyUsd = ref<Map<string, number>>(new Map())
const vaultLiquidityUsd = ref<Map<string, number>>(new Map())

// Fetch USD values for all earn vaults
watchEffect(async () => {
  const vaults = list.value
  if (!vaults.length) return

  const totalSupplyValues = new Map<string, number>()
  const liquidityValues = new Map<string, number>()
  await Promise.all(
    vaults.map(async (vault) => {
      const [totalSupply, liquidity] = await Promise.all([
        getAssetUsdValue(vault.totalAssets, vault, 'off-chain'),
        getAssetUsdValue(vault.availableAssets, vault, 'off-chain'),
      ])
      totalSupplyValues.set(vault.address, totalSupply)
      liquidityValues.set(vault.address, liquidity)
    }),
  )
  vaultTotalSupplyUsd.value = totalSupplyValues
  vaultLiquidityUsd.value = liquidityValues
})

watch(chainId, (newChainId, oldChainId) => {
  if (oldChainId !== undefined && newChainId !== oldChainId) {
    selectedCollateral.value = []
  }
})

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
    const aValue = vaultTotalSupplyUsd.value.get(a.address) ?? 0
    const bValue = vaultTotalSupplyUsd.value.get(b.address) ?? 0
    return bValue - aValue
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
        const aValue = vaultTotalSupplyUsd.value.get(a.address) ?? 0
        const bValue = vaultTotalSupplyUsd.value.get(b.address) ?? 0
        return bValue - aValue
      })
    case 'Supply APY':
      return [...filteredList.value].sort((a: EarnVault, b: EarnVault) => {
        return Number(b.supplyAPY) - Number(a.supplyAPY)
      })
    case 'Liquidity':
      return [...filteredList.value].sort((a: EarnVault, b: EarnVault) => {
        const aValue = vaultLiquidityUsd.value.get(a.address) ?? 0
        const bValue = vaultLiquidityUsd.value.get(b.address) ?? 0
        return bValue - aValue
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
      title="Earn"
      description="Deposit once, earn passive yield across multiple professionally curated strategies."
      class="mb-24"
      arrow-right
    />

    <div class="mb-16 -mx-16">
      <h3 class="text-h3 mb-16 pl-16 text-neutral-900">
        Discover vaults
      </h3>
      <div class="flex items-center overflow-auto [scrollbar-width:none] gap-8 px-16">
        <VaultSortButton
          v-model="sortBy"
          :options="['Total Supply', 'Liquidity', 'Supply APY']"
          placeholder="Sort By"
          title="Sorting type"
        />
        <UiSelect
          :key="`collateral-${chainId}`"
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

      <VaultsEarnList
        v-else-if="sortedList.length"
        type="lend"
        :items="sortedList"
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
