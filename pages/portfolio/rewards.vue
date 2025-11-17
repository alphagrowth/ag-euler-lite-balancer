<script setup lang="ts">
const { isConnected } = useTonConnect()
const { rewards, isRewardsLoading } = useMerkl()
const { locks, isLocksLoading } = useREULLocks()
</script>

<template>
  <div
    :class="$style.RewardsPage"
    class="mx-16 flex br-16"
  >
    <div>
      <div class="between align-center mb-8">
        <h3 class="h3 weight-400">
          Rewards via Merkl
        </h3>
      </div>
      <p class="p2 text-euler-dark-900 mb-16">
        Rewards distributed via Merkl, with updates every 8-12 hours. <a
          class="link"
          href="https://t.me/unwrap_tac_bot"
          target="_blank"
        >Click here to unwrap WTAC</a>
      </p>
      <div
        :class="$style.content"
        class="flex br-16 p-8 mb-16"
      >
        <div
          v-if="isRewardsLoading"
          class="justify-center align-center"
          :class="$style.tabContent"
        >
          <UiLoader class="text-euler-dark-900" />
        </div>
        <div
          v-else-if="rewards.length === 0"
          class="justify-center align-center py-32"
          :class="$style.tabContent"
        >
          <div class="column gap-8 align-center text-euler-dark-900 p2">
            <div
              :class="$style.searchIcon"
              class="justify-center align-center br-12 bg-euler-dark-500"
            >
              <SvgIcon name="search" />
            </div>
            <template v-if="isConnected">
              You don't have rewards yet
            </template>
            <template v-else>
              Connect your wallet to see your rewards
            </template>
          </div>
        </div>
        <div
          v-else
          :class="$style.tabContent"
        >
          <PortfolioList
            :items="rewards"
            type="rewards"
          />
        </div>
      </div>
      <h3 class="h3 weight-400 mb-8">
        Rewards in EUL (rEUL)
      </h3>
      <p class="p2 text-euler-dark-900 mb-16">
        All claimed rEUL vest over a 6-month period which starts upon claiming, allowing a 1:1 exchange for EUL at the end. <br>
        Early unlocking reduces your amount.
      </p>
      <div
        :class="$style.reulWrap"
        class="p-8 br-16"
      >
        <div
          v-if="isLocksLoading"
          class="justify-center align-center"
          :class="$style.tabContent"
        >
          <UiLoader class="text-euler-dark-900" />
        </div>
        <div
          v-else-if="locks.length === 0"
          class="column justify-center align-center py-32 text-euler-dark-900 gap-8 p2"
          :class="$style.tabContent"
        >
          <div
            :class="$style.searchIcon"
            class="justify-center align-center br-12 bg-euler-dark-500"
          >
            <SvgIcon name="search" />
          </div>
          <template v-if="isConnected">
            You don't have locks yet
          </template>
          <template v-else>
            Connect your wallet to see your locks
          </template>
        </div>
        <div
          v-else
          class="text-white br-16"
        >
          <RewardUnlockList
            :items="locks"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="scss" module>
.RewardsPage {
  display: flex;
  flex-direction: column;
  flex-grow: 1;
}

.reulWrap {
  border: 1px solid var(--c-euler-dark-600);
}

.claimAllBtn {
  width: 86px;
}

.content {
  border: 1px solid var(--c-euler-dark-600);
  flex-grow: 1;
}

.tabContent {
  min-height: 100px;
  flex-grow: 1;
}

.searchIcon,
.comingSoonIcon {
  width: 48px;
  height: 48px;
}
</style>
