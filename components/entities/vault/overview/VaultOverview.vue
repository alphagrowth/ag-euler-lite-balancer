<script setup lang="ts">
import type { Vault } from '~/entities/vault'

const emits = defineEmits(['vault-click'])
const { vault } = defineProps<{ vault: Vault }>()
</script>

<template>
  <div class="column gap-12">
    <VaultOverviewBlockGeneral :vault="vault" />

    <VaultOverviewBlockStats :vault="vault" />

    <VaultOverviewBlockRiskParameters :vault="vault" />

    <VaultOverviewBlockBorrow
      :vault="vault"
      @vault-click="emits('vault-click')"
    />

    <VaultOverviewBlockIRM :vault="vault" />

    <VaultOverviewBlockAddresses :vault="vault" />
  </div>
</template>
