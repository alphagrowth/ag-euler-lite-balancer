<script setup lang="ts">
import { useAccount } from '@wagmi/vue'

const { isConnected } = useAccount()
const { borrowPositions, isPositionsLoaded } = useEulerAccount()
const { isReady } = useVaults()
</script>

<template>
  <div class="flex flex-1 mx-16 p-8 rounded-12 border border-line-default bg-surface shadow-card">
    <div
      v-if="isConnected && (!isPositionsLoaded || (!isReady && borrowPositions.length === 0))"
      class="flex flex-1 justify-center items-center"
    >
      <UiLoader class="text-content-tertiary" />
    </div>

    <div
      v-else-if="borrowPositions.length === 0"
      class="flex flex-1 justify-center items-center"
    >
      <div class="flex flex-col gap-8 items-center text-content-tertiary">
        <div class="flex w-48 h-48 justify-center items-center rounded-12 bg-surface-secondary">
          <SvgIcon name="search" />
        </div>
        <template v-if="isConnected">
          You don't have positions yet
        </template>
        <template v-else>
          Connect your wallet to see your positions
        </template>
      </div>
    </div>

    <div
      v-else
      class="flex-1"
    >
      <PortfolioList
        :items="borrowPositions"
        type="borrow"
      />
      <div
        v-if="!isReady"
        class="flex justify-center items-center mt-12"
      >
        <UiLoader class="text-content-tertiary" />
      </div>
    </div>
  </div>
</template>
