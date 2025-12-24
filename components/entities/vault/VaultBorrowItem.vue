<script setup lang="ts">
import { type BorrowVaultPair, getVaultPrice, getVaultUtilization } from '~/entities/vault'
import { useEulerProductOfVault } from '~/composables/useEulerLabels'
import { getAssetLogoUrl } from '~/composables/useTokens'
import { useModal } from '~/components/ui/composables/useModal'
import { VaultUtilizationWarningModal } from '#components'

const { pair } = defineProps<{ pair: BorrowVaultPair }>()

const { name: collateralName } = useEulerProductOfVault(pair.collateral.address)
const { name: borrowName } = useEulerProductOfVault(pair.borrow.address)
const { getOpportunityOfBorrowVault } = useMerkl()
const { getCampaignOfBorrowVault } = useBrevis()
const modal = useModal()

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
const brevisInfo = computed(() => getCampaignOfBorrowVault(pair.borrow.address))
const totalRewardsAPY = computed(() => (opportunityInfo.value?.apr || 0) + (brevisInfo.value?.reward_info.apr || 0) * 100)
const hasRewards = computed(() => opportunityInfo.value || brevisInfo.value)
const maxLTV = computed(() => formatNumber(nanoToValue(pair.borrowLTV, 2), 2))
const utilization = computed(() => getVaultUtilization(pair.collateral))

const onWarningClick = () => {
  modal.open(VaultUtilizationWarningModal)
}
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
            v-if="hasRewards"
            class="icon--20 text-aquamarine-700 mr-4"
            name="sparks"
          />{{ formatNumber(nanoToValue(pair.borrow.interestRateInfo.borrowAPY, 25) - totalRewardsAPY) }}%
        </div>
      </div>
    </div>
    <div :class="[$style.middle, $style._borrow]">
      <div :class="$style.middleLeft">
        <div class="text-euler-dark-900 p3 mb-4">
          Liquidity
        </div>
        <div class="p2">
          {{ `$${compactNumber(getVaultPrice(pair.borrow.supply - pair.borrow.borrow, pair.borrow))}` }}
        </div>
      </div>
      <div :class="$style.middleCenter">
        <div class="text-euler-dark-900 p3 mb-4">
          Supply APY
        </div>
        <div class="p2">
          {{ formatNumber(nanoToValue(pair.collateral.interestRateInfo.supplyAPY, 25) + totalRewardsAPY) }}%
        </div>
      </div>
      <div
        class="center"
        :class="$style.middleCenterAdditional"
      >
        <div class="text-euler-dark-900 p3 mb-4">
          Max LTV
        </div>
        <div class="p2">
          {{ compactNumber(maxLTV, 2, 2) }}%
        </div>
      </div>
      <div
        class="center"
        :class="$style.middleCenterAdditional"
      >
        <div class="text-euler-dark-900 p3 mb-4">
          Utilization
        </div>
        <div
          :class="$style.middleCenterUtilizationValue"
        >
          <button
            v-if="utilization >= 95"
            :class="[$style.utilWarning, $style._shifted]"
            @click.stop.prevent="onWarningClick"
          >
            <SvgIcon
              name="warning"
              :class="$style.utilWarningIcon"
            />
          </button>
          <UiRadialProgress
            :value="utilization"
            :max="100"
          />
          <div class="p2">
            {{ compactNumber(utilization, 2, 2) }}%
          </div>
        </div>
      </div>
      <div :class="$style.middleRight">
        <div class="text-euler-dark-900 p3 mb-4">
          LLTV
        </div>
        <div class="p2">
          {{ pair.liquidationLTV / 100n }}%
        </div>
      </div>
    </div>
    <div :class="$style.bottom">
      <div :class="$style.bottomItem">
        <div :class="$style.bottomLeft">
          <div class="text-euler-dark-900 p3">
            Max LTV
          </div>
        </div>
        <div
          :class="$style.bottomRight"
        >
          <div class="p2">
            {{ compactNumber(maxLTV, 2, 2) }}%
          </div>
        </div>
      </div>
      <div :class="$style.bottomItem">
        <div :class="$style.bottomLeft">
          <div class="text-euler-dark-900 p3">
            Utilization
          </div>
        </div>
        <div
          :class="$style.bottomRight"
        >
          <button
            v-if="utilization >= 95"
            :class="$style.utilWarning"
            @click.stop.prevent="onWarningClick"
          >
            <SvgIcon
              name="warning"
              :class="$style.utilWarningIcon"
            />
          </button>
          <UiRadialProgress
            :value="utilization"
            :max="100"
          />
          <div class="p2">
            {{ compactNumber(utilization, 2, 2) }}%
          </div>
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
  border-bottom: 1px solid var(--c-border-primary);
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

.middle {
  display: flex;
  padding: 12px 16px 12px;

  @include respond-to(mobile) {
    border-bottom: 1px solid var(--c-border-primary);
  }

  &._borrow {
    justify-content: space-between;
  }
}

.middleCenter {
  text-align: center;
}

.middleCenterAdditional {
  @include respond-to(mobile) {
    display: none;
  }
}

.middleCenterUtilizationValue {
  display: flex;
  gap: 8px;
  justify-content: end;
  align-items: center;
  text-align: right;
}

.middleRight {
  text-align: right;
}

.bottom {
  display: none;

  @include respond-to(mobile) {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 12px 16px 16px;
  }
}

.bottomItem {
  display: flex;
  width: 100%;
  justify-content: space-between;
}

.bottomLeft {
  flex: 1;
}

.bottomRight {
  display: flex;
  gap: 8px;
  justify-content: end;
  align-items: center;
  text-align: right;
  flex: 1;
}

.utilWarning {
  display: flex;
  justify-content: center;
  align-items: center;
  width: 20px;
  height: 20px;
  background-color: #3e4540;
  color: var(--c-yellow-600);
  border-radius: 4px;
  cursor: pointer;
}

.utilWarningIcon {
  width: 16px;
  height: 16px;
}
</style>
