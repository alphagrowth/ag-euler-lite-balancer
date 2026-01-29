<script setup lang="ts">
import type { AccountBorrowPosition, AccountDepositPosition, AccountEarnPosition } from '~/entities/account'
import type { Reward } from '~/entities/merkl'
import type { Campaign } from '~/entities/brevis'

defineProps<{
  type: 'lend' | 'borrow' | 'earn' | 'rewards' | 'brevis-rewards'
  items: AccountDepositPosition[] | AccountBorrowPosition[] | AccountEarnPosition[] | Reward[] | Campaign[]
}>()
</script>

<template>
  <div
    class="flex flex-col gap-8"
  >
    <template v-if="type === 'lend'">
      <PortfolioSavingItem
        v-for="(position) in items"
        :key="(position as AccountDepositPosition).vault.address"
        :position="position as AccountDepositPosition"
      />
    </template>
    <template v-else-if="type === 'borrow'">
      <div
        v-for="(position, idx) in items"
        :key="`${(position as AccountBorrowPosition).collateral.address}-${(position as AccountBorrowPosition).borrow.address}`"
      >
        <PortfolioBorrowCollateralItem
          v-if="(position as AccountBorrowPosition).borrow.borrow === 0n"
          :position="position as AccountBorrowPosition"
          :index="idx"
        />
        <PortfolioBorrowItem
          v-else
          :position="position as AccountBorrowPosition"
          :index="idx"
        />
      </div>
    </template>
    <template v-else-if="type === 'earn'">
      <PortfolioEarnItem
        v-for="(position) in items"
        :key="(position as AccountEarnPosition).vault.address"
        :position="position as AccountEarnPosition"
      />
    </template>
    <template v-else-if="type === 'rewards'">
      <PortfolioRewardItem
        v-for="(reward, idx) in items"
        :key="`position-${idx}`"
        :reward="reward as Reward"
      />
    </template>
    <template v-else-if="type === 'brevis-rewards'">
      <PortfolioBrevisRewardItem
        v-for="(campaign, idx) in items"
        :key="`brevis-${idx}`"
        :campaign="campaign as Campaign"
      />
    </template>
  </div>
</template>
