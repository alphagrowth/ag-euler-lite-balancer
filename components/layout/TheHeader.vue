<script setup lang="ts">
import { onClickOutside } from '@vueuse/core'
import { offset, useFloating } from '@floating-ui/vue'
import { useAppKit } from '@reown/appkit/vue'
import { useAccount } from '@wagmi/vue'
import { WalletDisconnectModal, SelectChainModal } from '#components'
import { useModal } from '~/components/ui/composables/useModal'
import { links, socials } from '~/entities/custom'
import { type MenuItem, menuItems } from '~/entities/menu'

// AppKit modal controls
const { open } = useAppKit()

// Wagmi account info
const { address, isConnected } = useAccount()
const { chainId } = useEulerAddresses()
const modal = useModal()
const route = useRoute()

const reference = ref(null)
const floating = ref(null)
const isSocialsTooltipVisible = ref(false)

const { floatingStyles, update } = useFloating(reference, floating, {
  placement: 'bottom-start',
  middleware: [
    offset({ mainAxis: 10 }),
  ],
})

const onWalletButtonClick = () => {
  if (isConnected.value) {
    modal.open(WalletDisconnectModal)
  }
  else {
    open()
  }
}
const onChainButtonClick = () => {
  modal.open(SelectChainModal)
}
const onLogoClick = () => {
  isSocialsTooltipVisible.value = !isSocialsTooltipVisible.value
}
const getIsMenuItemActive = (link: MenuItem) => {
  if (link.name === 'index') {
    return route.name === 'index' || route.name?.toString().startsWith('lend')
  }

  return route.name?.toString().startsWith(link.name)
}

onClickOutside(reference, () => {
  isSocialsTooltipVisible.value = false
})
</script>

<template>
  <header
    :class="$style.TheHeader"
    class="flex justify-center bg-euler-dark-300"
  >
    <div
      :class="$style.wrap"
    >
      <button
        ref="reference"
        class="between align-center gap-8"
        :class="$style.logoWrap"
        @click="onLogoClick"
      >
        <img
          class="icon--32"
          src="/logo.png"
          alt="Euler"
        >
        <SvgIcon
          class="icon--18"
          :class="[$style.arrow, isSocialsTooltipVisible ? $style._open : '']"
          name="arrow-down"
        />
        <Transition
          name="tooltip"
          @enter="update"
          @after-enter="update"
        >
          <div
            v-show="isSocialsTooltipVisible"
            ref="floating"
            :style="floatingStyles"
            :class="$style.floating"
            @click.stop
          >
            <div class="column gap-4 w-100">
              <div class="mb-24">
                <p class="mb-8 text-euler-dark-800 h6 left">
                  Explore
                </p>

                <a
                  v-for="(link, index) in links"
                  :key="`link-${index}`"
                  :href="link.url"
                  :class="$style.docsLink"
                  class="flex gap-4 mb-4"
                  target="_blank"
                >
                  <span class="h6">{{ link.title }}</span>
                  <SvgIcon
                    class="icon--20 text-aquamarine-700"
                    name="arrow-top-right"
                  />
                </a>
              </div>
              <div class="flex gap-12">
                <a
                  v-for="item in Object.entries(socials)"
                  :key="item[0]"
                  :href="item[1]"
                  class="justify-center align-center p-8 text-aquamarine-1000 bg-euler-dark-500"
                  :class="$style.socialLink"
                  target="_blank"
                >
                  <SvgIcon
                    class="icon--20"
                    :name="item[0]"
                  />
                </a>
                <!-- <a
                  href="https://x.com/"
                  class="justify-center align-center p-8 text-aquamarine-1000 bg-euler-dark-500"
                  :class="$style.socialLink"
                  target="_blank"
                >
                  <SvgIcon
                    class="icon--20"
                    name="x"
                  />
                </a>
                <a
                  href="https://discord.com/"
                  class="justify-center align-center p-8 text-aquamarine-1000 bg-euler-dark-500"
                  :class="$style.socialLink"
                  target="_blank"
                >
                  <SvgIcon
                    class="icon--20"
                    name="discord"
                  />
                </a>
                <a
                  href="https://t.me/"
                  class="justify-center align-center p-8 text-aquamarine-1000 bg-euler-dark-500"
                  :class="$style.socialLink"
                  target="_blank"
                >
                  <SvgIcon
                    class="icon--20"
                    name="telegram"
                  />
                </a>
                <a
                  href="https://github.com/"
                  class="justify-center align-center p-8 text-aquamarine-1000 bg-euler-dark-500"
                  :class="$style.socialLink"
                  target="_blank"
                >
                  <SvgIcon
                    class="icon--20"
                    name="github"
                  />
                </a> -->
              </div>
            </div>
          </div>
        </Transition>
      </button>
      <div :class="$style.menu">
        <NuxtLink
          v-for="item in menuItems"
          :key="item.name"
          :to="{ name: item.name }"
          :class="[$style.menuItem, getIsMenuItemActive(item) ? $style._active : '']"
          class="text-white align-center center"
        >
          <UiIcon
            class="icon--20"
            :name="item.icon"
          />
          <span>{{ item.label }}</span>
        </NuxtLink>
      </div>
      <div :class="$style.buttons">
        <UiButton
          :class="$style.chain"
          icon="arrow-down"
          variant="primary-stroke"
          size="medium"
          icon-right
          @click="onChainButtonClick"
        >
          <BaseAvatar :src="`/chains/${chainId}.webp`" />
        </UiButton>
        <UiButton
          :icon="isConnected ? 'arrow-down' : 'plus'"
          :variant="isConnected ? 'primary-stroke' : 'primary'"
          size="medium"
          :icon-right="isConnected"
          @click="onWalletButtonClick"
        >
          {{ isConnected ? `${address?.slice(0, 6)}...${address?.slice(-4)}` : 'Connect wallet' }}
        </UiButton>
      </div>
    </div>
  </header>
