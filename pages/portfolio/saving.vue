<script setup lang="ts">
import { useAccount } from '@wagmi/vue'

const { isConnected } = useAccount()
const { depositPositions, isDepositsLoaded } = useEulerAccount()
const { isReady } = useVaults()
const { isEarnVault } = useVaultRegistry()

const earnItems = computed(() => depositPositions.value.filter(p => isEarnVault(p.vault.address)))
const lendItems = computed(() => depositPositions.value.filter(p => !isEarnVault(p.vault.address)))
</script>

<template>
  <div class="mx-16">
    <div class="flex justify-between items-center mb-8">
      <h3 class="text-h3 font-normal text-neutral-800">
        Managed lending
      </h3>
    </div>
    <p class="text-p2 text-neutral-500 mb-16">
      Savings are supply-only deposits that earn you yield. They are not used as collateral to back a borrowing position.
    </p>
    <div class="flex flex-1 p-8 rounded-12 mb-16 border border-line-default bg-card">
      <div
        v-if="isConnected && (!isDepositsLoaded || (!isReady && earnItems.length === 0))"
        class="flex flex-1 justify-center items-center"
      >
        <UiLoader class="text-neutral-500 my-8" />
      </div>
      <div
        v-else-if="earnItems.length === 0"
        class="flex flex-1 justify-center items-center"
      >
        <div class="flex flex-col gap-8 items-center text-neutral-500 py-32">
          <div class="flex w-48 h-48 justify-center items-center rounded-12 bg-neutral-100">
            <SvgIcon name="search" />
          </div>
          <template v-if="isConnected">
            You don't have savings yet
          </template>
          <template v-else>
            Connect your wallet to see your savings
          </template>
        </div>
      </div>
      <div
        v-else
        class="flex-1"
      >
        <PortfolioList
          :items="earnItems"
          type="earn"
        />
        <div
          v-if="!isReady"
          class="flex justify-center items-center mt-12"
        >
          <UiLoader class="text-neutral-500" />
        </div>
      </div>
    </div>

    <div class="flex justify-between items-center mb-8">
      <h3 class="text-h3 font-normal text-neutral-800">
        Direct lending
      </h3>
    </div>
    <p class="text-p2 text-neutral-500 mb-16">
      Savings are supply-only deposits on your main account that earn you yield. They are not used as collateral to back a borrowing position.
    </p>
    <div class="flex flex-1 p-8 rounded-12 border border-line-default bg-card">
      <div
        v-if="isConnected && (!isDepositsLoaded || !isReady)"
        class="flex flex-1 justify-center items-center"
      >
        <UiLoader class="text-neutral-500 my-8" />
      </div>
      <div
        v-else-if="lendItems.length === 0"
        class="flex flex-1 justify-center items-center"
      >
        <div class="flex flex-col gap-8 items-center text-neutral-500 py-32">
          <div class="flex w-48 h-48 justify-center items-center rounded-12 bg-neutral-100">
            <SvgIcon name="search" />
          </div>
          <template v-if="isConnected">
            You don't have savings yet
          </template>
          <template v-else>
            Connect your wallet to see your savings
          </template>
        </div>
      </div>
      <div
        v-else
        class="flex-1"
      >
        <PortfolioList
          :items="lendItems"
          type="lend"
        />
      </div>
    </div>
  </div>
</template>
