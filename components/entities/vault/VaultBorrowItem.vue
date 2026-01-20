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
const { withIntrinsicBorrowApy, withIntrinsicSupplyApy } = useIntrinsicApy()
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
const supplyApy = computed(() => withIntrinsicSupplyApy(
  nanoToValue(pair.collateral.interestRateInfo.supplyAPY, 25),
  pair.collateral.asset.symbol,
))
const borrowApy = computed(() => withIntrinsicBorrowApy(
  nanoToValue(pair.borrow.interestRateInfo.borrowAPY, 25),
  pair.borrow.asset.symbol,
))
const supplyApyWithRewards = computed(() => supplyApy.value + totalRewardsAPY.value)
const borrowApyWithRewards = computed(() => borrowApy.value - totalRewardsAPY.value)
const maxMultiplier = computed(() => {
  const ltv = pair.borrowLTV || 0n
  const base = 10000n
  if (ltv <= 0n || ltv >= base) {
    return 1
  }
  const result = (base * ltv) / (base - ltv) - 200n + base
  const value = Number(result) / 10000
  if (!Number.isFinite(value)) {
    return 1
  }
  return Math.max(1, Math.floor(value * 100) / 100)
})
const netApy = computed(() => supplyApyWithRewards.value - borrowApyWithRewards.value)
const maxRoe = computed(() => {
  const multiplier = maxMultiplier.value
  const base = supplyApyWithRewards.value
  const net = netApy.value
  if (!Number.isFinite(multiplier) || !Number.isFinite(base) || !Number.isFinite(net)) {
    return 0
  }
  return base + (multiplier - 1) * net
})
const maxLTV = computed(() => formatNumber(nanoToValue(pair.borrowLTV, 2), 2))
const utilization = computed(() => getVaultUtilization(pair.collateral))

const onWarningClick = () => {
  modal.open(VaultUtilizationWarningModal)
}
</script>

<template>
  <NuxtLink
    :to="`/borrow/${pair.collateral.address}/${pair.borrow.address}`"
    class="block no-underline text-white bg-euler-dark-500 rounded-16"
  >
    <div class="flex py-16 px-16 pb-12 border-b border-border-primary">
      <BaseAvatar
        :src="[pair.collateral.asset.symbol, pair.borrow.asset.symbol].map(s => getAssetLogoUrl(s))"
        :label="[pair.collateral.asset.symbol, pair.borrow.asset.symbol]"
        class="icon--40"
      />
      <div class="flex-grow ml-12">
        <div class="text-euler-dark-900 text-p3 mb-4">
          {{ pairName }}
        </div>
        <div class="text-h5">
          {{ [pair.collateral.asset.symbol, pair.borrow.asset.symbol].join('/') }}
        </div>
      </div>
      <div class="flex flex-col items-end">
        <div class="text-euler-dark-900 text-p3 mb-4 text-right">
          Borrow APY
        </div>
        <div
          class="text-p2 flex text-aquamarine-700"
        >
          <SvgIcon
            v-if="hasRewards"
            class="!w-20 !h-20 text-aquamarine-700 mr-4"
            name="sparks"
          />{{ formatNumber(borrowApyWithRewards) }}%
        </div>
      </div>
    </div>
    <div class="flex py-12 px-16 pb-12 justify-between mobile:border-b mobile:border-border-primary">
      <div>
        <div class="text-euler-dark-900 text-p3 mb-4">
          Liquidity
        </div>
        <div class="text-p2">
          {{ `$${compactNumber(getVaultPrice(pair.borrow.supply - pair.borrow.borrow, pair.borrow))}` }}
        </div>
      </div>
      <div class="text-center">
        <div class="text-euler-dark-900 text-p3 mb-4">
          Supply APY
        </div>
        <div class="text-p2">
          {{ formatNumber(supplyApyWithRewards) }}%
        </div>
      </div>
      <div class="text-center mobile:!hidden">
        <div class="text-euler-dark-900 text-p3 mb-4">
          Max ROE
        </div>
        <div class="text-p2">
          {{ formatNumber(maxRoe, 2, 2) }}%
        </div>
      </div>
      <div class="text-center mobile:!hidden">
        <div class="text-euler-dark-900 text-p3 mb-4">
          Max Multiplier
        </div>
        <div class="text-p2">
          {{ formatNumber(maxMultiplier, 2, 2) }}x
        </div>
      </div>
      <div
        class="flex flex-col justify-center items-center mobile:!hidden"
      >
        <div class="text-euler-dark-900 text-p3 mb-4">
          Max LTV
        </div>
        <div class="text-p2">
          {{ compactNumber(maxLTV, 2, 2) }}%
        </div>
      </div>
      <div
        class="flex flex-col justify-center items-center mobile:!hidden"
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
      <div class="text-right">
        <div class="text-euler-dark-900 text-p3 mb-4">
          LLTV
        </div>
        <div class="text-p2">
          {{ pair.liquidationLTV / 100n }}%
        </div>
      </div>
    </div>
    <div class="hidden mobile:flex mobile:flex-col gap-12 py-12 px-16 pb-16">
      <div class="flex w-full justify-between">
        <div class="flex-1">
          <div class="text-euler-dark-900 text-p3">
            Max LTV
          </div>
        </div>
        <div
          class="flex gap-8 justify-end items-center text-right flex-1"
        >
          <div class="text-p2">
            {{ compactNumber(maxLTV, 2, 2) }}%
          </div>
        </div>
      </div>
      <div class="flex w-full justify-between">
        <div class="flex-1">
          <div class="text-euler-dark-900 text-p3">
            Max ROE
          </div>
        </div>
        <div
          class="flex gap-8 justify-end items-center text-right flex-1"
        >
          <div class="text-p2">
            {{ formatNumber(maxRoe, 2, 2) }}%
          </div>
        </div>
      </div>
      <div class="flex w-full justify-between">
        <div class="flex-1">
          <div class="text-euler-dark-900 text-p3">
            Max Multiplier
          </div>
        </div>
        <div
          class="flex gap-8 justify-end items-center text-right flex-1"
        >
          <div class="text-p2">
            {{ formatNumber(maxMultiplier, 2, 2) }}x
          </div>
        </div>
      </div>
      <div class="flex w-full justify-between">
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
    </div>
  </NuxtLink>
</template>
