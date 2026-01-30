<script setup lang="ts">
import type { BorrowVaultPair } from '~/entities/vault'
import type { AccountBorrowPosition } from '~/entities/account'

defineProps<{ pair: BorrowVaultPair | AccountBorrowPosition, desktopOverview?: boolean }>()
</script>

<template>
  <div
    class="flex flex-col"
    :class="[desktopOverview ? 'gap-16' : 'gap-12']"
  >
    <VaultOverviewPairBlockGeneral
      :pair="pair"
    />
    <VaultOverviewBlockOracleAdapters
      :vault="pair.borrow"
      :collateral-assets="[pair.collateral.address]"
    />
  </div>
</template>
