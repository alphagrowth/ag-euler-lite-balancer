<script setup lang="ts">
import type { AnyBorrowVaultPair } from '~/entities/vault'
import type { AccountBorrowPosition } from '~/entities/account'

defineProps<{ pair: AnyBorrowVaultPair | AccountBorrowPosition, desktopOverview?: boolean }>()
</script>

<template>
  <div
    class="flex flex-col"
    :class="[!desktopOverview ? 'gap-12' : '']"
  >
    <VaultOverviewPairBlockGeneral
      :pair="pair"
      :class="[desktopOverview ? 'py-16 [&:first-child]:!pt-0 px-0' : '']"
    />
    <!-- Oracle adapters should always come from the liability (borrow) vault -->
    <VaultOverviewBlockOracleAdapters
      :vault="pair.borrow"
      :collateral-vaults="[pair.collateral]"
      :class="[desktopOverview ? 'py-16 [&:first-child]:!pt-0 px-0' : '']"
    />
  </div>
</template>
