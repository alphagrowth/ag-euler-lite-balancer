<script setup lang="ts">
import { type SecuritizeBorrowVaultPair, getVaultPriceInfo } from '~/entities/vault'
import { useModal } from '~/components/ui/composables/useModal'
import { VaultBorrowApyModal } from '#components'

const { pair } = defineProps<{ pair: SecuritizeBorrowVaultPair }>()

const modal = useModal()
const { getOpportunityOfBorrowVault } = useMerkl()
const { getCampaignOfBorrowVault } = useBrevis()
const { withIntrinsicBorrowApy, getIntrinsicApy } = useIntrinsicApy()

const borrowRewardAPY = computed(() => getOpportunityOfBorrowVault(pair.borrow.asset.address)?.apr)
const brevisInfo = computed(() => getCampaignOfBorrowVault(pair.borrow.address))
const totalRewardsAPY = computed(() => (borrowRewardAPY.value || 0) + (brevisInfo.value?.reward_info.apr || 0) * 100)

const borrowApyWithRewards = computed(() => withIntrinsicBorrowApy(
  nanoToValue(pair.borrow.interestRateInfo.borrowAPY, 25),
  pair.borrow.asset.symbol,
) - totalRewardsAPY.value)

const baseBorrowApy = computed(() => nanoToValue(pair.borrow.interestRateInfo.borrowAPY, 25))
const intrinsicBorrowApy = computed(() => getIntrinsicApy(pair.borrow.asset.symbol))
const borrowOpportunityInfo = computed(() => getOpportunityOfBorrowVault(pair.borrow.asset.address))

// Calculate price using collateral prices from borrow vault
const price = computed(() => {
  const collateralPrice = pair.borrow.collateralPrices.find(
    p => p.asset === pair.collateral.address,
  )
  const borrowPrice = getVaultPriceInfo(pair.borrow)

  const ask = collateralPrice?.amountOutAsk || collateralPrice?.amountOutMid || 0n
  const bid = borrowPrice?.amountOutBid || 1n

  if (!ask || !bid) return 0
  return Number(ask) / Number(bid)
})

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
        {{ formatNumber(price) }} <span class="text-euler-dark-900">
          {{ pair.collateral.asset.symbol }}/{{ pair.borrow.asset.symbol }}
        </span>
      </VaultOverviewLabelValue>
      <VaultOverviewLabelValue
        label="Collateral type"
      >
        <span class="bg-euler-dark-600 text-euler-dark-900 px-8 py-2 rounded-4 text-p4">Securitize</span>
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
            name="question-circle"
            @click="onBorrowInfoIconClick"
          />
        </p>
      </VaultOverviewLabelValue>
      <VaultOverviewLabelValue
        label="Max LTV"
        :value="`${formatNumber(nanoToValue(pair.borrowLTV, 2), 2)}%`"
      />
      <VaultOverviewLabelValue
        label="LLTV"
        :value="`${formatNumber(nanoToValue(pair.liquidationLTV, 2), 2)}%`"
      />
    </div>
  </div>
</template>
