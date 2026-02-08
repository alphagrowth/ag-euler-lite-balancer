<script setup lang="ts">
import { useAccount } from '@wagmi/vue'
import { ethers } from 'ethers'
import { getVaultUtilization, type Vault } from '~/entities/vault'
import { getUtilisationWarning, getSupplyCapWarning } from '~/composables/useVaultWarnings'
import { formatAssetValue } from '~/services/pricing/priceProvider'
import { useEulerProductOfVault } from '~/composables/useEulerLabels'
import { isVaultBlockedByCountry } from '~/composables/useGeoBlock'
import { getAssetLogoUrl } from '~/composables/useTokens'
import BaseLoadableContent from '~/components/base/BaseLoadableContent.vue'
import { useModal } from '~/components/ui/composables/useModal'
import { VaultSupplyApyModal } from '#components'

const { isConnected } = useAccount();
const { vault } = defineProps<{ vault: Vault }>();
const product = useEulerProductOfVault(vault.address);
const isUnverified = computed(() => !vault.verified);
const displayName = computed(() => product.name || vault.name);
const { getBalance, isLoading: isBalancesLoading } = useWallets();
const { getOpportunityOfLendVault } = useMerkl();
const { getCampaignOfLendVault } = useBrevis();
const { withIntrinsicSupplyApy, getIntrinsicApy } = useIntrinsicApy();
const modal = useModal();

const balance = computed(() =>
  getBalance(vault.asset.address as `0x${string}`),
);
const opportunityInfo = computed(() =>
  getOpportunityOfLendVault(vault.address),
);
const brevisInfo = computed(() => getCampaignOfLendVault(vault.address));
const totalRewardsAPY = computed(
  () =>
    (opportunityInfo.value?.apr || 0) +
    (brevisInfo.value?.reward_info.apr || 0) * 100,
);
const hasRewards = computed(() => opportunityInfo.value || brevisInfo.value);
const lendingAPY = computed(() =>
  nanoToValue(vault.interestRateInfo.supplyAPY, 25),
);
const intrinsicAPY = computed(() => getIntrinsicApy(vault.asset.symbol));
const supplyApy = computed(() =>
  withIntrinsicSupplyApy(lendingAPY.value, vault.asset.symbol),
);
const supplyApyWithRewards = computed(
  () => supplyApy.value + totalRewardsAPY.value,
);
const utilization = computed(() => getVaultUtilization(vault));
const isGeoBlocked = computed(() => isVaultBlockedByCountry(vault.address))
const utilisationWarning = computed(() => getUtilisationWarning(vault, 'lend'));
const supplyCapWarning = computed(() => getSupplyCapWarning(vault));
const isDeprecated = computed(() => {
  try {
    const addr = ethers.getAddress(vault.address);
    return product.deprecatedVaults?.includes(addr) ?? false;
  } catch {
    return product.deprecatedVaults?.includes(vault.address) ?? false;
  }
});
const deprecationReason = computed(() =>
  isDeprecated.value ? product.deprecationReason : "",
);

const onSupplyInfoIconClick = (event: MouseEvent) => {
  event.preventDefault();
  event.stopPropagation();
  modal.open(VaultSupplyApyModal, {
    props: {
      lendingAPY: lendingAPY.value,
      intrinsicAPY: intrinsicAPY.value,
      opportunityInfo: opportunityInfo.value,
      brevisInfo: brevisInfo.value,
    },
  });
};

const totalSupplyPrice = ref('-')
const liquidityPrice = ref('-')
const walletBalancePrice = ref('-')

watchEffect(async () => {
  const price = await formatAssetValue(vault.totalAssets, vault, 'off-chain')
  totalSupplyPrice.value = price.hasPrice ? formatCompactUsdValue(price.usdValue) : price.display
})

watchEffect(async () => {
  const liquidity = vault.supply - vault.borrow
  const price = await formatAssetValue(liquidity, vault, 'off-chain')
  liquidityPrice.value = price.hasPrice ? formatCompactUsdValue(price.usdValue) : price.display
})

watchEffect(async () => {
  const price = await formatAssetValue(balance.value, vault, 'off-chain')
  walletBalancePrice.value = price.hasPrice ? formatCompactUsdValue(price.usdValue) : price.display
})

</script>

