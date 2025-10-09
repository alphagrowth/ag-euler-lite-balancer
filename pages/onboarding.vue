<script setup lang="ts">
const {
  isLoaded,
  isConnected,
  tonConnectUI,
} = useTonConnect()

const isOnboardingCompleted = useLocalStorage('is-onboarding-completed', false)

if (isOnboardingCompleted.value) {
  navigateTo('/')
}

const onConnectWalletClick = () => {
  tonConnectUI.openModal()
}

const onConnectLaterClick = () => {
  isOnboardingCompleted.value = true
  navigateTo('/')
}

watch(isConnected, (value) => {
  if (value) {
    isOnboardingCompleted.value = true
    navigateTo('/')
  }
}, { immediate: true })
</script>

<template>
  <section :class="$style.OnboardingPage">
    <div :class="$style.contentWrapper">
      <div :class="$style.bg" />
      <div :class="$style.content">
        <img
          src="/logo.png"
          alt="Euler Logo"
          :class="$style.image"
        >
        <div
          class="h1 center"
          :class="$style.title"
        >
          The Lending Super App
        </div>
        <div class="text-euler-dark-900 center">
          Lend, borrow and build without limits.
        </div>
        <div
          v-show="isLoaded"
          class="column gap-8"
          :class="$style.buttons"
        >
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

<style lang="scss" module>
.OnboardingPage {
  width: 100%;
  height: 100dvh;
  margin-top: -16px;
  margin-bottom: -98px;
}

.contentWrapper {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  height: 100%;
  padding-bottom: 16px;

  @include respond-to(mobile) {
    margin-left: calc(var(--container-padding-side) * -1);
    margin-right: calc(var(--container-padding-side) * -1);
  }
}

.bg {
  flex-grow: 1;
  width: 100%;
  height: 100%;
  background-image: url('/onboarding-pattern.png');
  background-size: cover;
  background-position: bottom center;
  background-repeat: no-repeat;
  z-index: -1;
}

.content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 24px;
  width: 100%;
  padding: 0 16px;
}

.image {
  width: 75px;
  height: 75px;
}

.title {
  width: 240px;
}

.buttons {
  width: 100%;
}
</style>
