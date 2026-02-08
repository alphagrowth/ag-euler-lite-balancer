<script setup lang="ts">
import { type Vault } from '~/entities/vault'
import { formatAssetValue } from '~/services/pricing/priceProvider'
import { useModal } from '~/components/ui/composables/useModal'
import { VaultSupplyApyModal, VaultBorrowApyModal } from '#components'

const { vault } = defineProps<{ vault: Vault }>()

const modal = useModal()
const { getOpportunityOfBorrowVault, getOpportunityOfLendVault } = useMerkl()
const { getCampaignOfBorrowVault } = useBrevis()
const { withIntrinsicBorrowApy, withIntrinsicSupplyApy, getIntrinsicApy } = useIntrinsicApy()
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

const supplyOpportunityInfo = computed(() => getOpportunityOfLendVault(vault.address))
const borrowOpportunityInfo = computed(() => getOpportunityOfBorrowVault(vault.asset.address))
const brevisInfo = computed(() => getCampaignOfBorrowVault(vault.address))

const onSupplyInfoIconClick = () => {
  modal.open(VaultSupplyApyModal, {
    props: {
      lendingAPY: nanoToValue(vault.interestRateInfo.supplyAPY, 25),
      intrinsicAPY: getIntrinsicApy(vault.asset.symbol),
      opportunityInfo: supplyOpportunityInfo.value,
      brevisInfo: brevisInfo.value,
    },
  })
}

const onBorrowInfoIconClick = () => {
  modal.open(VaultBorrowApyModal, {
    props: {
      borrowingAPY: nanoToValue(vault.interestRateInfo.borrowAPY, 25),
      intrinsicAPY: getIntrinsicApy(vault.asset.symbol),
      opportunityInfo: borrowOpportunityInfo.value,
    },
  })
}

const totalSupplyDisplay = ref('-')
const totalBorrowedDisplay = ref('-')
const availableLiquidityDisplay = ref('-')

watchEffect(async () => {
  const price = await formatAssetValue(vault.supply, vault, 'off-chain')
  totalSupplyDisplay.value = price.hasPrice ? formatCompactUsdValue(price.usdValue) : price.display
})

watchEffect(async () => {
  const price = await formatAssetValue(vault.borrow, vault, 'off-chain')
  totalBorrowedDisplay.value = price.hasPrice ? formatCompactUsdValue(price.usdValue) : price.display
})

watchEffect(async () => {
  const price = await formatAssetValue(vault.supply - vault.borrow, vault, 'off-chain')
  availableLiquidityDisplay.value = price.hasPrice ? formatCompactUsdValue(price.usdValue) : price.display
})
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
        v-if="isBorrowable"
        label="Total borrowed"
        :value="totalBorrowedDisplay"
        orientation="horizontal"
      />
      <VaultOverviewLabelValue
        v-if="isBorrowable"
        label="Available liquidity"
        :value="availableLiquidityDisplay"
        orientation="horizontal"
      />
      <VaultOverviewLabelValue
        orientation="horizontal"
        :value="`${formatNumber(supplyApyWithRewards)}%`"
      >
        <template #label>
          <span class="flex items-center gap-4">
            Supply APY
            <SvgIcon
              class="!w-20 !h-20 text-content-muted cursor-pointer hover:text-content-secondary"
              name="info-circle"
              @click="onSupplyInfoIconClick"
            />
          </span>
        </template>
      </VaultOverviewLabelValue>
      <VaultOverviewLabelValue
        v-if="isBorrowable"
        orientation="horizontal"
        :value="`${formatNumber(borrowApyWithRewards)}%`"
      >
        <template #label>
          <span class="flex items-center gap-4">
            Borrow APY
            <SvgIcon
              class="!w-20 !h-20 text-content-muted cursor-pointer hover:text-content-secondary"
              name="info-circle"
              @click="onBorrowInfoIconClick"
            />
          </span>
        </template>
      </VaultOverviewLabelValue>
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
      </VaultOverviewLabelValue>
    </div>
  </div>
</template>