</template>

<style lang="scss" module>
.TheHeader {
  position: sticky;
  top: 0;
  right: 0;
  left: 0;
  z-index: 101;
  min-height: 44px;
  border-bottom: 1px solid var(--c-euler-dark-600);
  padding: 22px 24px;

  @include respond-to(mobile) {
    min-height: 36px;
    border-bottom: none;
    padding: 16px;
  }
}

.wrap {
  display: flex;
  justify-content: space-between;
  height: 100%;
  width: 100%;
  align-items: center;

  @include respond-to(mobile) {
    max-width: var(--container-w);
    padding: 0;
  }
}

.menu {
  display: flex;
  width: 100%;
  max-width: 450px;
  margin: 0 16px;
  margin-left: 164px;

  @include respond-to(mobile) {
    display: none;
  }
}

.menuItem {
  display: flex;
  justify-content: center;
  gap: 8px;
  font-size: 12px;
  text-decoration: none;
  width: 100%;
  padding: 12px 0;
  border-radius: 8px;

  svg {
    color: var(--c-aquamarine-700);
  }

  &._active {
    background-color: var(--c-euler-dark-400);
  }
}

.logoWrap {
  position: relative;
  cursor: pointer;
  outline: none;
}

.arrow {
  transition: transform var(--trs-fast);

  &._open {
    transform: rotate(180deg);
  }
}

.floating {
  position: relative;
  max-width: calc(var(--container-w) / 2);
  width: max-content;
  padding: 16px;
  border-radius: 16px;
  background-color: var(--c-euler-dark-500);
  border: 1px solid var(--c-euler-dark-700);
  cursor: default;
}

.docsLink {
  color: var(--c-euler-dark-1000);
}

.socialLink {
  width: 36px;
  height: 36px;
  border-radius: 32px;
  border: 1px solid var(--c-euler-dark-600);
}

.chain {
  margin-right: 8px;
  padding: 6px 8px;
}

.buttons {
  display: flex;
  flex-wrap: nowrap;
}
</style>
