<script setup lang="ts">
import type { Vault } from '~/entities/vault'

const emits = defineEmits(['vault-click'])
const { vault } = defineProps<{ vault: Vault, desktopOverview?: boolean }>()
</script>

<template>
  <div
    class="column"
    :class="[!desktopOverview ? 'gap-12' : '']"
  >
    <VaultOverviewBlockGeneral
      :vault="vault"
      :class="[desktopOverview ? $style.desktop : '']"
    />

    <VaultOverviewBlockStats
      :vault="vault"
      :class="[desktopOverview ? $style.desktop : '']"
    />

    <VaultOverviewBlockRiskParameters
      :vault="vault"
      :class="[desktopOverview ? $style.desktop : '']"
    />

    <VaultOverviewBlockBorrow
      :vault="vault"
      :class="[desktopOverview ? $style.desktop : '']"
      @vault-click="emits('vault-click')"
    />

    <VaultOverviewBlockIRM
      :vault="vault"
      :class="[desktopOverview ? $style.desktop : '']"
    />

    <VaultOverviewBlockAddresses
      :vault="vault"
      :class="[desktopOverview ? $style.desktop : '']"
    />
  </div>
</template>

<style lang="scss" module>
.desktop {
  padding: 16px 0 !important;

  &:first-child {
    padding-top: 0 !important;
  }
}
</style>
