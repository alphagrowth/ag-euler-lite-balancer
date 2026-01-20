<script setup lang="ts">
import { getVaultPrice, getVaultUtilization, type Vault } from '~/entities/vault'
import { useEulerEntitiesOfVault, useEulerProductOfVault, useEulerVaultLabelOfVault } from '~/composables/useEulerLabels'
import { getEulerLabelEntityLogo } from '~/entities/euler/labels'
import { getAssetLogoUrl } from '~/composables/useTokens'
import BaseLoadableContent from '~/components/base/BaseLoadableContent.vue'
import { useModal } from '~/components/ui/composables/useModal'
import { VaultUtilizationWarningModal } from '#components'

const { isConnected } = useWagmi()
const { vault } = defineProps<{ vault: Vault }>()
const product = useEulerProductOfVault(vault.address)
const vaultLabel = useEulerVaultLabelOfVault(vault.address)
const displayName = computed(() => vaultLabel.name || product.name || vault.name)
const entities = useEulerEntitiesOfVault(vault.address)
const { balances, isLoading: isBalancesLoading } = useWallets()
const { getOpportunityOfLendVault } = useMerkl()
const { getCampaignOfLendVault } = useBrevis()
const { withIntrinsicSupplyApy } = useIntrinsicApy()
const modal = useModal()

const entitiesLabels = computed(() => entities.map(e => e.name))
const entitiesLogos = computed(() => entities.map(e => getEulerLabelEntityLogo(e.logo)))

const balance = computed(() => balances.value.get(vault.asset.address) || 0n)
const opportunityInfo = computed(() => getOpportunityOfLendVault(vault.address))
const brevisInfo = computed(() => getCampaignOfLendVault(vault.address))
const totalRewardsAPY = computed(() => (opportunityInfo.value?.apr || 0) + (brevisInfo.value?.reward_info.apr || 0) * 100)
const hasRewards = computed(() => opportunityInfo.value || brevisInfo.value)
const supplyApy = computed(() => withIntrinsicSupplyApy(
  nanoToValue(vault.interestRateInfo.supplyAPY, 25),
  vault.asset.symbol,
))
const supplyApyWithRewards = computed(() => supplyApy.value + totalRewardsAPY.value)
const utilization = computed(() => getVaultUtilization(vault))

const onWarningClick = () => {
  modal.open(VaultUtilizationWarningModal)
}
</script>

<template>
  <NuxtLink
    class="block no-underline text-white bg-euler-dark-500 rounded-16"
    :to="`/lend/${vault.address}`"
  >
    <div class="flex pb-12 p-16 border-b border-border-primary">
      <BaseAvatar
        class="icon--40"
        :src="getAssetLogoUrl(vault.asset.symbol)"
        :label="vault.asset.symbol"
      />
      <div class="flex-grow ml-12">
        <div class="text-euler-dark-900 text-p3 mb-4">
          {{ displayName }}
        </div>
        <div class="text-h5">
          {{ vault.asset.symbol }}
        </div>
      </div>
      <div class="flex flex-col items-end">
        <div class="text-euler-dark-900 text-p3 mb-4 text-right">
          Supply APY
        </div>
        <div
          class="text-p2 flex items-center text-aquamarine-700"
        >
          <div class="mr-6">
            <VaultPoints :vault="vault" />
          </div>
          <SvgIcon
            v-if="hasRewards"
            class="!w-20 !h-20 text-aquamarine-700 mr-4"
            name="sparks"
          />
          {{ formatNumber(supplyApyWithRewards) }}%
        </div>
      </div>
    </div>
    <div class="flex-1 flex py-12 px-16 pb-12 justify-between mobile:border-b mobile:border-border-primary">
      <div class="flex-1">
        <div class="text-euler-dark-900 text-p3 mb-4">
          Total supply
        </div>
        <div class="text-p2">
          {{ `$${compactNumber(getVaultPrice(vault.totalAssets, vault))}` }}
        </div>
      </div>
      <div class="flex-1 flex flex-col items-center">
        <div class="text-euler-dark-900 text-p3 mb-4">
          Risk curator
        </div>
        <BaseAvatar
          class="icon--20"
          :label="entitiesLabels"
          :src="entitiesLogos"
        />
      </div>
      <div
        class="flex justify-center items-center flex-col flex-1 mobile:!hidden"
      >
        <div class="text-euler-dark-900 text-p3 mb-4">
          Utilization
        </div>
        <div
          class="flex gap-8 justify-end items-center text-right"
        >
          <button
            v-if="utilization >= 95"
            class="flex justify-center items-center w-20 h-20 bg-[#3e4540] text-yellow-600 rounded-4 cursor-pointer"
            @click.stop.prevent="onWarningClick"
          >
            <SvgIcon
              name="warning"
              class="!w-16 !h-16"
            />
          </button>
          <UiRadialProgress
            :value="utilization"
            :max="100"
          />
          <div class="text-p2">
            {{ compactNumber(utilization, 2, 2) }}%
          </div>
        </div>
      </div>
      <div
        class="flex flex-col flex-1 items-end text-right"
      >
        <template v-if="isConnected">
          <div class="text-euler-dark-900 text-p3 mb-4">
            In wallet
          </div>
          <BaseLoadableContent
            :loading="isBalancesLoading"
            style="width: 70px; height: 20px"
          >
            <div class="text-p2">
              ${{ compactNumber(getVaultPrice(balance, vault)) }}
            </div>
          </BaseLoadableContent>
        </template>
      </div>
    </div>
    <div class="hidden mobile:flex py-12 px-16 pb-16">
      <div class="flex-1">
        <div class="text-euler-dark-900 text-p3">
          Utilization
        </div>
      </div>
      <div
        class="flex gap-8 justify-end items-center text-right flex-1"
      >
        <button
          v-if="utilization >= 95"
          class="flex justify-center items-center w-20 h-20 bg-[#3e4540] text-yellow-600 rounded-4 cursor-pointer"
          @click.stop.prevent="onWarningClick"
        >
          <SvgIcon
            name="warning"
            class="!w-16 !h-16"
          />
        </button>
        <UiRadialProgress
          :value="utilization"
          :max="100"
        />
        <div class="text-p2">
          {{ compactNumber(utilization, 2, 2) }}%
        </div>
      </div>
    </div>
  </NuxtLink>
</template>
