<script setup lang="ts">
import type { BorrowVaultPair } from '~/entities/vault'
import type { AccountBorrowPosition } from '~/entities/account'

defineProps<{ pair: BorrowVaultPair | AccountBorrowPosition, desktopOverview?: boolean }>()
</script>

<template>
  <VaultOverviewPairBlockGeneral
    :pair="pair"
    :class="[desktopOverview ? $style.desktop : '']"
  />
</template>

<style lang="scss" module>
.desktop {
  padding: 16px 0 !important;
  padding-top: 0 !important;
}
</style>
