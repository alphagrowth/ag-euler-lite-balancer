<script setup lang="ts">
import type { EarnVault } from '~/entities/vault'

const emits = defineEmits(['vault-click'])
const { vault } = defineProps<{ vault: EarnVault }>()
</script>

<template>
  <div class="column gap-12">
    <VaultOverviewEarnBlockGeneral :vault="vault" />

    <VaultOverviewEarnBlockStats :vault="vault" />

    <VaultOverviewEarnBlockExposure
      :vault="vault"
      @vault-click="emits('vault-click')"
    />

    <VaultOverviewEarnBlockManagement :vault="vault" />

    <VaultOverviewEarnBlockAddresses :vault="vault" />
  </div>
</template>
