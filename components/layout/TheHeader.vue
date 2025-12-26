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
    class="sticky top-0 right-0 left-0 z-[101] min-h-44 border-b border-euler-dark-600 py-22 px-24 mobile:min-h-36 mobile:border-b-0 mobile:p-16 flex justify-center bg-euler-dark-300"
  >
    <div
      class="flex justify-between h-full w-full items-center mobile:max-w-container mobile:p-0"
    >
      <button
        ref="reference"
        class="flex justify-between items-center gap-8 relative cursor-pointer outline-none"
        @click="onLogoClick"
      >
        <img
          class="!w-32 !h-32"
          src="/logo.png"
          alt="Euler"
        >
        <SvgIcon
          class="!w-18 !h-18 transition-transform duration-fast"
          :class="[isSocialsTooltipVisible ? 'rotate-180' : '']"
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
            class="relative max-w-[400px] w-max p-16 rounded-16 bg-euler-dark-500 border border-euler-dark-700 cursor-default"
            @click.stop
          >
            <div class="flex flex-col gap-4 w-full">
              <div class="mb-24">
                <p class="mb-8 text-euler-dark-800 text-h6 text-left">
                  Explore
                </p>

                <a
                  v-for="(link, index) in links"
                  :key="`link-${index}`"
                  :href="link.url"
                  class="flex gap-4 mb-4 text-euler-dark-1000"
                  target="_blank"
                >
                  <span class="text-h6">{{ link.title }}</span>
                  <SvgIcon
                    class="!w-20 !h-20 text-aquamarine-700"
                    name="arrow-top-right"
                  />
                </a>
              </div>
              <div class="flex gap-12">
                <a
                  v-for="item in Object.entries(socials)"
                  :key="item[0]"
                  :href="item[1]"
                  class="justify-center items-center p-8 text-aquamarine-1000 bg-euler-dark-500 w-36 h-36 rounded-[32px] border border-euler-dark-600"
                  target="_blank"
                >
                  <SvgIcon
                    class="!w-20 !h-20"
                    :name="item[0]"
                  />
                </a>
                <!-- <a
                  href="https://x.com/"
                  class="justify-center items-center p-8 text-aquamarine-1000 bg-euler-dark-500"
                  :class="$style.socialLink"
                  target="_blank"
                >
                  <SvgIcon
                    class="!w-20 !h-20"
                    name="x"
                  />
                </a>
                <a
                  href="https://discord.com/"
                  class="justify-center items-center p-8 text-aquamarine-1000 bg-euler-dark-500"
                  :class="$style.socialLink"
                  target="_blank"
                >
                  <SvgIcon
                    class="!w-20 !h-20"
                    name="discord"
                  />
                </a>
                <a
                  href="https://t.me/"
                  class="justify-center items-center p-8 text-aquamarine-1000 bg-euler-dark-500"
                  :class="$style.socialLink"
                  target="_blank"
                >
                  <SvgIcon
                    class="!w-20 !h-20"
                    name="telegram"
                  />
                </a>
                <a
                  href="https://github.com/"
                  class="justify-center items-center p-8 text-aquamarine-1000 bg-euler-dark-500"
                  :class="$style.socialLink"
                  target="_blank"
                >
                  <SvgIcon
                    class="!w-20 !h-20"
                    name="github"
                  />
                </a> -->
              </div>
            </div>
          </div>
        </Transition>
      </button>
      <div class="flex w-full max-w-[450px] !ml-[164px] mr-16 mobile:!hidden">
        <NuxtLink
          v-for="item in menuItems"
          :key="item.name"
          :to="{ name: item.name }"
          class="flex gap-8 text-[12px] no-underline w-full py-12 rounded-8 text-white items-center justify-center"
          :class="[getIsMenuItemActive(item) ? 'bg-euler-dark-400' : '']"
        >
          <UiIcon
            class="!w-20 !h-20 text-aquamarine-700"
            :name="item.icon"
          />
          <span>{{ item.label }}</span>
        </NuxtLink>
      </div>
      <div class="flex flex-nowrap flex-shrink-0">
        <UiButton
          class="mr-8 py-6 px-8"
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
