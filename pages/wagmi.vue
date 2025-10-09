<script setup lang="ts">
import { useAppKit } from '@reown/appkit/vue'
import { useAccount, useDisconnect } from '@wagmi/vue'

// AppKit modal controls
const { open } = useAppKit()

// Wagmi account info
const { address, isConnected, connector, chain } = useAccount()
const { disconnect } = useDisconnect()

// Wallet connection handlers
const handleConnect = () => {
  open()
}

const handleDisconnect = () => {
  disconnect()
}

// Format address for display
const formatAddress = (addr: string) => {
  if (!addr) return ''
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

// Watch for connection changes
watch(isConnected, (connected) => {
  if (connected) {
    console.log('Wallet connected:', address.value)
  }
  else {
    console.log('Wallet disconnected')
  }
})
</script>

<template>
  <div :class="$style.wagmiPage">
    <div :class="$style.content">
      <div
        class="bg-euler-dark-500 br-16 p-24"
        :class="$style.card"
      >
        <div :class="$style.connectionStatus">
          <div
            :class="[$style.statusIndicator, { [$style.connected]: isConnected }]"
          />
          <span class="h6 text-white">
            {{ isConnected ? 'Connected' : 'Disconnected' }}
          </span>
        </div>

        <div
          v-if="!isConnected"
          :class="$style.connectSection"
        >
          <p class="p2 text-euler-dark-900 center">
            Connect your EVM wallet to get started
          </p>
          <UiButton
            size="large"
            rounded
            @click="handleConnect"
          >
            Connect EVM Wallet
          </UiButton>
        </div>

        <div
          v-else
          :class="$style.walletInfo"
        >
          <h3 class="h4 text-white mb-20">
            Wallet Information
          </h3>

          <div class="column gap-12 mb-24">
            <div :class="$style.infoItem">
              <span class="p3 text-euler-dark-900">Address:</span>
              <span class="p3 text-white tabular-nums">{{ formatAddress(address || '') }}</span>
            </div>

            <div :class="$style.infoItem">
              <span class="p3 text-euler-dark-900">Full Address:</span>
              <div :class="$style.fullAddress">
                <span class="p3 text-white tabular-nums break-word">{{ address }}</span>
              </div>
            </div>

            <div
              v-if="chain"
              :class="$style.infoItem"
            >
              <span class="p3 text-euler-dark-900">Network:</span>
              <span class="p3 text-white">{{ chain.name }} ({{ chain.id }})</span>
            </div>

            <div
              v-if="connector"
              :class="$style.infoItem"
            >
              <span class="p3 text-euler-dark-900">Connector:</span>
              <span class="p3 text-white">{{ connector.name }}</span>
            </div>
          </div>

          <div class="flex gap-12 justify-center flex-wrap">
            <UiButton
              variant="secondary"
              @click="handleDisconnect"
            >
              Disconnect Wallet
            </UiButton>
            <UiButton
              variant="secondary-ghost"
              @click="open({ view: 'Account' })"
            >
              Account Settings
            </UiButton>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="scss" module>
@use '~/assets/styles/mixins';

.wagmiPage {
  background-color: var(--bg-body);
}

.content {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 24px;
  max-width: 100%;
  margin: 0 auto;
}

.card {
  width: 100%;
  transition: var(--trs-default);

  @include mixins.respond-to(mobile) {
    padding: 16px !important;
  }
}

.connectionStatus {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 24px;
  padding: 12px 16px;
  background-color: var(--c-euler-dark-400);
  border-radius: 8px;
}

.statusIndicator {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background-color: var(--c-red-600);
  transition: background-color var(--trs-default);

  &.connected {
    background-color: var(--c-green-600);
  }
}

.connectSection {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 24px;
}

.walletInfo {
  animation: fadeIn 0.5s ease-in-out;
}

.infoItem {
  display: grid;
  grid-template-columns: 100px 1fr;
  gap: 16px;
  padding: 12px 16px;
  background-color: var(--c-euler-dark-400);
  border-radius: 8px;
  align-items: center;

  @include mixins.respond-to(mobile) {
    grid-template-columns: 1fr;
    gap: 8px;
  }
}

.fullAddress {
  padding: 8px 12px;
  background-color: var(--c-euler-dark-300);
  border-radius: 6px;
  border: 1px solid var(--c-euler-dark-600);
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
