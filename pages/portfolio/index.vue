<script setup lang="ts">
const { isConnected } = useTonConnect()
const { borrowPositions, isPositionsLoading } = useEulerAccount()
</script>

<template>
  <div
    :class="$style.BorrowPage"
    class="mx-16 flex p-8 br-16"
  >
    <div
      v-if="isPositionsLoading"
      class="justify-center align-center"
      :class="$style.tabContent"
    >
      <UiLoader class="text-euler-dark-900" />
    </div>
    <div
      v-else-if="borrowPositions.length === 0"
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
          You don't have positions yet
        </template>
        <template v-else>
          Connect your wallet to see your positions
        </template>
      </div>
    </div>
    <div
      v-else
      :class="$style.tabContent"
    >
      <PortfolioList
        :items="borrowPositions"
        type="borrow"
      />
    </div>
  </div>
</template>

<style lang="scss" module>
.BorrowPage {
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
