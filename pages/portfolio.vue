<script setup lang="ts">
import { useAccount } from '@wagmi/vue'

defineOptions({
  name: 'PortfolioPage',
})

const route = useRoute()
const router = useRouter()
const {
  borrowPositions,
  depositPositions,
  earnPositions,
  totalSuppliedValueInfo,
  totalBorrowedValueInfo,
  isPositionsLoaded,
  isShowAllPositions,
  updateBorrowPositions,
  updateDepositPositions,
  updateEarnPositions,
} = useEulerAccount()
const { rewards } = useMerkl()
const { locks } = useREULLocks()
const { isConnected, address } = useAccount()
const { isLoaded: isBalancesLoaded, balances, updateBalances } = useWallets()
const { eulerLensAddresses } = useEulerAddresses()

const interval: Ref<NodeJS.Timeout | null> = ref(null)

const tabsModel = ref(route.name as string)

const tabs = computed(() => [
  {
    label: 'Positions',
    value: 'portfolio',
    badge: borrowPositions.value.length || null,
  },
  {
    label: 'Savings',
    value: 'portfolio-saving',
    badge: depositPositions.value.length + earnPositions.value.length || null,
  },
  {
    label: 'Rewards',
    value: 'portfolio-rewards',
    badge: rewards.value.length + locks.value.length || null,
  },
])

const checkTab = () => {
  if (route.name !== tabsModel.value) {
    router.replace({ name: tabsModel.value })
  }
}

const updatePositions = () => {
  updateDepositPositions(eulerLensAddresses.value, address.value as string)
  updateEarnPositions(balances.value, eulerLensAddresses.value, address.value as string)
  updateBorrowPositions(eulerLensAddresses.value, address.value as string)
}

watch(tabsModel, checkTab, { immediate: true })
onActivated(async () => {
  checkTab()
  await updateBalances()
  updatePositions()
  interval.value = setInterval(updatePositions, 10000)
})
onDeactivated(() => {
  if (interval.value) {
    clearInterval(interval.value)
  }
})
</script>

<template>
  <section class="flex flex-col gap-16 min-h-[calc(100dvh-178px)] mobile:-mx-16">
    <div class="flex items-center justify-between px-16">
      <h2 class="text-h2 text-content-primary">
        Your Portfolio
      </h2>
      <div class="flex items-center gap-8">
        <span class="text-h6 text-content-secondary">All positions/savings</span>
        <UiSwitch
          v-model="isShowAllPositions"
        />
      </div>
    </div>

    <div class="flex flex-col gap-16 p-16 rounded-12 mx-16 border border-line-default bg-card shadow-card">
      <div class="flex justify-between items-center">
        <div class="text-p2 text-content-secondary">
          Net asset value
        </div>
        <BaseLoadableContent :loading="isConnected && (!isPositionsLoaded || !isBalancesLoaded)">
          <div class="flex items-center gap-4 text-h5 text-content-primary">
            {{ (() => {
              const netValue = totalSuppliedValueInfo.total - totalBorrowedValueInfo.total
              const hasMissing = totalSuppliedValueInfo.hasMissingPrices || totalBorrowedValueInfo.hasMissingPrices
              if (netValue === 0 && hasMissing) return '—'
              return formatCompactUsdValue(netValue)
            })() }}
            <UiFootnote
              v-if="(totalSuppliedValueInfo.hasMissingPrices || totalBorrowedValueInfo.hasMissingPrices) && (totalSuppliedValueInfo.total - totalBorrowedValueInfo.total) !== 0"
              title="Incomplete pricing"
              text="Some assets in your portfolio don't have price data available. The displayed value may be higher than shown."
              tooltip-placement="top-end"
            />
          </div>
        </BaseLoadableContent>
      </div>
      <div class="flex justify-between items-center">
        <div class="text-p2 text-content-secondary">
          Total supplied value
        </div>
        <BaseLoadableContent :loading="isConnected && (!isPositionsLoaded || !isBalancesLoaded)">
          <div class="flex items-center gap-4 text-h5 text-content-primary">
            {{ (() => {
              const { total, hasMissingPrices } = totalSuppliedValueInfo
              if (total === 0 && hasMissingPrices) return '—'
              return formatCompactUsdValue(total)
            })() }}
            <UiFootnote
              v-if="totalSuppliedValueInfo.hasMissingPrices && totalSuppliedValueInfo.total !== 0"
              title="Incomplete pricing"
              text="Some supplied assets don't have price data available. The displayed value may be higher than shown."
              tooltip-placement="top-end"
            />
          </div>
        </BaseLoadableContent>
      </div>
      <div class="flex justify-between items-center">
        <div class="text-p2 text-content-secondary">
          Total borrowed value
        </div>
        <BaseLoadableContent :loading="isConnected && (!isPositionsLoaded || !isBalancesLoaded)">
          <div class="flex items-center gap-4 text-h5 text-content-primary">
            {{ (() => {
              const { total, hasMissingPrices } = totalBorrowedValueInfo
              if (total === 0 && hasMissingPrices) return '—'
              return formatCompactUsdValue(total)
            })() }}
            <UiFootnote
              v-if="totalBorrowedValueInfo.hasMissingPrices && totalBorrowedValueInfo.total !== 0"
              title="Incomplete pricing"
              text="Some borrowed assets don't have price data available. The displayed value may be higher than shown."
              tooltip-placement="top-end"
            />
          </div>
        </BaseLoadableContent>
      </div>
    </div>

    <UiTabs
      v-model="tabsModel"
      rounded
      :list="tabs"
    />

    <NuxtPage />
  </section>
</template>
