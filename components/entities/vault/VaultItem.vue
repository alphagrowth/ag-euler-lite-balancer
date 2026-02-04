<script setup lang="ts">
import { useAccount } from "@wagmi/vue";
import { ethers } from "ethers";
import {
  getVaultPrice,
  getVaultPriceDisplay,
  getVaultUtilization,
  type Vault,
} from "~/entities/vault";
import { useEulerProductOfVault } from "~/composables/useEulerLabels";
import { getAssetLogoUrl } from "~/composables/useTokens";
import BaseLoadableContent from "~/components/base/BaseLoadableContent.vue";
import { useModal } from "~/components/ui/composables/useModal";
import { VaultSupplyApyModal, VaultUtilizationWarningModal } from "#components";

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

const totalSupplyPrice = computed(() => {
  const price = getVaultPriceDisplay(vault.totalAssets, vault);
  return price.hasPrice ? `$${compactNumber(price.usdValue)}` : price.display;
});

const liquidityPrice = computed(() => {
  const liquidity = vault.supply - vault.borrow;
  return `$${compactNumber(getVaultPrice(liquidity, vault))}`;
});

const walletBalancePrice = computed(() => {
  const price = getVaultPriceDisplay(balance.value, vault);
  return price.hasPrice ? `$${compactNumber(price.usdValue)}` : price.display;
});

const onWarningClick = () => {
  modal.open(VaultUtilizationWarningModal);
};
</script>

<template>
  <NuxtLink
    class="block no-underline text-content-primary bg-surface rounded-12 border border-line-default shadow-card hover:shadow-card-hover hover:border-line-emphasis transition-all"
    :to="`/lend/${vault.address}`"
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
        <div class="text-content-tertiary text-p3 mb-4 text-right">
          Supply APY
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
            <SvgIcon
              class="!w-20 !h-20 text-content-muted hover:text-content-secondary transition-colors cursor-pointer ml-4"
              name="info-circle"
              @click="onSupplyInfoIconClick"
            />
          </div>
        </div>
      </div>
    </div>
    <div
      class="flex-1 flex py-12 px-16 pb-12 justify-between mobile:border-b mobile:border-line-subtle"
    >
      <div class="flex-1">
        <div class="text-content-tertiary text-p3 mb-4">Total supply</div>
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
        class="flex flex-col flex-1 mobile:!hidden"
        :class="
          isConnected ? 'justify-center items-center' : 'items-end text-right'
        "
      >
        <div class="text-content-tertiary text-p3 mb-4">Utilization</div>
        <div class="flex gap-8 justify-end items-center text-right">
          <button
            v-if="utilization >= 95"
            class="text-warning-500 hover:text-warning-600 transition-colors cursor-pointer"
            @click.stop.prevent="onWarningClick"
          >
            <SvgIcon name="warning" class="!w-18 !h-18" />
          </button>
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
          style="width: 70px; height: 20px"
        >
          <div class="text-p2 text-content-primary">
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
        <button
          v-if="utilization >= 95"
          class="text-warning-500 hover:text-warning-600 transition-colors cursor-pointer"
          @click.stop.prevent="onWarningClick"
        >
          <SvgIcon name="warning" class="!w-18 !h-18" />
        </button>
        <UiRadialProgress :value="utilization" :max="100" />
        <div class="text-p2 text-content-primary">
          {{ compactNumber(utilization, 2, 2) }}%
        </div>
      </div>
    </div>
  </NuxtLink>
</template>
