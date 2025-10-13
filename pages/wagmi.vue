<script setup lang="ts">
import { useAppKit } from '@reown/appkit/vue'
import { useAccount, useDisconnect, useBalance } from '@wagmi/vue'
import { formatUnits } from 'viem'

// AppKit modal controls
const { open } = useAppKit()

// Wagmi account info
const { address, isConnected, connector, chain } = useAccount()
const { disconnect } = useDisconnect()

// Get ETH balance - this is how DeFi apps retrieve user balances
const { data: balance, isLoading: isLoadingBalance } = useBalance({
  address: address,
})

// Get USDT balance on Arbitrum - this is how DeFi apps retrieve ERC-20 token balances
// USDT contract address on Arbitrum
const USDT_ARBITRUM = '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9'
const { data: usdtBalance, isLoading: isLoadingUsdt } = useBalance({
  address: address,
  token: USDT_ARBITRUM, // Pass the token contract address to get ERC-20 balance
})

// Format balance helper
const formattedBalance = computed(() => {
  if (!balance.value) return null
  return formatUnits(balance.value.value, balance.value.decimals)
})

const formattedUsdtBalance = computed(() => {
  if (!usdtBalance.value) return null
  return formatUnits(usdtBalance.value.value, usdtBalance.value.decimals)
})

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

            <div :class="$style.balanceItem">
              <span class="p3 text-euler-dark-900">ETH Balance:</span>
              <div v-if="isLoadingBalance">
                <span class="p3 text-euler-dark-700">Loading...</span>
              </div>
              <div v-else-if="balance && formattedBalance">
                <span class="h5 text-white tabular-nums">
                  {{ parseFloat(formattedBalance).toFixed(6) }} {{ balance.symbol }}
                </span>
                <span class="p4 text-euler-dark-800 ml-8">
                  ({{ balance.value.toString() }} wei)
                </span>
              </div>
              <div v-else>
                <span class="p3 text-euler-dark-700">No balance</span>
              </div>
            </div>

            <div :class="$style.tokenBalanceItem">
              <div :class="$style.tokenHeader">
                <span class="p3 text-euler-dark-900">USDT Balance (Arbitrum):</span>
                <span class="p4 text-euler-dark-800">{{ USDT_ARBITRUM }}</span>
              </div>
              <div v-if="isLoadingUsdt">
                <span class="p3 text-euler-dark-700">Loading...</span>
              </div>
              <div v-else-if="usdtBalance && formattedUsdtBalance">
                <span class="h5 text-white tabular-nums">
                  {{ parseFloat(formattedUsdtBalance).toFixed(2) }} {{ usdtBalance.symbol }}
                </span>
                <span class="p4 text-euler-dark-800 ml-8">
                  (Decimals: {{ usdtBalance.decimals }})
                </span>
              </div>
              <div v-else>
                <span class="p3 text-euler-dark-700">No balance</span>
              </div>
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

.balanceItem {
  display: grid;
  grid-template-columns: 100px 1fr;
  gap: 16px;
  padding: 16px;
  background: linear-gradient(135deg, var(--c-euler-dark-400) 0%, var(--c-euler-dark-500) 100%);
  border-radius: 8px;
  border: 1px solid var(--c-green-600);
  align-items: center;

  @include mixins.respond-to(mobile) {
    grid-template-columns: 1fr;
    gap: 8px;
  }
}

.tokenBalanceItem {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  background: linear-gradient(135deg, var(--c-euler-dark-400) 0%, var(--c-euler-dark-500) 100%);
  border-radius: 8px;
  border: 1px solid #26A17B;

  @include mixins.respond-to(mobile) {
    padding: 12px;
  }
}

.tokenHeader {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--c-euler-dark-600);
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
