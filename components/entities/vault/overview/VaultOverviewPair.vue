<script setup lang="ts">
import type { BorrowVaultPair } from '~/entities/vault'
import type { AccountBorrowPosition } from '~/entities/account'

defineProps<{ pair: BorrowVaultPair | AccountBorrowPosition }>()
</script>

<template>
  <VaultOverviewPairBlockGeneral :pair="pair" />
</template>
