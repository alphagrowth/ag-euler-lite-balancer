<script setup lang="ts">
import type { BorrowVaultPair } from '~/entities/vault'
import type { AccountBorrowPosition } from '~/entities/account'

defineProps<{ pair: BorrowVaultPair | AccountBorrowPosition, desktopOverview?: boolean }>()
</script>

<template>
  <div
    class="column"
    :class="[!desktopOverview ? 'gap-12' : '']"
  >
    <VaultOverviewPairBlockGeneral
      :pair="pair"
      :class="[desktopOverview ? $style.desktop : '']"
    />
    <VaultOverviewBlockOracleAdapters
      :vaults="[pair.collateral, pair.borrow]"
      :class="[desktopOverview ? $style.desktop : '']"
    />
  </div>
</template>

<style lang="scss" module>
.desktop {
  padding: 16px 0 !important;

  &:first-child {
    padding-top: 0 !important;
  }
}
</style>
