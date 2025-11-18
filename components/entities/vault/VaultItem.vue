<script setup lang="ts">
import { getVaultPrice, type Vault } from '~/entities/vault'
import { useEulerEntitiesOfVault, useEulerProductOfVault } from '~/composables/useEulerLabels'
import { getEulerLabelEntityLogo } from '~/entities/euler/labels'
import { getAssetLogoUrl } from '~/entities/assets'
import BaseLoadableContent from '~/components/base/BaseLoadableContent.vue'

const { isConnected } = useWagmi()
const { vault } = defineProps<{ vault: Vault }>()
const { name } = useEulerProductOfVault(vault.address)
const entities = useEulerEntitiesOfVault(vault.address)
const { balances, isLoading: isBalancesLoading } = useWallets()
const { getOpportunityOfLendVault } = useMerkl()
const { getCampaignOfLendVault } = useBrevis()

const entitiesLabels = computed(() => entities.map(e => e.name))
const entitiesLogos = computed(() => entities.map(e => getEulerLabelEntityLogo(e.logo)))

const balance = computed(() => balances.value.get(vault.asset.address) || 0n)
const opportunityInfo = computed(() => getOpportunityOfLendVault(vault.address))
const brevisInfo = computed(() => getCampaignOfLendVault(vault.address))
const totalRewardsAPY = computed(() => (opportunityInfo.value?.apr || 0) + (brevisInfo.value?.reward_info.apr || 0) * 100)
const hasRewards = computed(() => opportunityInfo.value || brevisInfo.value)
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
    <div :class="$style.bottom">
      <div :class="$style.bottomLeft">
        <div class="text-euler-dark-900 p3 mb-4">
          Total supply
        </div>
        <div class="p2">
          {{ `$${compactNumber(getVaultPrice(vault.totalAssets, vault))}` }}
        </div>
      </div>
      <div :class="$style.bottomCenter">
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
        :class="$style.bottomRight"
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
}

.bottomLeft {
  flex: 1;
}

.bottomCenter {
  display: flex;
  flex-direction: column;
  align-items: center;
  flex: 1;
}

.bottomRight {
  align-items: end;
  text-align: right;
  flex: 1;
}

.apy {
  display: flex;
  color: var(--c-aquamarine-700)
}
</style>
