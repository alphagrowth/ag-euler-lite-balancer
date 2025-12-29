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
    class="w-full max-w-[500px]"
    full
    title="Market information"
    @close="$emit('close')"
  >
    <UiTabs
      v-if="tabs.length"
      v-model="tab"
      class="mb-12 mx-[-16px]"
      :list="tabs"
    >
      <template #default="{ tab: slotTab }">
        <div class="flex items-center gap-8">
          <BaseAvatar :src="slotTab.avatars as string[]" />
          {{ slotTab.label }}
        </div>
      </template>
    </UiTabs>

    <div
      class="flex flex-col flex-grow mx-[-8px]"
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
