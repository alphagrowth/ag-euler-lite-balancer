<script setup lang="ts">
import { getVaultPrice, type Vault } from '~/entities/vault'

const { vault } = defineProps<{ vault: Vault }>()

const { getOpportunityOfBorrowVault, getOpportunityOfLendVault } = useMerkl()
const { withIntrinsicBorrowApy, withIntrinsicSupplyApy } = useIntrinsicApy()

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

const calcPrice = (amount: bigint) => {
  return getVaultPrice(nanoToValue(amount, vault.decimals), vault)
}
</script>

<template>
  <div class="bg-euler-dark-300 rounded-16 flex flex-col gap-24 p-24">
    <p class="text-h3 text-white">
      Statistics
    </p>
    <div class="flex flex-col items-start gap-24">
      <VaultOverviewLabelValue
        label="Total supply"
        :value="`$${compactNumber(calcPrice(vault.supply))}`"
        orientation="horizontal"
      />
      <VaultOverviewLabelValue
        label="Total borrowed"
        :value="`$${compactNumber(calcPrice(vault.borrow))}`"
        orientation="horizontal"
      />
      <VaultOverviewLabelValue
        label="Available liquidity"
        :value="`$${compactNumber(calcPrice(vault.supply - vault.borrow))}`"
        orientation="horizontal"
      />
      <VaultOverviewLabelValue
        label="Supply APY"
        :value="`${formatNumber(supplyApyWithRewards)}%`"
        orientation="horizontal"
      />
      <VaultOverviewLabelValue
        label="Borrow APY"
        :value="`${formatNumber(borrowApyWithRewards)}%`"
        orientation="horizontal"
      />
      <VaultOverviewLabelValue
        label="Utilisation"
        orientation="horizontal"
      >
        <div class="flex gap-4 items-center">
          {{ formatNumber(Number(vault.borrow) / (Number(vault.supply) / 100), 2) }}%

          <UiRadialProgress
            :value="Number(vault.borrow) / Number(vault.supply)"
            :max="1"
          />
        </div>
      </vaultoverviewlabelvalue>
    </div>
  </div>
</template>
