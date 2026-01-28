<script setup lang="ts">
import type { BorrowVaultPair } from '~/entities/vault'
import type { AccountBorrowPosition } from '~/entities/account'

defineProps<{ pair: BorrowVaultPair | AccountBorrowPosition, desktopOverview?: boolean }>()
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
    <VaultOverviewBlockOracleAdapters
      :vault="pair.borrow"
      :class="[desktopOverview ? 'py-16 [&:first-child]:!pt-0 px-0' : '']"
    />
  </div>
</template>
