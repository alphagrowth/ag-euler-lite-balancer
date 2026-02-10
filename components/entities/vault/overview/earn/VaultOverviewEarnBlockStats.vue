<script setup lang="ts">
import { type EarnVault } from '~/entities/vault'
import { formatAssetValue } from '~/services/pricing/priceProvider'
import { formatNumber, compactNumber, formatCompactUsdValue } from '~/utils/string-utils'
import { nanoToValue } from '~/utils/crypto-utils'

const { vault } = defineProps<{ vault: EarnVault }>()

const { getVault } = useVaults()
const { getSupplyRewardApy } = useRewardsApy()

const availableLiquidityOfStrategies = ref(0n)

const rewardSupplyAPY = computed(() => getSupplyRewardApy(vault.address))

const totalSupplyDisplay = ref('-')

watchEffect(async () => {
  const price = await formatAssetValue(vault.totalAssets, vault, 'off-chain')
  totalSupplyDisplay.value = price.hasPrice ? formatCompactUsdValue(price.usdValue) : price.display
})

const availableLiquidityDisplay = ref('-')

watchEffect(async () => {
  const price = await formatAssetValue(availableLiquidityOfStrategies.value, vault, 'off-chain')
  availableLiquidityDisplay.value = price.hasPrice ? formatCompactUsdValue(price.usdValue) : price.display
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
        :value="`${formatNumber(nanoToValue(vault.interestRateInfo.supplyAPY, 25) + rewardSupplyAPY)}%`"
        orientation="horizontal"
      />
    </div>
  </div>
</template>
