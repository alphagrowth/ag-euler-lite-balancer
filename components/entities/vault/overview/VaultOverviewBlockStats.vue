<script setup lang="ts">
import { getVaultPrice, type Vault } from '~/entities/vault'

const { vault } = defineProps<{ vault: Vault }>()

const { getOpportunityOfBorrowVault, getOpportunityOfLendVault } = useMerkl()
const { withIntrinsicBorrowApy, withIntrinsicSupplyApy } = useIntrinsicApy()
const { borrowList } = useVaults()

const borrowCount = computed(() => {
  return borrowList.value.filter(pair => pair.borrow.address === vault.address).length
})

const isBorrowable = computed(() => borrowCount.value > 0)

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
        v-if="isBorrowable"
        label="Total borrowed"
        :value="`$${compactNumber(calcPrice(vault.borrow))}`"
        orientation="horizontal"
      />
      <VaultOverviewLabelValue
        v-if="isBorrowable"
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
        v-if="isBorrowable"
        label="Borrow APY"
        :value="`${formatNumber(borrowApyWithRewards)}%`"
        orientation="horizontal"
      />
      <VaultOverviewLabelValue
        v-if="isBorrowable"
        label="Utilisation"
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
