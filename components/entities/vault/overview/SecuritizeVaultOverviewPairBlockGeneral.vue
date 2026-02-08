<script setup lang="ts">
import { type SecuritizeBorrowVaultPair } from '~/entities/vault'
import { getAssetOraclePrice } from '~/services/pricing/priceProvider'
import { getMaxMultiplier, getMaxRoe } from '~/utils/leverage'
import { useModal } from '~/components/ui/composables/useModal'
import { VaultBorrowApyModal, VaultSupplyApyModal } from '#components'

const { pair } = defineProps<{ pair: SecuritizeBorrowVaultPair }>()

const modal = useModal()
const { getOpportunityOfBorrowVault, getOpportunityOfLendVault } = useMerkl()
const { getCampaignOfBorrowVault } = useBrevis()
const { withIntrinsicBorrowApy, getIntrinsicApy } = useIntrinsicApy()

// Borrow APY (from EVK borrow vault)
const borrowRewardAPY = computed(() => getOpportunityOfBorrowVault(pair.borrow.asset.address)?.apr)
const brevisInfo = computed(() => getCampaignOfBorrowVault(pair.borrow.address))
const totalBorrowRewardsAPY = computed(() => (borrowRewardAPY.value || 0) + (brevisInfo.value?.reward_info.apr || 0) * 100)

const borrowApyWithRewards = computed(() => withIntrinsicBorrowApy(
  nanoToValue(pair.borrow.interestRateInfo.borrowAPY, 25),
  pair.borrow.asset.symbol,
) - totalBorrowRewardsAPY.value)

const baseBorrowApy = computed(() => nanoToValue(pair.borrow.interestRateInfo.borrowAPY, 25))
const intrinsicBorrowApy = computed(() => getIntrinsicApy(pair.borrow.asset.symbol))
const borrowOpportunityInfo = computed(() => getOpportunityOfBorrowVault(pair.borrow.asset.address))

// Supply APY (for securitize collateral - intrinsic + rewards only, no interest rate)
const collateralRewardAPY = computed(() => getOpportunityOfLendVault(pair.collateral.address)?.apr || 0)
const intrinsicSupplyApy = computed(() => getIntrinsicApy(pair.collateral.asset.symbol, 'supply'))
const supplyApyWithRewards = computed(() => intrinsicSupplyApy.value + collateralRewardAPY.value)
const supplyOpportunityInfo = computed(() => getOpportunityOfLendVault(pair.collateral.address))

const maxMultiplier = computed(() => getMaxMultiplier(pair.borrowLTV))
const maxRoe = computed(() =>
  getMaxRoe(maxMultiplier.value, supplyApyWithRewards.value, borrowApyWithRewards.value),
)

// Calculate price using collateral prices from borrow vault
const price = computed(() => {
  const collateralPrice = pair.borrow.collateralPrices.find(
    p => p.asset === pair.collateral.address,
  )
  const borrowPrice = getAssetOraclePrice(pair.borrow)

  const ask = collateralPrice?.amountOutAsk || collateralPrice?.amountOutMid || 0n
  const bid = borrowPrice?.amountOutBid || borrowPrice?.amountOutMid || 0n

  if (!ask || !bid || bid === 0n) return null
  return Number(ask) / Number(bid)
})

const onSupplyInfoIconClick = () => {
  modal.open(VaultSupplyApyModal, {
    props: {
      lendingAPY: 0, // Securitize vaults don't have interest rates
      intrinsicAPY: intrinsicSupplyApy.value,
      opportunityInfo: supplyOpportunityInfo.value,
    },
  })
}

const onBorrowInfoIconClick = () => {
  modal.open(VaultBorrowApyModal, {
    props: {
      borrowingAPY: baseBorrowApy.value,
      intrinsicAPY: intrinsicBorrowApy.value,
      opportunityInfo: borrowOpportunityInfo.value,
    },
  })
}
</script>

<template>
  <div class="bg-euler-dark-300 rounded-16 flex flex-col gap-24 p-24">
    <p class="text-h3 text-white">
      Overview
    </p>
    <div class="flex flex-col items-start gap-24">
      <VaultOverviewLabelValue
        label="Price"
      >
        <template v-if="price !== null">
          {{ formatSignificant(price, 4) }} <span class="text-euler-dark-900">
            {{ pair.collateral.asset.symbol }}/{{ pair.borrow.asset.symbol }}
          </span>
        </template>
        <template v-else>
          <span class="text-euler-dark-900">-</span>
        </template>
      </VaultOverviewLabelValue>
      <VaultOverviewLabelValue
        label="Supply APY"
      >
        <p class="flex items-center gap-4">
          <span>
            {{ formatNumber(supplyApyWithRewards) }}%
          </span>
          <SvgIcon
            class="!w-20 !h-20 text-euler-dark-800 cursor-pointer"
            name="info-circle"
            @click="onSupplyInfoIconClick"
          />
        </p>
      </VaultOverviewLabelValue>
      <VaultOverviewLabelValue
        label="Borrow APY"
      >
        <p class="flex items-center gap-4">
          <span>
            {{ formatNumber(borrowApyWithRewards) }}%
          </span>
          <SvgIcon
            class="!w-20 !h-20 text-euler-dark-800 cursor-pointer"
            name="info-circle"
            @click="onBorrowInfoIconClick"
          />
        </p>
      </VaultOverviewLabelValue>
      <VaultOverviewLabelValue
        label="Max ROE"
        :value="`${formatNumber(maxRoe, 2, 2)}%`"
      />
      <VaultOverviewLabelValue
        label="Max Multiplier"
        :value="`${formatNumber(maxMultiplier, 2, 2)}x`"
      />
      <VaultOverviewLabelValue
        label="Max LTV"
        :value="`${formatNumber(nanoToValue(pair.borrowLTV, 2), 2)}%`"
      />
      <VaultOverviewLabelValue
        label="Liquidation LTV"
        :value="`${formatNumber(nanoToValue(pair.liquidationLTV, 2), 2)}%`"
      />
    </div>
  </div>
</template>
