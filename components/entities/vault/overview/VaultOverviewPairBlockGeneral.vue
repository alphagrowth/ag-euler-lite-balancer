<script setup lang="ts">
import { type AnyBorrowVaultPair } from '~/entities/vault'
import { isAnyVaultBlockedByCountry } from '~/composables/useGeoBlock'
import { isVaultDeprecated } from '~/composables/useEulerLabels'
import { getCollateralOraclePrice, getAssetOraclePrice } from '~/services/pricing/priceProvider'
import { formatNumber, formatSignificant } from '~/utils/string-utils'
import { nanoToValue } from '~/utils/crypto-utils'
import { getMaxMultiplier, getMaxRoe } from '~/utils/leverage'
import type { AccountBorrowPosition } from '~/entities/account'
import { useModal } from '~/components/ui/composables/useModal'
import { VaultNetApyPairModal, VaultMaxRoeModal } from '#components'

const { pair } = defineProps<{ pair: AnyBorrowVaultPair | AccountBorrowPosition }>()

const modal = useModal()
const { withIntrinsicBorrowApy, withIntrinsicSupplyApy, getIntrinsicApy } = useIntrinsicApy()
const { getSupplyRewardApy, getBorrowRewardApy, hasSupplyRewards, hasBorrowRewards } = useRewardsApy()
const { borrowList } = useVaults()

const borrowCount = computed(() => {
  return borrowList.value.filter(p => p.borrow.address === pair.borrow.address).length
})

const isBorrowable = computed(() => borrowCount.value > 0)
const isRestricted = computed(() => isAnyVaultBlockedByCountry(pair.collateral.address, pair.borrow.address))
const isDeprecated = computed(() => isVaultDeprecated(pair.collateral.address) || isVaultDeprecated(pair.borrow.address))

const collateralRewardAPY = computed(() => getSupplyRewardApy(pair.collateral.address))
const borrowRewardAPY = computed(() => getBorrowRewardApy(pair.borrow.address, pair.collateral.address))
const supplyApyWithRewards = computed(() => withIntrinsicSupplyApy(
  nanoToValue(pair.collateral.interestRateInfo.supplyAPY, 25),
  pair.collateral.asset.symbol,
) + collateralRewardAPY.value)
const borrowApyWithRewards = computed(() => withIntrinsicBorrowApy(
  nanoToValue(pair.borrow.interestRateInfo.borrowAPY, 25),
  pair.borrow.asset.symbol,
) - borrowRewardAPY.value)

const maxMultiplier = computed(() => getMaxMultiplier(pair.borrowLTV))
const netApy = computed(() => supplyApyWithRewards.value - borrowApyWithRewards.value)
const maxRoe = computed(() =>
  getMaxRoe(maxMultiplier.value, supplyApyWithRewards.value, borrowApyWithRewards.value),
)

const baseSupplyApy = computed(() => nanoToValue(pair.collateral.interestRateInfo.supplyAPY, 25))
const baseBorrowApy = computed(() => nanoToValue(pair.borrow.interestRateInfo.borrowAPY, 25))
const intrinsicSupplyApy = computed(() => getIntrinsicApy(pair.collateral.asset.symbol))
const intrinsicBorrowApy = computed(() => getIntrinsicApy(pair.borrow.asset.symbol))

const priceInvert = usePriceInvert(
  () => pair.collateral.asset.symbol,
  () => pair.borrow.asset.symbol,
)

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
      <div
        v-if="isDeprecated"
        class="w-full rounded-12 p-16 bg-warning-100 text-warning-500"
      >
        <div class="flex items-start gap-8">
          <SvgIcon name="warning" class="!w-20 !h-20 flex-shrink-0 mt-2" />
          <p class="text-p3 text-warning-500">One or more vaults in this pair have been deprecated.</p>
        </div>
      </div>
      <div
        v-if="isRestricted"
        class="w-full rounded-12 p-16 bg-warning-100 text-warning-500"
      >
        <div class="flex items-start gap-8">
          <SvgIcon name="warning" class="!w-20 !h-20 flex-shrink-0 mt-2" />
          <p class="text-p3 text-warning-500">This vault is not available in your region.</p>
        </div>
      </div>
      <VaultOverviewLabelValue
        label="Price"
      >
        <template v-if="price !== null">
          {{ formatSignificant(priceInvert.invertValue(price), 4) }}
          <span class="text-content-tertiary">{{ priceInvert.displaySymbol }}</span>
          <button type="button" class="ml-4 text-content-tertiary hover:text-content-primary transition-colors inline-flex" @click.stop="priceInvert.toggle">
            <SvgIcon name="swap-horizontal" class="!w-12 !h-12" />
          </button>
        </template>
        <template v-else>
          <span class="flex items-center text-warning-500">
            <SvgIcon name="warning" class="mr-2 !w-20 !h-20" />
            Unknown
          </span>
        </template>
      </VaultOverviewLabelValue>
      <VaultOverviewLabelValue>
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
        <span class="flex items-center gap-4">
          <SvgIcon
            v-if="hasSupplyRewards(pair.collateral.address) || hasBorrowRewards(pair.borrow.address, pair.collateral.address)"
            class="!w-20 !h-20 text-accent-500 cursor-pointer"
            name="sparks"
            @click="onNetApyInfoIconClick"
          />
          {{ formatNumber(netApy) }}%
        </span>
      </VaultOverviewLabelValue>
      <VaultOverviewLabelValue
        v-if="isBorrowable"
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
        <span class="flex items-center gap-4">
          <SvgIcon
            v-if="hasSupplyRewards(pair.collateral.address) || hasBorrowRewards(pair.borrow.address, pair.collateral.address)"
            class="!w-20 !h-20 text-accent-500 cursor-pointer"
            name="sparks"
            @click="onMaxRoeInfoIconClick"
          />
          {{ formatNumber(maxRoe) }}%
        </span>
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
