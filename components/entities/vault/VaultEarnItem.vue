<script setup lang="ts">
import { useAccount } from '@wagmi/vue'
import { getEarnVaultPrice, getEarnVaultPriceDisplay, type EarnVault } from '~/entities/vault'
import { useEulerEntitiesOfEarnVault, useEulerProductOfVault } from '~/composables/useEulerLabels'
import { getEulerLabelEntityLogo } from '~/entities/euler/labels'
import { getAssetLogoUrl } from '~/composables/useTokens'
import BaseLoadableContent from '~/components/base/BaseLoadableContent.vue'

const { isConnected } = useAccount()
const { vault } = defineProps<{ vault: EarnVault }>()
const { isEarnVaultOwnerVerified } = useVaults()
const entities = useEulerEntitiesOfEarnVault(vault)
const product = useEulerProductOfVault(vault.address)
const isOwnerVerified = computed(() => isEarnVaultOwnerVerified(vault))
const { getBalance, isLoading: isBalancesLoading } = useWallets()
const { getOpportunityOfLendVault } = useMerkl()
const { getCampaignOfLendVault } = useBrevis()

const entitiesLabels = computed(() => {
  if (!isOwnerVerified.value) return ['Unknown']
  return entities.map(e => e.name)
})
const entitiesLogos = computed(() => {
  if (!isOwnerVerified.value) return []
  return entities.map(e => getEulerLabelEntityLogo(e.logo))
})

const balance = computed(() => getBalance(vault.asset.address as `0x${string}`))
const opportunityInfo = computed(() => getOpportunityOfLendVault(vault.address))
const brevisInfo = computed(() => getCampaignOfLendVault(vault.address))
const totalRewardsAPY = computed(() => (opportunityInfo.value?.apr || 0) + (brevisInfo.value?.reward_info.apr || 0) * 100)
const hasRewards = computed(() => opportunityInfo.value || brevisInfo.value)
const displayName = computed(() => product.name || vault.name)

const totalSupplyPrice = computed(() => {
  const price = getEarnVaultPriceDisplay(vault.totalAssets, vault)
  return price.hasPrice ? `$${compactNumber(price.usdValue)}` : price.display
})

const walletBalancePrice = computed(() => {
  const price = getEarnVaultPriceDisplay(balance.value, vault)
  return price.hasPrice ? `$${compactNumber(price.usdValue)}` : price.display
})
</script>

<template>
  <NuxtLink
    class="block no-underline text-white bg-euler-dark-500 rounded-16"
    :to="`/earn/${vault.address}`"
  >
    <div class="flex py-16 px-16 pb-12 border-b border-border-primary">
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
          {{ formatNumber((vault.supplyAPY || 0) + totalRewardsAPY) }}%
        </div>
      </div>
    </div>
    <div class="flex py-12 px-16 pb-16">
      <div class="flex-1">
        <div class="text-euler-dark-900 text-p3 mb-4">
          Total supply
        </div>
        <div class="text-p2">
          {{ totalSupplyPrice }}
        </div>
      </div>
      <div class="flex flex-col items-center flex-1">
        <div class="text-euler-dark-900 text-p3 mb-4">
          Capital allocator
        </div>
        <BaseAvatar
          class="icon--20"
          :label="entitiesLabels"
          :src="entitiesLogos"
        />
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
              {{ walletBalancePrice }}
            </div>
          </BaseLoadableContent>
        </template>

      </div>
    </div>
  </NuxtLink>
</template>
