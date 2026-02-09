<script setup lang="ts">
import { useVaults } from '~/composables/useVaults'
import { useEulerAddresses } from '~/composables/useEulerAddresses'
import { getAssetLogoUrl } from '~/composables/useTokens'
import { getVaultUtilization } from '~/entities/vault'
import type { AnyBorrowVaultPair, BorrowVaultPair } from '~/entities/vault'
import { getAssetUsdValueOrZero } from '~/services/pricing/priceProvider'
import { getProductByVault, isVaultDeprecated, isVaultFeatured } from '~/composables/useEulerLabels'

const { getOpportunityOfBorrowVault } = useMerkl()
const { getCampaignOfBorrowVault } = useBrevis()
const { withIntrinsicBorrowApy, withIntrinsicSupplyApy } = useIntrinsicApy()

const getNetApy = (pair: BorrowVaultPair) => {
  const baseSupplyApy = nanoToValue(pair.collateral.interestRateInfo?.supplyAPY || 0n, 25)
  const baseBorrowApy = nanoToValue(pair.borrow.interestRateInfo.borrowAPY, 25)
  const supplyApy = withIntrinsicSupplyApy(baseSupplyApy, pair.collateral.asset.symbol)
  const borrowApy = withIntrinsicBorrowApy(baseBorrowApy, pair.borrow.asset.symbol)
  const opportunityInfo = getOpportunityOfBorrowVault(pair.borrow.asset.address)
  const brevisInfo = getCampaignOfBorrowVault(pair.borrow.address)
  const totalRewardsAPY = (opportunityInfo?.apr || 0) + (brevisInfo?.reward_info.apr || 0) * 100
  return (supplyApy + totalRewardsAPY) - (borrowApy - totalRewardsAPY)
}

const getSortMaxRoe = (pair: BorrowVaultPair) => {
  const borrowLTV = nanoToValue(pair.borrowLTV, 2)
  const maxMultiplier = Math.max(1, Math.floor(100 / (100 - borrowLTV) * 100) / 100)
  const baseSupplyApy = nanoToValue(pair.collateral.interestRateInfo?.supplyAPY || 0n, 25)
  const supplyApy = withIntrinsicSupplyApy(baseSupplyApy, pair.collateral.asset.symbol)
  const opportunityInfo = getOpportunityOfBorrowVault(pair.borrow.asset.address)
  const brevisInfo = getCampaignOfBorrowVault(pair.borrow.address)
  const totalRewardsAPY = (opportunityInfo?.apr || 0) + (brevisInfo?.reward_info.apr || 0) * 100
  const supplyApyWithRewards = supplyApy + totalRewardsAPY
  const netApy = getNetApy(pair)
  return supplyApyWithRewards + (maxMultiplier - 1) * netApy
}

defineOptions({
  name: 'BorrowPage',
})

const { borrowList, isUpdating, isEscrowUpdating } = useVaults()
const { chainId } = useEulerAddresses()

const isLoading = computed(() => isUpdating.value || isEscrowUpdating.value)
const { products, entities } = useEulerLabels()

const activeBorrowList = computed(() =>
  borrowList.value.filter(pair =>
    !isVaultDeprecated(pair.borrow.address) && !isVaultDeprecated(pair.collateral.address),
  ),
)

const selectedCollateral = ref<string[]>([])
const selectedDebt = ref<string[]>([])
const selectedMarkets = ref<string[]>([])
const sortBy = ref<string>('Recommended')

// Cache for USD values used in sorting (keyed by pair identifier: collateral+borrow address)
const pairLiquidityUsd = ref<Map<string, number>>(new Map())
const pairBorrowedUsd = ref<Map<string, number>>(new Map())

// Helper to create a unique key for a borrow pair
const getPairKey = (pair: AnyBorrowVaultPair) => `${pair.collateral.address}-${pair.borrow.address}`

// Fetch USD values for all borrow pairs
watchEffect(async () => {
  const pairs = borrowList.value
  if (!pairs.length) return

  const liquidityValues = new Map<string, number>()
  const borrowedValues = new Map<string, number>()
  await Promise.all(
    pairs.map(async (pair) => {
      const key = getPairKey(pair)
      const [liquidity, borrowed] = await Promise.all([
        getAssetUsdValueOrZero(pair.borrow.supply - pair.borrow.borrow, pair.borrow, 'off-chain'),
        getAssetUsdValueOrZero(pair.borrow.borrow, pair.borrow, 'off-chain'),
      ])
      liquidityValues.set(key, liquidity)
      borrowedValues.set(key, borrowed)
    }),
  )
  pairLiquidityUsd.value = liquidityValues
  pairBorrowedUsd.value = borrowedValues
})

watch(chainId, (newChainId, oldChainId) => {
  if (oldChainId !== undefined && newChainId !== oldChainId) {
    selectedCollateral.value = []
    selectedDebt.value = []
    selectedMarkets.value = []
  }
})

const collateralAssetOptions = computed(() => {
  return activeBorrowList.value
    .filter((item, idx, self) => idx === self.findIndex(t => t.collateral.asset.address === item.collateral.asset.address))
    .map(pair => ({
      label: pair.collateral.asset.symbol,
      value: pair.collateral.asset.address,
      icon: getAssetLogoUrl(pair.collateral.asset.address, pair.collateral.asset.symbol),
    }))
    .reduce((prev, curr) =>
      prev.find(vault => vault.value === curr.value) ? prev : [...prev, curr], [] as { label: string, value: string, icon: string }[],
    )
})

