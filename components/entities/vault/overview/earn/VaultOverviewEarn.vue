<script setup lang="ts">
import type { EarnVault } from '~/entities/vault'

const emits = defineEmits(['vault-click'])
const { vault } = defineProps<{ vault: EarnVault, desktopOverview?: boolean }>()
</script>

<template>
  <div
    class="flex flex-col"
    :class="[!desktopOverview ? 'gap-12' : '']"
  >
    <VaultOverviewEarnBlockGeneral
      :vault="vault"
      :class="[desktopOverview ? 'py-16 [&:first-child]:!pt-0 px-0' : '']"
    />

    <VaultOverviewEarnBlockStats
      :vault="vault"
      :class="[desktopOverview ? 'py-16 [&:first-child]:!pt-0 px-0' : '']"
    />

    <VaultOverviewEarnBlockExposure
      :vault="vault"
      :class="[desktopOverview ? 'py-16 [&:first-child]:!pt-0 px-0' : '']"
      @vault-click="emits('vault-click')"
    />

    <VaultOverviewEarnBlockManagement
      :vault="vault"
      :class="[desktopOverview ? 'py-16 [&:first-child]:!pt-0 px-0' : '']"
    />

    <VaultOverviewEarnBlockAddresses
      :vault="vault"
      :class="[desktopOverview ? 'py-16 [&:first-child]:!pt-0 px-0' : '']"
    />
  </div>
</template>
