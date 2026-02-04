<script setup lang="ts">
import { type EarnVault } from '~/entities/vault'
import { formatAssetValue } from '~/services/pricing/priceProvider'

const { vault } = defineProps<{ vault: EarnVault }>()

const { getOpportunityOfLendVault } = useMerkl()
const { getVault } = useVaults()

const availableLiquidityOfStrategies = ref(0n)

const rewardSupplyAPY = computed(() => getOpportunityOfLendVault(vault.address)?.apr)

const totalSupplyDisplay = computed(() => {
  const price = formatAssetValue(vault.totalAssets, vault)
  return price.hasPrice ? `$${compactNumber(price.usdValue)}` : price.display
})

const availableLiquidityDisplay = computed(() => {
  const price = formatAssetValue(availableLiquidityOfStrategies.value, vault)
  return price.hasPrice ? `$${compactNumber(price.usdValue)}` : price.display
})
const load = async () => {
  vault.strategies.forEach(async (strategy) => {
    const vlt = await getVault(strategy.info.vault)
    const liquidity = vlt.supply - vlt.borrow
    availableLiquidityOfStrategies.value += strategy.allocatedAssets - (liquidity < strategy.allocatedAssets ? strategy.allocatedAssets - liquidity : 0n)
  })
}

load()
</script>

<template>
  <div class="bg-surface-secondary rounded-xl flex flex-col gap-24 p-24 shadow-card">
    <p class="text-h3 text-content-primary">
      Statistics
    </p>
    <div class="flex flex-col items-start gap-24">
      <VaultOverviewLabelValue
        label="Total supply"
        :value="totalSupplyDisplay"
        orientation="horizontal"
      />
      <VaultOverviewLabelValue
        label="Available liquidity"
        :value="availableLiquidityDisplay"
        orientation="horizontal"
      />
      <VaultOverviewLabelValue
        label="Supply APY"
        :value="`${formatNumber((vault.supplyAPY || 0) + (rewardSupplyAPY || 0))}%`"
        orientation="horizontal"
      />
    </div>
  </div>
</template>
