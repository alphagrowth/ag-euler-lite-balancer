<script setup lang="ts">
import { useAccount } from '@wagmi/vue'
import { useAppKit } from '@reown/appkit/vue'
import { getDefaultPageRoute } from '~/entities/menu'

const { isConnected } = useAccount()

const { open } = useAppKit()
const { appTitle, appDescription, enableEarnPage, enableLendPage } = useDeployConfig()
const defaultPageRoute = getDefaultPageRoute(enableEarnPage, enableLendPage)

const isOnboardingCompleted = useLocalStorage('is-onboarding-completed', false)

const onConnectWalletClick = () => {
  open()
}

const onConnectLaterClick = () => {
  isOnboardingCompleted.value = true
  navigateTo(`/${defaultPageRoute}`)
}

watch(isConnected, (value) => {
  if (value) {
    isOnboardingCompleted.value = true
    navigateTo(`/${defaultPageRoute}`)
  }
}, { immediate: true })
</script>

<template>
  <section class="w-full h-dvh -mt-16 -mb-[98px]">
    <div class="relative flex flex-col items-center justify-between gap-24 h-full pb-64 mobile:-mx-16">
      <div
        class="flex-1 w-full h-full bg-[url('/onboarding-pattern.png')] bg-cover bg-bottom bg-no-repeat -z-10"
      />
      <div class="flex flex-col items-center gap-24 w-full px-16">
        <img
          src="/logo.png"
          alt="Euler Logo"
          class="w-[75px] h-[75px]"
        >
        <div class="text-h1 text-center w-[240px]">
          {{ appTitle }}
        </div>
        <div class="text-euler-dark-900 text-center">
          {{ appDescription }}
        </div>
        <div class="flex flex-col gap-8 w-full">
          <UiButton
            size="large"
            rounded
            @click="onConnectWalletClick"
          >
            Connect wallet
          </UiButton>
          <UiButton
            size="large"
            rounded
            variant="secondary"
            @click="onConnectLaterClick"
          >
            Connect later
          </UiButton>
        </div>
      </div>
    </div>
  </section>
</template>