const debtAssetOptions = computed(() => {
  return activeBorrowList.value
    .filter((item, idx, self) => idx === self.findIndex(t => t.borrow.asset.address === item.borrow.asset.address))
    .map(pair => ({
      label: pair.borrow.asset.symbol,
      value: pair.borrow.asset.address,
      icon: getAssetLogoUrl(pair.borrow.asset.address, pair.borrow.asset.symbol),
    }))
    .reduce((prev, curr) =>
      prev.find(vault => vault.value === curr.value) ? prev : [...prev, curr], [] as { label: string, value: string, icon: string }[],
    )
})

const marketOptions = computed(() => {
  return activeBorrowList.value.reduce((result, pair) => {
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
  return activeBorrowList.value
    .filter(pair =>
      selectedCollateral.value.length || selectedDebt.value.length
        ? ((!selectedCollateral.value.length || selectedCollateral.value.includes(pair.collateral.asset.address))
          && (!selectedDebt.value.length || selectedDebt.value.includes(pair.borrow.asset.address)))
        : true,
    )
    .filter(pair => selectedMarkets.value.length ? selectedMarkets.value.includes(getProductByVault(pair.collateral.address).name) : true)
})

const isPairFeatured = (pair: AnyBorrowVaultPair) =>
  isVaultFeatured(pair.collateral.address) || isVaultFeatured(pair.borrow.address)

const applyFeaturedPairSort = (sorted: AnyBorrowVaultPair[]): AnyBorrowVaultPair[] => {
  return [...sorted].sort((a, b) => {
    const af = isPairFeatured(a) ? 1 : 0
    const bf = isPairFeatured(b) ? 1 : 0
    return bf - af
  })
}

const sortedBorrowList = computed(() => {
  switch (sortBy.value) {
    case 'Recommended': {
      const list = [...filteredBorrowList.value]

      const scores = list.map((pair) => {
        const maxRoe = 'borrowLTV' in pair ? getSortMaxRoe(pair as BorrowVaultPair) : 0
        const liquidityUsd = pairLiquidityUsd.value.get(getPairKey(pair)) ?? 0
        return { pair, maxRoe, liquidityUsd }
      })

      const maxMaxRoe = Math.max(...scores.map(s => s.maxRoe), 0)
      const maxLiquidity = Math.max(...scores.map(s => s.liquidityUsd), 0)

      const scored = scores.map(({ pair, maxRoe, liquidityUsd }) => {
        const normalizedRoe = maxMaxRoe === 0 ? 0 : maxRoe / maxMaxRoe
        const normalizedLiquidity = maxLiquidity === 0 ? 0 : liquidityUsd / maxLiquidity
        const roeBucket = maxRoe >= 0 ? 0 : 1
        const compositeScore = normalizedRoe * normalizedLiquidity
        return { pair, roeBucket, compositeScore }
      })

      scored.sort((a, b) => {
        if (a.roeBucket !== b.roeBucket) return a.roeBucket - b.roeBucket
        return b.compositeScore - a.compositeScore
      })

      return applyFeaturedPairSort(scored.map(s => s.pair))
    }
    case 'Liquidity':
      return applyFeaturedPairSort([...filteredBorrowList.value].sort((a: AnyBorrowVaultPair, b: AnyBorrowVaultPair) => {
        const aValue = pairLiquidityUsd.value.get(getPairKey(a)) ?? 0
        const bValue = pairLiquidityUsd.value.get(getPairKey(b)) ?? 0
        return bValue - aValue
      }))
    case 'Borrow APY':
      return applyFeaturedPairSort([...filteredBorrowList.value].sort((a: AnyBorrowVaultPair, b: AnyBorrowVaultPair) => {
        return Number(a.borrow.interestRateInfo.borrowAPY) - Number(b.borrow.interestRateInfo.borrowAPY)
      }))
    case 'Utilization':
      return applyFeaturedPairSort([...filteredBorrowList.value].sort((a: BorrowVaultPair, b: BorrowVaultPair) => {
        return getVaultUtilization(b.borrow) - getVaultUtilization(a.borrow)
      }))
    case 'Total Borrowed':
      return applyFeaturedPairSort([...filteredBorrowList.value].sort((a: BorrowVaultPair, b: BorrowVaultPair) => {
        const aValue = pairBorrowedUsd.value.get(getPairKey(a)) ?? 0
        const bValue = pairBorrowedUsd.value.get(getPairKey(b)) ?? 0
        return bValue - aValue
      }))
    case 'Max ROE':
      return applyFeaturedPairSort([...filteredBorrowList.value].sort((a: BorrowVaultPair, b: BorrowVaultPair) => {
        return getSortMaxRoe(b) - getSortMaxRoe(a)
      }))
    case 'Net APY':
      return applyFeaturedPairSort([...filteredBorrowList.value].sort((a: BorrowVaultPair, b: BorrowVaultPair) => {
        return getNetApy(b) - getNetApy(a)
      }))
    default:
      return applyFeaturedPairSort([...filteredBorrowList.value])
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
          :options="['Recommended', 'Liquidity', 'Total Borrowed', 'Utilization', 'Borrow APY', 'Net APY', 'Max ROE']"
          placeholder="Sort By"
          title="Sorting type"
        />
        <UiSelect
          :key="`markets-${chainId}`"
          v-model="selectedMarkets"
          class="shrink-0 mobile:flex-1 mobile:basis-[calc(50%-4px)]"
          :options="marketOptions"
          placeholder="Choose market"
          title="Choose market"
          modal-input-placeholder="Search market"
          icon="filter"
        />
        <UiSelect
          :key="`collateral-${chainId}`"
          v-model="selectedCollateral"
          class="flex-1 min-w-0 mobile:basis-[calc(50%-4px)]"
          :options="collateralAssetOptions"
          placeholder="Collateral asset"
          title="Collateral asset"
          modal-input-placeholder="Search asset"
          show-selected-options
        />
        <UiSelect
          :key="`debt-${chainId}`"
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
