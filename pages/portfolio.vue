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
  totalSuppliedValue,
  totalBorrowedValue,
  isPositionsLoaded,
} = useEulerAccount()
const { updateBorrowPositions, updateDepositPositions, isShowAllPositions } = useEulerAccount()
const { rewards } = useMerkl()
const { locks } = useREULLocks()
const { isConnected, address } = useAccount()
const { isLoaded: isBalancesLoaded, balances } = useWallets()
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
    badge: depositPositions.value.length || null,
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

const updatePositions = async () => {
  updateDepositPositions(balances.value, eulerLensAddresses.value, address.value as string)
  updateBorrowPositions(eulerLensAddresses.value, address.value as string)
}

watch(tabsModel, checkTab, { immediate: true })
onActivated(() => {
  checkTab()
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
  <section
    :class="$style.PortfolioPage"
    class="column gap-16"
  >
    <div class="align-center between px-16">
      <h2 class="h2">
        Your Portfolio
      </h2>
      <div class="align-center gap-8">
        <span class="h6">All positions/savings</span>
        <UiSwitch
          v-model="isShowAllPositions"
        />
      </div>
    </div>

    <div
      class="column gap-16 p-16 br-16 mx-16"
      :class="$style.assetsInfo"
    >
      <div class="between align-center">
        <div
          class="p2 text-euler-dark-900"
        >
          Net asset value
        </div>
        <BaseLoadableContent :loading="isConnected && (!isPositionsLoaded || !isBalancesLoaded)">
          <div class="h5 text-white">
            {{ `$${compactNumber(totalSuppliedValue - totalBorrowedValue)}` }}
          </div>
        </BaseLoadableContent>
      </div>
      <div class="between align-center">
        <div
          class="p2 text-euler-dark-900"
        >
          Total supplied value
        </div>
        <BaseLoadableContent :loading="isConnected && (!isPositionsLoaded || !isBalancesLoaded)">
          <div class="h5 text-white">
            {{ `$${compactNumber(totalSuppliedValue)}` }}
          </div>
        </BaseLoadableContent>
      </div>
      <div class="between align-center">
        <div
          class="p2 text-euler-dark-900"
        >
          Total borrowed value
        </div>
        <BaseLoadableContent :loading="isConnected && (!isPositionsLoaded || !isBalancesLoaded)">
          <div class="h5 text-white">
            {{ `$${compactNumber(totalBorrowedValue)}` }}
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

<style lang="scss" module>
.PortfolioPage {
  min-height: calc(100dvh - 178px);

  @include respond-to(mobile) {
    margin: 0 calc(var(--container-padding-side) * -1);
  }
}

.assetsInfo {
  border: 1px solid var(--c-euler-dark-600);
}

.tab {
  display: flex;
  flex-grow: 1;
  border: 1px solid var(--c-euler-dark-600);
}

.tabContent {
  flex-grow: 1;
}

.searchIcon {
  width: 48px;
  height: 48px;
}
</style>
