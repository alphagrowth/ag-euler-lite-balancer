<script setup lang="ts">
import { getVaultPrice, getVaultUtilization, type Vault } from '~/entities/vault'
import { useEulerEntitiesOfVault, useEulerProductOfVault } from '~/composables/useEulerLabels'
import { getEulerLabelEntityLogo } from '~/entities/euler/labels'
import { getAssetLogoUrl } from '~/composables/useTokens'
import BaseLoadableContent from '~/components/base/BaseLoadableContent.vue'
import { useModal } from '~/components/ui/composables/useModal'
import { VaultUtilizationWarningModal } from '#components'

const { isConnected } = useWagmi()
const { vault } = defineProps<{ vault: Vault }>()
const { name } = useEulerProductOfVault(vault.address)
const entities = useEulerEntitiesOfVault(vault.address)
const { balances, isLoading: isBalancesLoading } = useWallets()
const { getOpportunityOfLendVault } = useMerkl()
const { getCampaignOfLendVault } = useBrevis()
const modal = useModal()

const entitiesLabels = computed(() => entities.map(e => e.name))
const entitiesLogos = computed(() => entities.map(e => getEulerLabelEntityLogo(e.logo)))

const balance = computed(() => balances.value.get(vault.asset.address) || 0n)
const opportunityInfo = computed(() => getOpportunityOfLendVault(vault.address))
const brevisInfo = computed(() => getCampaignOfLendVault(vault.address))
const totalRewardsAPY = computed(() => (opportunityInfo.value?.apr || 0) + (brevisInfo.value?.reward_info.apr || 0) * 100)
const hasRewards = computed(() => opportunityInfo.value || brevisInfo.value)
const utilization = computed(() => getVaultUtilization(vault))

const onWarningClick = () => {
  modal.open(VaultUtilizationWarningModal)
}
</script>

<template>
  <NuxtLink
    :class="$style.VaultItem"
    :to="`/lend/${vault.address}`"
    class="text-white bg-euler-dark-500 br-16"
  >
    <div :class="$style.top">
      <BaseAvatar
        class="icon--40"
        :src="getAssetLogoUrl(vault.asset.symbol)"
        :label="vault.asset.symbol"
      />
      <div :class="$style.topCenter">
        <div class="text-euler-dark-900 p3 mb-4">
          {{ name || vault.name }}
        </div>
        <div class="h5">
          {{ vault.asset.symbol }}
        </div>
      </div>
      <div :class="$style.topRight">
        <div class="text-euler-dark-900 p3 mb-4 right">
          Supply APY
        </div>
        <div
          :class="[$style.apy, nanoToValue(vault.interestRateInfo.supplyAPY, 25) <= 0 ? 'text-red-700' : 'text-aquamarine-700']"
          class="p2"
        >
          <SvgIcon
            v-if="hasRewards"
            class="icon--20 text-aquamarine-700 mr-4"
            name="sparks"
          />
          {{ formatNumber(nanoToValue(vault.interestRateInfo.supplyAPY, 25) + totalRewardsAPY) }}%
        </div>
      </div>
    </div>
    <div :class="$style.middle">
      <div :class="$style.middleLeft">
        <div class="text-euler-dark-900 p3 mb-4">
          Total supply
        </div>
        <div class="p2">
          {{ `$${compactNumber(getVaultPrice(vault.totalAssets, vault))}` }}
        </div>
      </div>
      <div :class="$style.middleCenter">
        <div class="text-euler-dark-900 p3 mb-4">
          Governor
        </div>
        <BaseAvatar
          class="icon--20"
          :label="entitiesLabels"
          :src="entitiesLogos"
        />
      </div>
      <div
        :class="$style.middleRight"
        class="column"
      >
        <template v-if="isConnected">
          <div class="text-euler-dark-900 p3 mb-4">
            In wallet
          </div>
          <BaseLoadableContent
            :loading="isBalancesLoading"
            style="width: 70px; height: 20px"
          >
            <div class="p2">
              ${{ compactNumber(getVaultPrice(balance, vault)) }}
            </div>
          </BaseLoadableContent>
        </template>
      </div>
    </div>
    <div :class="$style.bottom">
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
          :class="$style.bottomUtilWarning"
          @click.stop.prevent="onWarningClick"
        >
          <SvgIcon
            name="warning"
            :class="$style.bottomUtilWarningIcon"
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

.middle {
  display: flex;
  padding: 12px 16px 12px;
  border-bottom: 1px solid #1B3C5F;
}

.middleLeft {
  flex: 1;
}

.middleCenter {
  display: flex;
  flex-direction: column;
  align-items: center;
  flex: 1;
}

.middleRight {
  align-items: end;
  text-align: right;
  flex: 1;
}

.bottom {
  display: flex;
  padding: 12px 16px 16px;
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

.bottomUtilWarning {
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

.bottomUtilWarningIcon {
  width: 16px;
  height: 16px;
}

.apy {
  display: flex;
  color: var(--c-aquamarine-700)
}
</style>
