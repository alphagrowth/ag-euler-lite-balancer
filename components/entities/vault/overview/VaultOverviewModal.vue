<script setup lang="ts">
import type { BorrowVaultPair, EarnVault, Vault } from '~/entities/vault'
import { getAssetLogoUrl } from '~/composables/useTokens'
import type { AccountBorrowPosition } from '~/entities/account'

const emits = defineEmits(['close'])

const { pair, vault, earnVault } = defineProps<{ pair?: BorrowVaultPair | AccountBorrowPosition, vault?: Vault, earnVault?: EarnVault }>()

const tab = ref()
const tabs = computed(() => {
  if (!pair) {
    return []
  }
  return [
    {
      label: 'Pair details',
      value: undefined,
      avatars: [getAssetLogoUrl(pair.collateral.asset.symbol), getAssetLogoUrl(pair.borrow.asset.symbol)],
    },
    {
      label: pair.collateral.asset.symbol,
      value: 'collateral',
      avatars: [getAssetLogoUrl(pair.collateral.asset.symbol)],
    },
    {
      label: pair.borrow.asset.symbol,
      value: 'borrow',
      avatars: [getAssetLogoUrl(pair.borrow.asset.symbol)],
    },
  ]
})

const onVaultClick = () => {
  emits('close')
}
</script>

<template>
  <BaseModalWrapper
    :class="$style.VaultOverviewModal"
    full
    title="Market information"
    @close="$emit('close')"
  >
    <UiTabs
      v-if="tabs.length"
      v-model="tab"
      :class="$style.tabs"
      class="mb-12"
      :list="tabs"
    >
      <template #default="{ tab: slotTab }">
        <div class="align-center gap-8">
          <BaseAvatar :src="slotTab.avatars as string[]" />

          {{ slotTab.label }}
        </div>
      </template>
    </UiTabs>

    <div
      :class="$style.content"
      class="column"
    >
      <template v-if="pair">
        <Transition
          name="page"
          mode="out-in"
        >
          <VaultOverviewPair
            v-if="!tab"
            :pair="pair"
            style="flex-grow: 1"
          />
          <VaultOverview
            v-else-if="tab === 'collateral'"
            :vault="pair.collateral"
          />
          <VaultOverview
            v-else-if="tab === 'borrow'"
            :vault="pair.borrow"
          />
        </Transition>
      </template>

      <template v-else-if="vault">
        <VaultOverview
          :vault="vault"
          @vault-click="onVaultClick"
        />
      </template>

      <template v-else-if="earnVault">
        <VaultOverviewEarn
          :vault="earnVault"
          @vault-click="onVaultClick"
        />
      </template>
    </div>
  </BaseModalWrapper>
</template>

<style module lang="scss">
.VaultOverviewModal {
  width: 100%;
  max-width: 500px;
}

.tabs {
  margin: 0 -16px;
}

.content {
  flex-grow: 1;
  margin: 0 -8px;
}
</style>
