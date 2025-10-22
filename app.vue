<script setup lang="ts">
import { useAccount } from '@wagmi/vue'

const route = useRoute()
const router = useRouter()
const { loadEulerConfig } = useEulerAddresses()
const { loadVaults } = useVaults()
const { loadLabels } = useEulerLabels()
const { updateBalances } = useWallets()
const { isConnected } = useAccount()

const isMenuVisible = ref(true)
const isHeaderVisible = ref(true)
let interval: NodeJS.Timeout | null = null

const checkOnboarding = () => {
  const isOnboardingCompleted = useLocalStorage('is-onboarding-completed', false)
  if (!isOnboardingCompleted.value) {
    router.push('/onboarding')
  }
}

watch(route, () => {
  if (['onboarding', 'metrics'].includes(route.name as string)) {
    isMenuVisible.value = false
    isHeaderVisible.value = false
    return
  }

  nextTick(() => {
    isMenuVisible.value = ![
      'lend-vault',
      'lend-withdraw',
      'borrow-collateral-borrow',
      'position-number-repay',
      'position-number-supply',
      'position-number-borrow',
      'position-number-withdraw',
    ].includes(route.name as string)
    isHeaderVisible.value = true
  })
}, { immediate: true })

await loadEulerConfig()
checkOnboarding()
loadVaults()
loadLabels()

watch(isConnected, (val) => {
  if (val) {
    interval = setInterval(async () => {
      updateBalances()
    }, 10000)
  }
}, { immediate: true })

onUnmounted(() => {
  if (interval) {
    clearInterval(interval)
  }
})
</script>

<template>
  <TheHeader v-if="isHeaderVisible" />
  <main>
    <section
      class="page-wrapper"
      :class="{ 'page-wrapper--no-menu': !isMenuVisible }"
    >
      <div class="container">
        <NuxtLayout>
          <NuxtPage
            :transition="{ name: 'page', mode: 'out-in' }"
            :keepalive="{ include: ['IndexPage', 'BorrowPage', 'PortfolioPage'] }"
          />
        </NuxtLayout>
      </div>
    </section>
  </main>
  <UiModals />
  <UiToastContainer />
  <Transition name="page">
    <TheMenu v-show="isMenuVisible" />
  </Transition>
</template>

<style module lang="scss">
</style>
