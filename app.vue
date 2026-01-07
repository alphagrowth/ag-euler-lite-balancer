<script setup lang="ts">
import { useAccount } from '@wagmi/vue'

const route = useRoute()
const router = useRouter()
const { loadEulerConfig, chainId } = useEulerAddresses()
const { loadVaults, isReady: isVaultsReady, resetVaultsState } = useVaults()
const { loadTokens } = useTokens()
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
      'earn-vault',
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

watch(chainId, () => {
  resetVaultsState()
  const targetChainId = chainId.value
  const labelsPromise = loadLabels()
  void loadTokens()
  void labelsPromise.then(() => {
    if (chainId.value !== targetChainId) return
    void loadVaults()
  })
}, { immediate: true })

watch([isConnected, isVaultsReady], ([val]) => {
  if (val && isVaultsReady.value) {
    updateBalances()
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
      class="flex justify-center pt-32 mobile:pt-16"
      :class="isMenuVisible ? 'pb-[98px]' : 'pb-16'"
    >
      <div class="w-full max-w-container mx-16 mobile:px-16 mobile:mx-0">
        <NuxtLayout>
          <NuxtPage
            :transition="{ name: 'page', mode: 'out-in' }"
            :keepalive="{ include: ['EarnPage', 'IndexPage', 'BorrowPage', 'PortfolioPage'] }"
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
