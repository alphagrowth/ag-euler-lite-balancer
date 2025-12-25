<script setup lang="ts">
import { useAccount } from '@wagmi/vue'

const { isConnected } = useAccount()
const { rewards, isRewardsLoading } = useMerkl()
const { userRewards: brevisRewards, isRewardsLoading: isBrevisRewardsLoading } = useBrevis()
const { locks, isLocksLoading } = useREULLocks()
</script>

<template>
  <div class="flex flex-col flex-1 mx-16 rounded-16">
    <div>
      <div class="flex justify-between items-center mb-8">
        <h3 class="text-h3 font-normal">
          Rewards via Merkl
        </h3>
      </div>
      <p class="text-p2 text-euler-dark-900 mb-16">
        Rewards distributed via Merkl, with updates every 8-12 hours
      </p>
      <div class="flex flex-1 rounded-16 p-8 mb-16 border border-euler-dark-600">
        <div
          v-if="isRewardsLoading"
          class="flex flex-1 min-h-[100px] justify-center items-center"
        >
          <UiLoader class="text-euler-dark-900" />
        </div>
        <div
          v-else-if="rewards.length === 0"
          class="flex flex-1 min-h-[100px] justify-center items-center py-32"
        >
          <div class="flex flex-col gap-8 items-center text-euler-dark-900 text-p2">
            <div class="flex w-48 h-48 justify-center items-center rounded-12 bg-euler-dark-500">
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
          class="flex-1 min-h-[100px]"
        >
          <PortfolioList
            :items="rewards"
            type="rewards"
          />
        </div>
      </div>

      <div class="flex justify-between items-center mb-8">
        <h3 class="text-h3 font-normal">
          Rewards via Incentra
        </h3>
      </div>
      <p class="text-p2 text-euler-dark-900 mb-16">
        Rewards distributed via Incentra incentive campaigns
      </p>
      <div class="flex flex-1 rounded-16 p-8 mb-16 border border-euler-dark-600">
        <div
          v-if="isBrevisRewardsLoading"
          class="flex flex-1 min-h-[100px] justify-center items-center"
        >
          <UiLoader class="text-euler-dark-900" />
        </div>
        <div
          v-else-if="brevisRewards.length === 0"
          class="flex flex-1 min-h-[100px] justify-center items-center py-32"
        >
          <div class="flex flex-col gap-8 items-center text-euler-dark-900 text-p2">
            <div class="flex w-48 h-48 justify-center items-center rounded-12 bg-euler-dark-500">
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
          class="flex-1 min-h-[100px]"
        >
          <PortfolioList
            :items="brevisRewards"
            type="brevis-rewards"
          />
        </div>
      </div>

      <h3 class="text-h3 font-normal mb-8">
        Rewards in EUL (rEUL)
      </h3>
      <p class="text-p2 text-euler-dark-900 mb-16">
        All claimed rEUL vest over a 6-month period which starts upon claiming, allowing a 1:1 exchange for EUL at the end. <br>
        Early unlocking reduces your amount.
      </p>
      <div class="p-8 rounded-16 border border-euler-dark-600">
        <div
          v-if="isLocksLoading"
          class="flex flex-1 min-h-[100px] justify-center items-center"
        >
          <UiLoader class="text-euler-dark-900" />
        </div>
        <div
          v-else-if="locks.length === 0"
          class="flex flex-col flex-1 min-h-[100px] justify-center items-center py-32 text-euler-dark-900 gap-8 text-p2"
        >
          <div class="flex w-48 h-48 justify-center items-center rounded-12 bg-euler-dark-500">
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
          class="text-white rounded-16"
        >
          <RewardUnlockList :items="locks" />
        </div>
      </div>
    </div>
  </div>
</template>
