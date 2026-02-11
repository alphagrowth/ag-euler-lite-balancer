<script setup lang="ts">
import { useVaults } from '~/composables/useVaults'
import { useVaultRegistry } from '~/composables/useVaultRegistry'
import { useEulerAddresses } from '~/composables/useEulerAddresses'
import { getAssetLogoUrl } from '~/composables/useTokens'
import type { EarnVault } from '~/entities/vault'
import { getAssetUsdValueOrZero } from '~/services/pricing/priceProvider'
import { getEntitiesByEarnVault, isVaultDeprecated, isVaultFeatured } from '~/composables/useEulerLabels'

defineOptions({
  name: 'EarnPage',
})

const { isEarnUpdating: isLoading } = useVaults()
const { getEarnVaults } = useVaultRegistry()
const { chainId } = useEulerAddresses()
const list = computed(() => getEarnVaults().filter(v => v.verified && !isVaultDeprecated(v.address)))

const { enableEntityBranding } = useDeployConfig()

const selectedCollateral = ref<string[]>([])
const selectedCurators = ref<string[]>([])
const sortBy = ref<string>('Total Supply')
const sortDir = ref<'desc' | 'asc'>('desc')

useUrlQuerySync([
  { ref: sortBy, default: 'Total Supply', queryKey: 'sort' },
  { ref: sortDir, default: 'desc', queryKey: 'dir' },
  { ref: selectedCollateral, default: [], queryKey: 'vault' },
  { ref: selectedCurators, default: [], queryKey: 'allocator' },
])

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
        getAssetUsdValueOrZero(vault.totalAssets, vault, 'off-chain'),
        getAssetUsdValueOrZero(vault.availableAssets, vault, 'off-chain'),
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
    selectedCurators.value = []
  }
})

const assetOptions = computed(() => {
  return list.value
    .map(vault => ({
      label: vault.asset.symbol,
      value: vault.asset.address,
      icon: getAssetLogoUrl(vault.asset.address, vault.asset.symbol),
    }))
    .reduce((prev, curr) =>
      prev.find(vault => vault.value === curr.value) ? prev : [...prev, curr], [] as { label: string, value: string, icon: string }[],
    )
})

const curatorOptions = computed(() => {
  return list.value.reduce((result, vault) => {
    const vaultEntities = getEntitiesByEarnVault(vault)
    for (const entity of vaultEntities) {
      if (!result.find(option => option.value === entity.name)) {
        return [...result, { label: entity.name, value: entity.name, icon: entity.logo ? `/entities/${entity.logo}` : undefined }]
      }
    }
    return result
  }, [] as { label: string, value: string, icon?: string }[])
})

const topOptions = ref<{ label: string, value: string, icon: string }[]>([])
watchEffect(() => {
  const sorted = [...list.value].sort((a: EarnVault, b: EarnVault) => {
    const aValue = vaultTotalSupplyUsd.value.get(a.address) ?? 0
    const bValue = vaultTotalSupplyUsd.value.get(b.address) ?? 0
    return bValue - aValue
  })

  const newTop = sorted
    .slice(0, 3)
    .map(vault => ({
      label: vault.asset.symbol,
      value: vault.asset.address,
      icon: getAssetLogoUrl(vault.asset.address, vault.asset.symbol),
    }))
    .reduce((prev, curr) =>
      prev.find(vault => vault.value === curr.value) ? prev : [...prev, curr], [] as { label: string, value: string, icon: string }[],
    )

  const oldKeys = topOptions.value.map(o => o.value).join(',')
  const newKeys = newTop.map(o => o.value).join(',')
  if (oldKeys !== newKeys) {
    topOptions.value = newTop
  }
})

const filteredList = computed(() => {
  return list.value
    .filter(vault => selectedCollateral.value.length ? selectedCollateral.value.includes(vault.asset.address) : true)
    .filter(vault => selectedCurators.value.length ? getEntitiesByEarnVault(vault).some(e => selectedCurators.value.includes(e.name)) : true)
})

const applyFeaturedSort = <T extends { address: string }>(sorted: T[]): T[] => {
  return [...sorted].sort((a, b) => {
    const af = isVaultFeatured(a.address) ? 1 : 0
    const bf = isVaultFeatured(b.address) ? 1 : 0
    return bf - af
  })
}

const sortedList = computed(() => {
  let sorted: EarnVault[]
  switch (sortBy.value) {
    case 'Total Supply':
      sorted = applyFeaturedSort([...filteredList.value].sort((a: EarnVault, b: EarnVault) => {
        const aValue = vaultTotalSupplyUsd.value.get(a.address) ?? 0
        const bValue = vaultTotalSupplyUsd.value.get(b.address) ?? 0
        return bValue - aValue
      }))
      break
    case 'Supply APY':
      sorted = applyFeaturedSort([...filteredList.value].sort((a: EarnVault, b: EarnVault) => {
        return Number(b.interestRateInfo.supplyAPY) - Number(a.interestRateInfo.supplyAPY)
      }))
      break
    case 'Liquidity':
      sorted = applyFeaturedSort([...filteredList.value].sort((a: EarnVault, b: EarnVault) => {
        const aValue = vaultLiquidityUsd.value.get(a.address) ?? 0
        const bValue = vaultLiquidityUsd.value.get(b.address) ?? 0
        return bValue - aValue
      }))
      break
    default:
      sorted = applyFeaturedSort([...filteredList.value])
  }
  return sortDir.value === 'asc' ? [...sorted].reverse() : sorted
})

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
          v-model:dir="sortDir"
          :options="['Total Supply', 'Liquidity', 'Supply APY']"
          placeholder="Sort By"
          title="Sorting type"
        />
        <UiSelect
          v-if="enableEntityBranding"
          :key="`curators-${chainId}`"
          v-model="selectedCurators"
          :options="curatorOptions"
          placeholder="Capital allocator"
          title="Capital allocator"
          modal-input-placeholder="Search allocator"
          icon="filter"
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
