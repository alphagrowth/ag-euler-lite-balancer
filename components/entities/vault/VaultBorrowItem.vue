<script setup lang="ts">
import { getAddress } from 'viem'
import { type AnyBorrowVaultPair, getVaultUtilization } from '~/entities/vault'
import { getUtilisationWarning, getBorrowCapWarning } from '~/composables/useVaultWarnings'
import { formatAssetValue } from '~/services/pricing/priceProvider'
import { getMaxMultiplier, getMaxRoe } from '~/utils/leverage'
import { useEulerProductOfVault } from '~/composables/useEulerLabels'
import { isAnyVaultBlockedByCountry } from '~/composables/useGeoBlock'
import { getAssetLogoUrl } from '~/composables/useTokens'
import { useModal } from '~/components/ui/composables/useModal'
import { VaultBorrowApyModal, VaultMaxRoeModal } from '#components'

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

const isGeoBlocked = computed(() => isAnyVaultBlockedByCountry(pair.collateral.address, pair.borrow.address))

const isAnyDeprecated = computed(() => {
  const collateralAddr = getAddress(pair.collateral.address);
  const borrowAddr = getAddress(pair.borrow.address);
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
const maxMultiplier = computed(() => getMaxMultiplier(pair.borrowLTV));
const netApy = computed(
  () => supplyApyWithRewards.value - borrowApyWithRewards.value,
);
const maxRoe = computed(() =>
  getMaxRoe(maxMultiplier.value, supplyApyWithRewards.value, borrowApyWithRewards.value),
);
const maxLTV = computed(() => formatNumber(nanoToValue(pair.borrowLTV, 2), 2));
const utilization = computed(() => getVaultUtilization(pair.borrow));
const utilisationWarning = computed(() => getUtilisationWarning(pair.borrow, 'borrow'));
const borrowCapInfo = computed(() => getBorrowCapWarning(pair.borrow));

const liquidityDisplay = ref('-')

watchEffect(async () => {
  const liquidity = pair.borrow.supply - pair.borrow.borrow
  const price = await formatAssetValue(liquidity, pair.borrow, 'off-chain')
  liquidityDisplay.value = price.hasPrice ? formatCompactUsdValue(price.usdValue) : price.display
})

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

const onMaxRoeInfoIconClick = (event: MouseEvent) => {
  event.preventDefault();
  event.stopPropagation();
  modal.open(VaultMaxRoeModal, {
    props: {
      maxRoe: maxRoe.value,
      maxMultiplier: maxMultiplier.value,
      supplyAPY: supplyApyWithRewards.value,
      borrowAPY: borrowApyWithRewards.value,
      borrowLTV: nanoToValue(pair.borrowLTV, 2),
    },
  });
};

const linkPath = computed(
  () => `/borrow/${pair.collateral.address}/${pair.borrow.address}`,
);
</script>

<template>
  <NuxtLink
    :to="isGeoBlocked ? undefined : linkPath"
    class="grid grid-cols-5 gap-x-16 mobile:block no-underline text-content-primary bg-surface rounded-12 border border-line-default shadow-card hover:shadow-card-hover hover:border-line-emphasis transition-all"
    :class="isGeoBlocked ? 'opacity-50 border-l-4 border-l-warning-500/50' : ''"
  >
    <!-- Header: contents on desktop (children become grid items), flex on mobile -->
    <div class="contents mobile:!flex mobile:py-16 mobile:px-16 mobile:pb-12 mobile:border-b mobile:border-line-subtle">
      <div class="col-span-3 flex pl-16 py-16 pb-12 mobile:!p-0 mobile:flex-1 mobile:min-w-0">
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
              v-if="isGeoBlocked"
              class="inline-flex items-center gap-4 rounded-8 px-8 py-2 bg-warning-100 text-warning-500 text-p5"
              title="This vault is not available in your region"
            >
              <SvgIcon name="warning" class="!w-14 !h-14" />
              Restricted
            </span>
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
      </div>
      <div class="flex flex-col items-center justify-end py-16 pb-12 mobile:!flex mobile:items-end">
        <div class="text-content-tertiary text-p3 mb-4 text-right flex items-center gap-4">
          Borrow APY
          <SvgIcon
            class="!w-16 !h-16 text-content-muted hover:text-content-secondary transition-colors cursor-pointer"
            name="info-circle"
            @click="onBorrowInfoIconClick"
          />
        </div>
        <div class="text-p2 flex items-center text-accent-600 font-semibold">
          <SvgIcon
            v-if="hasRewards"
            class="!w-20 !h-20 text-accent-500 mr-4"
            name="sparks"
          />
          {{ formatNumber(borrowApyWithRewards) }}%
        </div>
      </div>
      <div class="flex flex-col items-end pr-16 py-16 pb-12 mobile:!hidden">
        <div class="text-content-tertiary text-p3 mb-4 text-right flex items-center gap-4">
          Max ROE
          <SvgIcon
            class="!w-16 !h-16 text-content-muted hover:text-content-secondary transition-colors cursor-pointer"
            name="info-circle"
            @click="onMaxRoeInfoIconClick"
          />
        </div>
        <div class="text-p2 text-accent-600 font-semibold">
          {{ formatNumber(maxRoe, 2, 2) }}%
        </div>
      </div>
    </div>

    <!-- Border separator (desktop only) -->
    <div class="col-span-full border-b border-line-subtle mobile:!hidden" />

    <!-- Body stats: contents on desktop (children become grid items), flex on mobile -->
    <div class="contents mobile:!flex mobile:py-12 mobile:px-16 mobile:pb-12 mobile:justify-between mobile:border-b mobile:border-line-subtle">
      <div class="pl-16 py-12 pb-12 mobile:!p-0">
        <div class="text-content-tertiary text-p3 mb-4 flex items-center gap-4">
          Available liquidity
          <VaultWarningIcon :warning="borrowCapInfo" tooltip-placement="top-start" />
        </div>
        <div class="text-p2 text-content-primary">
          {{ liquidityDisplay }}
        </div>
      </div>
      <div class="py-12 pb-12 text-center mobile:!p-0">
        <div class="text-content-tertiary text-p3 mb-4">Net APY</div>
        <div class="text-p2 text-content-primary">
          {{ formatNumber(netApy, 2, 2) }}%
        </div>
      </div>
      <div class="py-12 pb-12 text-center mobile:!hidden">
        <div class="text-content-tertiary text-p3 mb-4">Max Multiplier</div>
        <div class="text-p2 text-content-primary">
          {{ formatNumber(maxMultiplier, 2, 2) }}x
        </div>
      </div>
      <div class="py-12 pb-12 text-center mobile:!hidden">
        <div class="text-content-tertiary text-p3 mb-4">Max LTV</div>
        <div class="text-p2 text-content-primary">
          {{ compactNumber(maxLTV, 2, 2) }}%
        </div>
      </div>
      <div class="pr-16 py-12 pb-12 flex flex-col items-end mobile:!hidden">
        <div class="text-content-tertiary text-p3 mb-4 flex items-center gap-4">
          Utilization
          <VaultWarningIcon :warning="utilisationWarning" />
        </div>
        <div class="flex gap-8 justify-end items-center text-right">
          <UiRadialProgress :value="utilization" :max="100" />
          <div class="text-p2 text-content-primary">
            {{ compactNumber(utilization, 2, 2) }}%
          </div>
        </div>
      </div>
    </div>

    <!-- Mobile expanded stats -->
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
          <div class="text-p2 text-accent-600 font-semibold">
            {{ formatNumber(maxRoe, 2, 2) }}%
          </div>
        </div>
      </div>
      <div class="flex w-full justify-between">
        <div class="flex-1">
          <div class="text-content-tertiary text-p3">Net APY</div>
        </div>
        <div class="flex gap-8 justify-end items-center text-right flex-1">
          <div class="text-p2 text-content-primary">
            {{ formatNumber(netApy, 2, 2) }}%
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
          <div class="text-content-tertiary text-p3 flex items-center gap-4">
            Utilization
            <VaultWarningIcon :warning="utilisationWarning" />
          </div>
        </div>
        <div class="flex gap-8 justify-end items-center text-right flex-1">
          <UiRadialProgress :value="utilization" :max="100" />
          <div class="text-p2 text-content-primary">
            {{ compactNumber(utilization, 2, 2) }}%
          </div>
        </div>
      </div>
    </div>
  </NuxtLink>
</template>
