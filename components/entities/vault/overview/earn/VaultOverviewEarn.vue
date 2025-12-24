<script setup lang="ts">
import type { EarnVault } from '~/entities/vault'

const emits = defineEmits(['vault-click'])
const { vault } = defineProps<{ vault: EarnVault, desktopOverview?: boolean }>()
</script>

<template>
  <div
    class="column"
    :class="[!desktopOverview ? 'gap-12' : '']"
  >
    <VaultOverviewEarnBlockGeneral
      :vault="vault"
      :class="[desktopOverview ? $style.desktop : '']"
    />

    <VaultOverviewEarnBlockStats
      :vault="vault"
      :class="[desktopOverview ? $style.desktop : '']"
    />

    <VaultOverviewEarnBlockExposure
      :vault="vault"
      :class="[desktopOverview ? $style.desktop : '']"
      @vault-click="emits('vault-click')"
    />

    <VaultOverviewEarnBlockManagement
      :vault="vault"
      :class="[desktopOverview ? $style.desktop : '']"
    />

    <VaultOverviewEarnBlockAddresses
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
