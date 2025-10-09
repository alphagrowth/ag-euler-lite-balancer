<script setup lang="ts">
import type { AccountBorrowPosition, AccountDepositPosition } from '~/entities/account'
import type { Reward } from '~/entities/merkl'

defineProps<{
  type: 'lend' | 'borrow' | 'rewards'
  items: AccountDepositPosition[] | AccountBorrowPosition[] | Reward[]
}>()
</script>

<template>
  <div
    :class="$style.VaultsList"
    class="column gap-8"
  >
    <template v-if="type === 'lend'">
      <PortfolioSavingItem
        v-for="(position, idx) in items"
        :key="`position-${idx}`"
        :position="position as AccountDepositPosition"
      />
    </template>
    <template v-else-if="type === 'borrow'">
      <div
        v-for="(position, idx) in items"
        :key="`position-${idx}`"
      >
      <PortfolioBorrowCollateralItem
        v-if="position.borrow.borrow === 0n"
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
  </div>
</template>

<style lang="scss" module>
.VaultsList {
  ///
}
</style>
