<script setup lang="ts">
import { onClickOutside } from '@vueuse/core'
import { offset, useFloating } from '@floating-ui/vue'
import { useAppKit } from '@reown/appkit/vue'
import { useAccount } from '@wagmi/vue'
import { WalletDisconnectModal, SelectChainModal } from '#components'
import { useModal } from '~/components/ui/composables/useModal'

// AppKit modal controls
const { open } = useAppKit()

// Wagmi account info
const { address, isConnected } = useAccount()
const { chainId: _chainId } = useEulerAddresses()
const { chainId } = useWagmi()
const modal = useModal()

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

onClickOutside(reference, () => {
  isSocialsTooltipVisible.value = false
})
</script>

<template>
  <header
    :class="$style.TheHeader"
    class="flex justify-center p-16 bg-euler-dark-300"
  >
    <div
      :class="$style.wrap"
      class="between align-center"
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
                  Explore Euler
                </p>
                <a
                  href="https://docs.euler.finance/"
                  :class="$style.docsLink"
                  class="flex gap-4 mb-4"
                  target="_blank"
                >
                  <span class="h6">Docs</span>
                  <SvgIcon
                    class="icon--20 text-aquamarine-700"
                    name="arrow-top-right"
                  />
                </a>
                <a
                  href="https://app.euler.finance/terms?network=tac"
                  :class="$style.docsLink"
                  class="flex gap-4"
                  target="_blank"
                >
                  <span class="h6">Terms of Use</span>
                  <SvgIcon
                    class="icon--20 text-aquamarine-700"
                    name="arrow-top-right"
                  />
                </a>
              </div>
              <div class="flex gap-12">
                <a
                  href="https://x.com/eulerfinance"
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
                  href="https://discord.euler.finance/"
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
                  href="https://t.me/eulerfinance_official"
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
                  href="https://github.com/euler-xyz"
                  class="justify-center align-center p-8 text-aquamarine-1000 bg-euler-dark-500"
                  :class="$style.socialLink"
                  target="_blank"
                >
                  <SvgIcon
                    class="icon--20"
                    name="github"
                  />
                </a>
              </div>
            </div>
          </div>
        </Transition>
      </button>
      <div>
        <UiButton
          :class="$style.chain"
          icon="arrow-down"
          variant="primary-stroke"
          size="medium"
          icon-right
          @click="onChainButtonClick"
        >
          <BaseAvatar :src="`/chains/${chainId || _chainId}.webp`" />
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
  min-height: 36px;
  //box-shadow: 0px 4px 6px 4px var(--c-euler-dark-300);
}

.wrap {
  height: 100%;
  width: 100%;
  max-width: var(--container-w);
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
</style>
