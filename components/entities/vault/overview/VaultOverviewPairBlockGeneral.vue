<script setup lang="ts">
import { type AnyBorrowVaultPair } from '~/entities/vault'
import { getCollateralOraclePrice, getAssetOraclePrice } from '~/services/pricing/priceProvider'
import { nanoToValue } from '~/utils/crypto-utils'
import { getMaxMultiplier, getMaxRoe } from '~/utils/leverage'
import type { AccountBorrowPosition } from '~/entities/account'
import { useModal } from '~/components/ui/composables/useModal'
import { VaultNetApyPairModal, VaultMaxRoeModal } from '#components'

const { pair } = defineProps<{ pair: AnyBorrowVaultPair | AccountBorrowPosition }>()

const modal = useModal()
const { getOpportunityOfBorrowVault, getOpportunityOfLendVault } = useMerkl()
const { withIntrinsicBorrowApy, withIntrinsicSupplyApy, getIntrinsicApy } = useIntrinsicApy()
const { borrowList } = useVaults()

const borrowCount = computed(() => {
  return borrowList.value.filter(p => p.borrow.address === pair.borrow.address).length
})

const isBorrowable = computed(() => borrowCount.value > 0)

const borrowRewardAPY = computed(() => getOpportunityOfBorrowVault(pair.borrow.asset.address)?.apr)
const collateralRewardAPY = computed(() => getOpportunityOfLendVault(pair.collateral.address)?.apr)
const supplyApyWithRewards = computed(() => withIntrinsicSupplyApy(
  nanoToValue(pair.collateral.interestRateInfo.supplyAPY, 25),
  pair.collateral.asset.symbol,
) + (collateralRewardAPY.value || 0))
const borrowApyWithRewards = computed(() => withIntrinsicBorrowApy(
  nanoToValue(pair.borrow.interestRateInfo.borrowAPY, 25),
  pair.borrow.asset.symbol,
) - (borrowRewardAPY.value || 0))

const maxMultiplier = computed(() => getMaxMultiplier(pair.borrowLTV))
const netApy = computed(() => supplyApyWithRewards.value - borrowApyWithRewards.value)
const maxRoe = computed(() =>
  getMaxRoe(maxMultiplier.value, supplyApyWithRewards.value, borrowApyWithRewards.value),
)

const baseSupplyApy = computed(() => nanoToValue(pair.collateral.interestRateInfo.supplyAPY, 25))
const baseBorrowApy = computed(() => nanoToValue(pair.borrow.interestRateInfo.borrowAPY, 25))
const intrinsicSupplyApy = computed(() => getIntrinsicApy(pair.collateral.asset.symbol))
const intrinsicBorrowApy = computed(() => getIntrinsicApy(pair.borrow.asset.symbol))
const supplyOpportunityInfo = computed(() => getOpportunityOfLendVault(pair.collateral.address))
const borrowOpportunityInfo = computed(() => getOpportunityOfBorrowVault(pair.borrow.asset.address))

const price = computed(() => {
  const collateralPrice = getCollateralOraclePrice(pair.borrow, pair.collateral)
  const borrowPrice = getAssetOraclePrice(pair.borrow)

  // Check for 0n in denominator to prevent division by zero
  if (!collateralPrice || !borrowPrice || borrowPrice.amountOutMid === 0n) {
    return null
  }

  return nanoToValue(collateralPrice.amountOutMid, 18) / nanoToValue(borrowPrice.amountOutMid, 18)
})

const onNetApyInfoIconClick = () => {
  modal.open(VaultNetApyPairModal, {
    props: {
      supplyAPY: baseSupplyApy.value,
      borrowAPY: baseBorrowApy.value,
      intrinsicSupplyAPY: intrinsicSupplyApy.value,
      intrinsicBorrowAPY: intrinsicBorrowApy.value,
      supplyRewardAPY: collateralRewardAPY.value || null,
      borrowRewardAPY: borrowRewardAPY.value || null,
    },
  })
}

const onMaxRoeInfoIconClick = () => {
  modal.open(VaultMaxRoeModal, {
    props: {
      maxRoe: maxRoe.value,
      maxMultiplier: maxMultiplier.value,
      supplyAPY: supplyApyWithRewards.value,
      borrowAPY: borrowApyWithRewards.value,
      borrowLTV: nanoToValue(pair.borrowLTV, 2),
    },
  })
}
</script>

<template>
  <div class="bg-surface-secondary rounded-xl flex flex-col gap-24 p-24 shadow-card">
    <p class="text-h3 text-content-primary">
      Overview
    </p>
    <div class="flex flex-col items-start gap-24">
      <VaultOverviewLabelValue
        label="Price"
      >
        <template v-if="price !== null">
          {{ formatSignificant(price, 4) }} <span class="text-content-tertiary">
            {{ pair.collateral.asset.symbol }}/{{ pair.borrow.asset.symbol }}
          </span>
        </template>
        <template v-else>
          <span class="flex items-center text-warning-500">
            <SvgIcon name="warning" class="mr-2 !w-20 !h-20" />
            Unknown
          </span>
        </template>
      </VaultOverviewLabelValue>
      <VaultOverviewLabelValue
        :value="`${formatNumber(netApy)}%`"
      >
        <template #label>
          <span class="flex items-center gap-4">
            Net APY
            <SvgIcon
              class="!w-20 !h-20 text-content-muted cursor-pointer hover:text-content-secondary"
              name="info-circle"
              @click="onNetApyInfoIconClick"
            />
          </span>
        </template>
      </VaultOverviewLabelValue>
      <VaultOverviewLabelValue
        v-if="isBorrowable"
        :value="`${formatNumber(maxRoe)}%`"
      >
        <template #label>
          <span class="flex items-center gap-4">
            Max ROE
            <SvgIcon
              class="!w-20 !h-20 text-content-muted cursor-pointer hover:text-content-secondary"
              name="info-circle"
              @click="onMaxRoeInfoIconClick"
            />
          </span>
        </template>
      </VaultOverviewLabelValue>
      <VaultOverviewLabelValue
        v-if="isBorrowable"
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
