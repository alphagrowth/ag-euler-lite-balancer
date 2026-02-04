<script setup lang="ts">
import { type Vault } from '~/entities/vault'
import { formatAssetValue } from '~/services/pricing/priceProvider'

const { vault } = defineProps<{ vault: Vault }>()

const { getOpportunityOfBorrowVault, getOpportunityOfLendVault } = useMerkl()
const { withIntrinsicBorrowApy, withIntrinsicSupplyApy } = useIntrinsicApy()
const isBorrowable = computed(() => vault.collateralLTVs.some(ltv => ltv.borrowLTV > 0n))

const rewardBorrowAPY = computed(() => getOpportunityOfBorrowVault(vault.asset.address)?.apr)
const rewardSupplyAPY = computed(() => getOpportunityOfLendVault(vault.address)?.apr)
const supplyApyWithRewards = computed(() => withIntrinsicSupplyApy(
  nanoToValue(vault.interestRateInfo.supplyAPY, 25),
  vault.asset.symbol,
) + (rewardSupplyAPY.value || 0))
const borrowApyWithRewards = computed(() => withIntrinsicBorrowApy(
  nanoToValue(vault.interestRateInfo.borrowAPY, 25),
  vault.asset.symbol,
) - (rewardBorrowAPY.value || 0))

const formatPrice = (amount: bigint) => {
  const price = formatAssetValue(amount, vault)
  return price.hasPrice ? formatCompactUsdValue(price.usdValue) : price.display
}
</script>

<template>
  <div class="bg-surface-secondary rounded-xl flex flex-col gap-24 p-24 shadow-card">
    <p class="text-h3 text-content-primary">
      Statistics
    </p>
    <div class="flex flex-col items-start gap-24">
      <VaultOverviewLabelValue
        label="Total supply"
        :value="formatPrice(vault.supply)"
        orientation="horizontal"
      />
      <VaultOverviewLabelValue
        v-if="isBorrowable"
        label="Total borrowed"
        :value="formatPrice(vault.borrow)"
        orientation="horizontal"
      />
      <VaultOverviewLabelValue
        v-if="isBorrowable"
        label="Available liquidity"
        :value="formatPrice(vault.supply - vault.borrow)"
        orientation="horizontal"
      />
      <VaultOverviewLabelValue
        label="Supply APY"
        :value="`${formatNumber(supplyApyWithRewards)}%`"
        orientation="horizontal"
      />
      <VaultOverviewLabelValue
        v-if="isBorrowable"
        label="Borrow APY"
        :value="`${formatNumber(borrowApyWithRewards)}%`"
        orientation="horizontal"
      />
      <VaultOverviewLabelValue
        v-if="isBorrowable"
        label="Utilization"
        orientation="horizontal"
      >
        <div class="flex gap-4 items-center">
          {{ Number(vault.supply) > 0 ? formatNumber(Number(vault.borrow) / (Number(vault.supply) / 100), 2) : '0.00' }}%

          <UiRadialProgress
            :value="Number(vault.supply) > 0 ? Number(vault.borrow) / Number(vault.supply) : 0"
            :max="1"
          />
        </div>
      </vaultoverviewlabelvalue>
    </div>
  </div>
</template>
