<script setup lang="ts">
import { ethers } from "ethers";
import {
  type AnyBorrowVaultPair,
  getVaultPrice,
  getVaultUtilization,
} from "~/entities/vault";
import { useEulerProductOfVault } from "~/composables/useEulerLabels";
import { getAssetLogoUrl } from "~/composables/useTokens";
import { useModal } from "~/components/ui/composables/useModal";
import { VaultBorrowApyModal, VaultUtilizationWarningModal } from "#components";

const { pair } = defineProps<{ pair: AnyBorrowVaultPair }>();

const { getOpportunityOfBorrowVault } = useMerkl();
const { getCampaignOfBorrowVault } = useBrevis();
const { withIntrinsicBorrowApy, withIntrinsicSupplyApy, getIntrinsicApy } =
  useIntrinsicApy();
const modal = useModal();

const collateralProduct = useEulerProductOfVault(
  computed(() => pair.collateral.address),
);
const borrowProduct = useEulerProductOfVault(
  computed(() => pair.borrow.address),
);

const isEscrowCollateral = computed(
  () =>
    "vaultCategory" in pair.collateral &&
    pair.collateral.vaultCategory === "escrow",
);

const isAnyUnverified = computed(() => {
  const collateralUnverified =
    "verified" in pair.collateral && !pair.collateral.verified;
  const borrowUnverified = "verified" in pair.borrow && !pair.borrow.verified;
  return collateralUnverified || borrowUnverified;
});

const isAnyDeprecated = computed(() => {
  const collateralAddr = ethers.getAddress(pair.collateral.address);
  const borrowAddr = ethers.getAddress(pair.borrow.address);
  const collateralDeprecated = collateralProduct.deprecatedVaults?.includes(collateralAddr) ?? false;
  const borrowDeprecated = borrowProduct.deprecatedVaults?.includes(borrowAddr) ?? false;
  return collateralDeprecated || borrowDeprecated;
});

const pairName = computed(() => {
  // Handle escrow collateral specially
  const collateralName = isEscrowCollateral.value
    ? "Escrowed collateral"
    : collateralProduct.name || pair.collateral.name;
  const borrowName = borrowProduct.name || pair.borrow.name;

  if (collateralName === borrowName) {
    return collateralName;
  }
  return `${collateralName}/${borrowName}`;
});
const opportunityInfo = computed(() =>
  getOpportunityOfBorrowVault(pair.borrow.asset.address),
);
const brevisInfo = computed(() =>
  getCampaignOfBorrowVault(pair.borrow.address),
);
const totalRewardsAPY = computed(
  () =>
    (opportunityInfo.value?.apr || 0) +
    (brevisInfo.value?.reward_info.apr || 0) * 100,
);
const hasRewards = computed(() => opportunityInfo.value || brevisInfo.value);
const supplyApy = computed(() => {
  const interestRateInfo =
    "interestRateInfo" in pair.collateral
      ? pair.collateral.interestRateInfo
      : null;
  const baseApy = interestRateInfo
    ? nanoToValue(interestRateInfo.supplyAPY, 25)
    : 0;
  return withIntrinsicSupplyApy(baseApy, pair.collateral.asset.symbol);
});
const borrowApy = computed(() =>
  withIntrinsicBorrowApy(
    nanoToValue(pair.borrow.interestRateInfo.borrowAPY, 25),
    pair.borrow.asset.symbol,
  ),
);
const supplyApyWithRewards = computed(
  () => supplyApy.value + totalRewardsAPY.value,
);
const borrowApyWithRewards = computed(
  () => borrowApy.value - totalRewardsAPY.value,
);
const maxMultiplier = computed(() => {
  const ltv = pair.borrowLTV || 0n;
  const base = 10000n;
  if (ltv <= 0n || ltv >= base) {
    return 1;
  }
  const result = (base * ltv) / (base - ltv) - 200n + base;
  const value = Number(result) / 10000;
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.max(1, Math.floor(value * 100) / 100);
});
const netApy = computed(
  () => supplyApyWithRewards.value - borrowApyWithRewards.value,
);
const maxRoe = computed(() => {
  const multiplier = maxMultiplier.value;
  const base = supplyApyWithRewards.value;
  const net = netApy.value;
  if (
    !Number.isFinite(multiplier) ||
    !Number.isFinite(base) ||
    !Number.isFinite(net)
  ) {
    return 0;
  }
  return base + (multiplier - 1) * net;
});
const maxLTV = computed(() => formatNumber(nanoToValue(pair.borrowLTV, 2), 2));
const utilization = computed(() => getVaultUtilization(pair.borrow));

const onWarningClick = () => {
  modal.open(VaultUtilizationWarningModal);
};

const onBorrowInfoIconClick = (event: MouseEvent) => {
  event.preventDefault();
  event.stopPropagation();
  modal.open(VaultBorrowApyModal, {
    props: {
      borrowingAPY: nanoToValue(pair.borrow.interestRateInfo.borrowAPY, 25),
      intrinsicAPY: getIntrinsicApy(pair.borrow.asset.symbol),
      opportunityInfo: opportunityInfo.value,
    },
  });
};

