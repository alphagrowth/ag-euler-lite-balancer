<script setup lang="ts">
import type { EarnVault } from '~/entities/vault'

const emits = defineEmits<{
  'vault-click': [address: string]
}>()
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
      @vault-click="(address: string) => emits('vault-click', address)"
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
