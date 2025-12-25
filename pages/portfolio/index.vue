<script setup lang="ts">
import { useAccount } from '@wagmi/vue'

const { isConnected } = useAccount()
const { borrowPositions, isPositionsLoaded } = useEulerAccount()
const { isReady } = useVaults()
</script>

<template>
  <div class="flex flex-1 mx-16 p-8 rounded-16 border border-euler-dark-600">
    <div
      v-if="isConnected && (!isPositionsLoaded || (!isReady && borrowPositions.length === 0))"
      class="flex flex-1 justify-center items-center"
    >
      <UiLoader class="text-euler-dark-900" />
    </div>

    <div
      v-else-if="borrowPositions.length === 0"
      class="flex flex-1 justify-center items-center"
    >
      <div class="flex flex-col gap-8 items-center text-euler-dark-900">
        <div class="flex w-48 h-48 justify-center items-center rounded-12 bg-euler-dark-500">
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
        <UiLoader class="text-euler-dark-900" />
      </div>
    </div>
  </div>
</template>
