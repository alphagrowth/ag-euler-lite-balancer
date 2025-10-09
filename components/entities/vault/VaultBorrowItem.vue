<script setup lang="ts">
import { type BorrowVaultPair, getVaultPrice } from '~/entities/vault'
import { useEulerProductOfVault } from '~/composables/useEulerLabels'
import { getAssetLogoUrl } from '~/entities/assets'

const { pair } = defineProps<{ pair: BorrowVaultPair }>()

const { name: collateralName } = useEulerProductOfVault(pair.collateral.address)
const { name: borrowName } = useEulerProductOfVault(pair.borrow.address)
const { getOpportunityOfBorrowVault } = useMerkl()

const pairName = computed(() => {
  if (!collateralName || !borrowName) {
    return `${pair.collateral.name}/${pair.borrow.name}`
  }
  if (collateralName === borrowName) {
    return collateralName
  }
  return `${collateralName}/${borrowName}`
})
const opportunityInfo = computed(() => getOpportunityOfBorrowVault(pair.borrow.asset.address))
</script>

<template>
  <NuxtLink
    :to="`/borrow/${pair.collateral.address}/${pair.borrow.address}`"
    :class="$style.VaultItem"
    class="text-white bg-euler-dark-500 br-16"
  >
    <div :class="$style.top">
      <BaseAvatar
        :src="[pair.collateral.asset.symbol, pair.borrow.asset.symbol].map(s => getAssetLogoUrl(s))"
        :label="[pair.collateral.asset.symbol, pair.borrow.asset.symbol]"
        class="icon--40"
      />
      <div :class="$style.topCenter">
        <div class="text-euler-dark-900 p3 mb-4">
          {{ pairName }}
        </div>
        <div class="h5">
          {{ [pair.collateral.asset.symbol, pair.borrow.asset.symbol].join('/') }}
        </div>
      </div>
      <div :class="$style.topRight">
        <div class="text-euler-dark-900 p3 mb-4 right">
          Borrow APY
        </div>
        <div
          :class="$style.apy"
          class="p2"
        >
          <SvgIcon
            v-if="opportunityInfo"
            class="icon--20 text-aquamarine-700 mr-4"
            name="sparks"
          />{{ formatNumber(nanoToValue(pair.borrow.interestRateInfo.borrowAPY, 25) - (opportunityInfo?.apr || 0)) }}%
        </div>
      </div>
    </div>
    <div :class="[$style.bottom, $style._borrow]">
      <div :class="$style.bottomLeft">
        <div class="text-euler-dark-900 p3 mb-4">
          Liquidity
        </div>
        <div class="p2">
          {{ `$${compactNumber(getVaultPrice(pair.borrow.supply - pair.borrow.borrow, pair.borrow))}` }}
        </div>
      </div>
      <div :class="$style.bottomRight">
        <div class="text-euler-dark-900 p3 mb-4">
          LLTV
        </div>
        <div class="p2">
          {{ pair.liquidationLTV / 100n }}%
        </div>
      </div>
    </div>
  </NuxtLink>
</template>

<style lang="scss" module>
.VaultItem {
  display: block;
  text-decoration: none;
}

.top {
  display: flex;
  padding: 16px 16px 12px;
  border-bottom: 1px solid #1B3C5F;
}

.topCenter {
  flex-grow: 1;
  margin-left: 12px;
}

.topRight {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}

.bottom {
  display: flex;
  padding: 12px 16px 16px;

  &._borrow {
    justify-content: space-between;
  }
}

.bottomRight {
  text-align: right;
}

.apy {
  display: flex;
  color: var(--c-aquamarine-700)
}
</style>