<template>
  <NuxtLink
    class="block no-underline text-content-primary bg-surface rounded-12 border border-line-default shadow-card hover:shadow-card-hover hover:border-line-emphasis transition-all"
    :class="isGeoBlocked ? 'opacity-50 border-l-4 border-l-warning-500/50' : ''"
    :to="isGeoBlocked ? undefined : `/lend/${vault.address}`"
  >
    <div class="flex pb-12 p-16 border-b border-line-subtle">
      <BaseAvatar
        class="icon--40"
        :src="getAssetLogoUrl(vault.asset.symbol)"
        :label="vault.asset.symbol"
      />
      <div class="flex-grow ml-12">
        <div class="text-content-tertiary text-p3 mb-4 flex items-center gap-8">
          <VaultDisplayName :name="displayName" :is-unverified="isUnverified" />
          <span
            v-if="isGeoBlocked"
            class="inline-flex items-center gap-4 rounded-8 px-8 py-2 bg-warning-100 text-warning-500 text-p5"
            title="This vault is not available in your region"
          >
            <SvgIcon name="warning" class="!w-14 !h-14" />
            Restricted
          </span>
          <span
            v-if="isDeprecated"
            class="inline-flex items-center gap-4 rounded-8 px-8 py-2 bg-warning-100 text-warning-500 text-p5"
            :title="deprecationReason || 'This vault has been deprecated.'"
          >
            <SvgIcon name="warning" class="!w-14 !h-14" />
            Deprecated
          </span>
        </div>
        <div class="text-h5 text-content-primary">
          {{ vault.asset.symbol }}
        </div>
      </div>
      <div class="flex flex-col items-end">
        <div class="text-content-tertiary text-p3 mb-4 text-right flex items-center gap-4">
          Supply APY
          <SvgIcon
            class="!w-16 !h-16 text-content-muted hover:text-content-secondary transition-colors cursor-pointer"
            name="info-circle"
            @click="onSupplyInfoIconClick"
          />
        </div>
        <div class="flex items-center">
          <div class="mr-6">
            <VaultPoints :vault="vault" />
          </div>
          <div class="text-p2 flex items-center text-accent-600 font-semibold">
            <SvgIcon
              v-if="hasRewards"
              class="!w-20 !h-20 text-accent-500 mr-4"
              name="sparks"
            />
            {{ formatNumber(supplyApyWithRewards) }}%
          </div>
        </div>
      </div>
    </div>
    <div
      class="flex-1 flex py-12 px-16 pb-12 justify-between mobile:border-b mobile:border-line-subtle"
    >
      <div class="flex-1">
        <div class="text-content-tertiary text-p3 mb-4">Total supply</div>
        <div class="text-p2 text-content-primary flex items-center gap-4">
          <VaultWarningIcon :warning="supplyCapWarning" tooltip-placement="top-start" />
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
        class="flex flex-col flex-1 mobile:!hidden"
        :class="
          isConnected ? 'justify-center items-center' : 'items-end text-right'
        "
      >
        <div class="text-content-tertiary text-p3 mb-4">Utilization</div>
        <div class="flex gap-8 justify-end items-center text-right">
          <VaultWarningIcon :warning="utilisationWarning" />
          <UiRadialProgress :value="utilization" :max="100" />
          <div class="text-p2 text-content-primary">
            {{ compactNumber(utilization, 2, 2) }}%
          </div>
        </div>
      </div>
      <div v-if="isConnected" class="flex flex-col flex-1 items-end text-right">
        <div class="text-content-tertiary text-p3 mb-4">In wallet</div>
        <BaseLoadableContent
          :loading="isBalancesLoading"
          style="min-width: 70px; height: 20px"
        >
          <div class="text-p2 text-content-primary whitespace-nowrap">
            {{ walletBalancePrice }}
          </div>
        </BaseLoadableContent>
      </div>
    </div>
    <div class="hidden mobile:flex py-12 px-16 pb-16">
      <div class="flex-1">
        <div class="text-content-tertiary text-p3">Utilization</div>
      </div>
      <div class="flex gap-8 justify-end items-center text-right flex-1">
        <VaultWarningIcon :warning="utilisationWarning" />
        <UiRadialProgress :value="utilization" :max="100" />
        <div class="text-p2 text-content-primary">
          {{ compactNumber(utilization, 2, 2) }}%
        </div>
      </div>
    </div>
  </NuxtLink>
</template>
