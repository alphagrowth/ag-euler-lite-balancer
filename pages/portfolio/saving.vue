<script setup lang="ts">
import { useAccount } from '@wagmi/vue'

const { isConnected } = useAccount()
const { depositPositions, earnPositions, isDepositsLoaded } = useEulerAccount()
const { isReady } = useVaults()
</script>

<template>
  <div
    :class="$style.SavingsPage"
    class="mx-16"
  >
    <div class="between align-center mb-8">
      <h3 class="h3 weight-400">
        Managed lending
      </h3>
    </div>
    <p class="p2 text-euler-dark-900 mb-16">
      Savings are supply-only deposits that earn you yield. They are not used as collateral to back a borrowing position.
    </p>
    <div
      :class="$style.savingsSection"
      class="flex p-8 br-16 mb-16"
    >
      <div
        v-if="isConnected && (!isDepositsLoaded || (!isReady && earnPositions.length === 0))"
        class="justify-center align-center"
        :class="$style.tabContent"
      >
        <UiLoader class="text-euler-dark-900 my-8" />
      </div>
      <div
        v-else-if="earnPositions.length === 0"
        class="justify-center align-center"
        :class="$style.tabContent"
      >
        <div class="column gap-8 align-center text-euler-dark-900 py-32">
          <div
            :class="$style.searchIcon"
            class="justify-center align-center br-12 bg-euler-dark-500"
          >
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
        :class="$style.tabContent"
      >
        <PortfolioList
          :items="earnPositions"
          type="earn"
        />
        <div
          v-if="!isReady"
          class="justify-center align-center mt-12"
        >
          <UiLoader class="text-euler-dark-900" />
        </div>
      </div>
    </div>
    <div class="between align-center mb-8">
      <h3 class="h3 weight-400">
        Direct lending
      </h3>
    </div>
    <p class="p2 text-euler-dark-900 mb-16">
      Savings are supply-only deposits on your main account that earn you yield. They are not used as collateral to back a borrowing position.
    </p>
    <div
      :class="$style.savingsSection"
      class="flex p-8 br-16"
    >
      <div
        v-if="isConnected && (!isDepositsLoaded || (!isReady && depositPositions.length === 0))"
        class="justify-center align-center"
        :class="$style.tabContent"
      >
        <UiLoader class="text-euler-dark-900 my-8" />
      </div>
      <div
        v-else-if="depositPositions.length === 0"
        class="justify-center align-center"
        :class="$style.tabContent"
      >
        <div class="column gap-8 align-center text-euler-dark-900 py-32">
          <div
            :class="$style.searchIcon"
            class="justify-center align-center br-12 bg-euler-dark-500"
          >
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
        :class="$style.tabContent"
      >
        <PortfolioList
          :items="depositPositions"
          type="lend"
        />
        <div
          v-if="!isReady"
          class="justify-center align-center mt-12"
        >
          <UiLoader class="text-euler-dark-900" />
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="scss" module>
.SavingsPage {
}

.savingsSection {
  display: flex;
  flex-grow: 1;
  border: 1px solid var(--c-euler-dark-600);
}

.tabContent {
  flex-grow: 1;
}

.searchIcon {
  width: 48px;
  height: 48px;
}
</style>
