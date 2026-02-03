<script setup lang="ts">
import { useAccount } from '@wagmi/vue'
import { getEarnVaultPrice, getEarnVaultPriceDisplay, type EarnVault } from '~/entities/vault'
import { useEulerProductOfVault } from '~/composables/useEulerLabels'
import { getAssetLogoUrl } from '~/composables/useTokens'
import BaseLoadableContent from '~/components/base/BaseLoadableContent.vue'

const { isConnected } = useAccount()
const { vault } = defineProps<{ vault: EarnVault }>()
const product = useEulerProductOfVault(vault.address)
const { getBalance, isLoading: isBalancesLoading } = useWallets()
const { getOpportunityOfLendVault } = useMerkl()
const { getCampaignOfLendVault } = useBrevis()

const balance = computed(() => getBalance(vault.asset.address as `0x${string}`))
const opportunityInfo = computed(() => getOpportunityOfLendVault(vault.address))
const brevisInfo = computed(() => getCampaignOfLendVault(vault.address))
const totalRewardsAPY = computed(() => (opportunityInfo.value?.apr || 0) + (brevisInfo.value?.reward_info.apr || 0) * 100)
const hasRewards = computed(() => opportunityInfo.value || brevisInfo.value)
const isUnverified = computed(() => !vault.verified)
const displayName = computed(() => product.name || vault.name)

const totalSupplyPrice = computed(() => {
  const price = getEarnVaultPriceDisplay(vault.totalAssets, vault)
  return price.hasPrice ? `$${compactNumber(price.usdValue)}` : price.display
})

const liquidityPrice = computed(() => {
  return `$${compactNumber(getEarnVaultPrice(vault.availableAssets, vault))}`
})

const walletBalancePrice = computed(() => {
  const price = getEarnVaultPriceDisplay(balance.value, vault)
  return price.hasPrice ? `$${compactNumber(price.usdValue)}` : price.display
})
</script>

<template>
  <NuxtLink
    class="block no-underline bg-surface rounded-xl border border-line-subtle shadow-card transition-all duration-default ease-default hover:shadow-card-hover hover:border-line-emphasis"
    :to="`/earn/${vault.address}`"
  >
    <div class="flex py-16 px-16 pb-12 border-b border-line-default">
      <BaseAvatar
        class="icon--40"
        :src="getAssetLogoUrl(vault.asset.symbol)"
        :label="vault.asset.symbol"
      />
      <div class="flex-grow ml-12">
        <div class="text-content-tertiary text-p3 mb-4">
          <VaultDisplayName
            :name="displayName"
            :is-unverified="isUnverified"
          />
        </div>
        <div class="text-h5 text-content-primary">
          {{ vault.asset.symbol }}
        </div>
      </div>
      <div class="flex flex-col items-end">
        <div class="text-content-tertiary text-p3 mb-4 text-right">
          Supply APY
        </div>
        <div
          class="text-p2 flex items-center text-accent-600"
        >
          <div class="mr-6">
            <VaultPoints :vault="vault" />
          </div>
          <SvgIcon
            v-if="hasRewards"
            class="!w-20 !h-20 text-accent-600 mr-4"
            name="sparks"
          />
          {{ formatNumber((vault.supplyAPY || 0) + totalRewardsAPY) }}%
        </div>
      </div>
    </div>
    <div class="flex py-12 px-16 pb-16">
      <div class="flex-1">
        <div class="text-content-tertiary text-p3 mb-4">
          Total supply
        </div>
        <div class="text-p2 text-content-primary">
          {{ totalSupplyPrice }}
        </div>
      </div>
      <div class="flex-1 flex flex-col items-center">
        <div class="text-content-tertiary text-p3 mb-4">
          Available liquidity
        </div>
        <div class="text-p2 text-content-primary">
          {{ liquidityPrice }}
        </div>
      </div>
      <div
        class="flex flex-col flex-1 items-end text-right"
      >
        <template v-if="isConnected">
          <div class="text-content-tertiary text-p3 mb-4">
            In wallet
          </div>
          <BaseLoadableContent
            :loading="isBalancesLoading"
            style="width: 70px; height: 20px"
          >
            <div class="text-p2 text-content-primary">
              {{ walletBalancePrice }}
            </div>
          </BaseLoadableContent>
        </template>

      </div>
    </div>
  </NuxtLink>
</template>
