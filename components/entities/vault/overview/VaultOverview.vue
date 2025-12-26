<script setup lang="ts">
import type { Vault } from '~/entities/vault'

const emits = defineEmits(['vault-click'])
const { vault } = defineProps<{ vault: Vault, desktopOverview?: boolean }>()
</script>

<template>
  <div
    class="flex flex-col"
    :class="[!desktopOverview ? 'gap-12' : '']"
  >
    <VaultOverviewBlockGeneral
      :vault="vault"
      :class="[desktopOverview ? 'py-16 [&:first-child]:!pt-0 px-0' : '']"
    />

    <VaultOverviewBlockStats
      :vault="vault"
      :class="[desktopOverview ? 'py-16 [&:first-child]:!pt-0 px-0' : '']"
    />

    <VaultOverviewBlockRiskParameters
      :vault="vault"
      :class="[desktopOverview ? 'py-16 [&:first-child]:!pt-0 px-0' : '']"
    />

    <VaultOverviewBlockBorrow
      :vault="vault"
      :class="[desktopOverview ? 'py-16 [&:first-child]:!pt-0 px-0' : '']"
      @vault-click="emits('vault-click')"
    />

    <VaultOverviewBlockIRM
      :vault="vault"
      :class="[desktopOverview ? 'py-16 [&:first-child]:!pt-0 px-0' : '']"
    />

    <VaultOverviewBlockAddresses
      :vault="vault"
      :class="[desktopOverview ? 'py-16 [&:first-child]:!pt-0 px-0' : '']"
    />
  </div>
</template>
