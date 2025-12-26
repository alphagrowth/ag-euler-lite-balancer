<script setup lang="ts">
import type { BorrowVaultPair } from '~/entities/vault'
import type { AccountBorrowPosition } from '~/entities/account'

defineProps<{ pair: BorrowVaultPair | AccountBorrowPosition, desktopOverview?: boolean }>()
</script>

<template>
  <VaultOverviewPairBlockGeneral
    :pair="pair"
    :class="[desktopOverview ? 'py-16 !px-0 !pt-0' : '']"
  />
</template>
