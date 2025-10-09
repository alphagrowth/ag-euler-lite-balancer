<script setup lang="ts">
const { isConnected } = useTonConnect()
const { depositPositions } = useEulerAccount()
const { isLoading: isBalancesLoading } = useWallets()
</script>

<template>
  <div
    :class="$style.SavingsPage"
    class="mx-16 flex p-8 br-16"
  >
    <div
      v-if="isBalancesLoading"
      class="justify-center align-center"
      :class="$style.tabContent"
    >
      <UiLoader class="text-euler-dark-900" />
    </div>
    <div
      v-else-if="depositPositions.length === 0"
      class="justify-center align-center"
      :class="$style.tabContent"
    >
      <div class="column gap-8 align-center text-euler-dark-900">
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
    </div>
  </div>
</template>

<style lang="scss" module>
.SavingsPage {
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
