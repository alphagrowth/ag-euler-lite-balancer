<script setup lang="ts">
import type { AccountBorrowPosition, AccountDepositPosition } from '~/entities/account'
import type { Reward } from '~/entities/merkl'
import type { Campaign } from '~/entities/brevis'

defineProps<{
  type: 'lend' | 'borrow' | 'rewards' | 'brevis-rewards'
  items: AccountDepositPosition[] | AccountBorrowPosition[] | Reward[] | Campaign[]
}>()
</script>

<template>
  <div
    :class="$style.VaultsList"
    class="column gap-8"
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

<style lang="scss" module>
.VaultsList {
  ///
}
</style>