const linkPath = computed(
  () => `/borrow/${pair.collateral.address}/${pair.borrow.address}`,
);
</script>

<template>
  <NuxtLink
    :to="linkPath"
    class="block no-underline text-content-primary bg-surface rounded-12 border border-line-default shadow-card hover:shadow-card-hover hover:border-line-emphasis transition-all"
  >
    <div class="flex py-16 px-16 pb-12 border-b border-line-subtle">
      <BaseAvatar
        :src="
          [pair.collateral.asset.symbol, pair.borrow.asset.symbol].map((s) =>
            getAssetLogoUrl(s),
          )
        "
        :label="[pair.collateral.asset.symbol, pair.borrow.asset.symbol]"
        class="icon--40"
      />
      <div class="flex-grow ml-12">
        <div class="text-content-tertiary text-p3 mb-4 flex items-center gap-8">
          <VaultDisplayName :name="pairName" :is-unverified="isAnyUnverified" />
          <span
            v-if="isAnyDeprecated"
            class="inline-flex items-center gap-4 rounded-8 px-8 py-2 bg-warning-100 text-warning-500 text-p5"
          >
            <SvgIcon name="warning" class="!w-14 !h-14" />
            Deprecated
          </span>
        </div>
        <div class="text-h5 text-content-primary">
          {{
            [pair.collateral.asset.symbol, pair.borrow.asset.symbol].join("/")
          }}
        </div>
      </div>
      <div class="flex flex-col items-end">
        <div class="text-content-tertiary text-p3 mb-4 text-right">
          Borrow APY
        </div>
        <div class="text-p2 flex items-center text-accent-600 font-semibold">
          <SvgIcon
            v-if="hasRewards"
            class="!w-20 !h-20 text-accent-500 mr-4"
            name="sparks"
          />
          {{ formatNumber(borrowApyWithRewards) }}%
          <SvgIcon
            class="!w-20 !h-20 text-content-muted hover:text-content-secondary transition-colors cursor-pointer ml-4"
            name="info-circle"
            @click="onBorrowInfoIconClick"
          />
        </div>
      </div>
    </div>
    <div
      class="flex py-12 px-16 pb-12 justify-between mobile:border-b mobile:border-line-subtle"
    >
      <div>
        <div class="text-content-tertiary text-p3 mb-4">
          Available liquidity
        </div>
        <div class="text-p2 text-content-primary">
          {{
            `$${compactNumber(getVaultPrice(pair.borrow.supply - pair.borrow.borrow, pair.borrow))}`
          }}
        </div>
      </div>
      <div class="text-center">
        <div class="text-content-tertiary text-p3 mb-4">Supply APY</div>
        <div class="text-p2 text-content-primary">
          {{ formatNumber(supplyApyWithRewards) }}%
        </div>
      </div>
      <div class="text-center mobile:!hidden">
        <div class="text-content-tertiary text-p3 mb-4">Max ROE</div>
        <div class="text-p2 text-content-primary">
          {{ formatNumber(maxRoe, 2, 2) }}%
        </div>
      </div>
      <div class="text-center mobile:!hidden">
        <div class="text-content-tertiary text-p3 mb-4">Max Multiplier</div>
        <div class="text-p2 text-content-primary">
          {{ formatNumber(maxMultiplier, 2, 2) }}x
        </div>
      </div>
      <div class="flex flex-col justify-center items-center mobile:!hidden">
        <div class="text-content-tertiary text-p3 mb-4">Max LTV</div>
        <div class="text-p2 text-content-primary">
          {{ compactNumber(maxLTV, 2, 2) }}%
        </div>
      </div>
      <div class="flex flex-col justify-center items-center mobile:!hidden">
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
    </div>
    <div class="hidden mobile:flex mobile:flex-col gap-12 py-12 px-16 pb-16">
      <div class="flex w-full justify-between">
        <div class="flex-1">
          <div class="text-content-tertiary text-p3">Max LTV</div>
        </div>
        <div class="flex gap-8 justify-end items-center text-right flex-1">
          <div class="text-p2 text-content-primary">
            {{ compactNumber(maxLTV, 2, 2) }}%
          </div>
        </div>
      </div>
      <div class="flex w-full justify-between">
        <div class="flex-1">
          <div class="text-content-tertiary text-p3">Max ROE</div>
        </div>
        <div class="flex gap-8 justify-end items-center text-right flex-1">
          <div class="text-p2 text-content-primary">
            {{ formatNumber(maxRoe, 2, 2) }}%
          </div>
        </div>
      </div>
      <div class="flex w-full justify-between">
        <div class="flex-1">
          <div class="text-content-tertiary text-p3">Max Multiplier</div>
        </div>
        <div class="flex gap-8 justify-end items-center text-right flex-1">
          <div class="text-p2 text-content-primary">
            {{ formatNumber(maxMultiplier, 2, 2) }}x
          </div>
        </div>
      </div>
      <div class="flex w-full justify-between">
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
    </div>
  </NuxtLink>
</template>
