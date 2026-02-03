<script setup lang="ts">
import { ethers } from 'ethers'
import type { AnyBorrowVaultPair, EarnVault, SecuritizeVault, Vault } from '~/entities/vault'
import { getAssetLogoUrl } from '~/composables/useTokens'
import type { AccountBorrowPosition } from '~/entities/account'

const emits = defineEmits(['close'])
const router = useRouter()

// Check if collateral is a securitize vault
const isCollateralSecuritize = computed(() => {
  if (!pair) return false
  return 'type' in pair.collateral && pair.collateral.type === 'securitize'
})

const { pair, vault, earnVault, extraVault, securitizeVault } = defineProps<{ pair?: AnyBorrowVaultPair | AccountBorrowPosition, vault?: Vault, earnVault?: EarnVault, extraVault?: Vault, securitizeVault?: SecuritizeVault }>()

const tab = ref()
const normalizeAddress = (address?: string) => {
  if (!address) {
    return ''
  }
  try {
    return ethers.getAddress(address)
  }
  catch {
    return ''
  }
}
const tabs = computed(() => {
  if (!pair) {
    return []
  }
  const list = [
    {
      label: 'Pair details',
      value: undefined,
      avatars: [getAssetLogoUrl(pair.collateral.asset.symbol), getAssetLogoUrl(pair.borrow.asset.symbol)],
    },
  ]
  if (extraVault) {
    const extraAddress = normalizeAddress(extraVault.address)
    const collateralAddress = normalizeAddress(pair.collateral.address)
    const borrowAddress = normalizeAddress(pair.borrow.address)
    if (extraAddress && extraAddress !== collateralAddress && extraAddress !== borrowAddress) {
      list.push({
        label: extraVault.asset.symbol,
        value: 'multiply-collateral',
        avatars: [getAssetLogoUrl(extraVault.asset.symbol)],
      })
    }
  }
  list.push(
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
  )
  return list
})
watch(tabs, (next) => {
  if (!tab.value) {
    return
  }
  const values = next.map(item => item.value)
  if (!values.includes(tab.value)) {
    tab.value = undefined
  }
}, { immediate: true })

const onVaultClick = (address: string) => {
  emits('close')
  router.push(`/lend/${address}`)
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
          <SecuritizeVaultOverview
            v-else-if="tab === 'collateral' && isCollateralSecuritize"
            :vault="(pair.collateral as SecuritizeVault)"
          />
          <VaultOverview
            v-else-if="tab === 'collateral'"
            :vault="(pair.collateral as Vault)"
            @vault-click="onVaultClick"
          />
          <VaultOverview
            v-else-if="tab === 'multiply-collateral' && extraVault"
            :vault="extraVault"
            @vault-click="onVaultClick"
          />
          <VaultOverview
            v-else-if="tab === 'borrow'"
            :vault="pair.borrow"
            @vault-click="onVaultClick"
          />
        </Transition>
      </template>

      <template v-else-if="vault">
        <VaultOverview
          :vault="vault"
          @vault-click="onVaultClick"
        />
      </template>

      <template v-else-if="securitizeVault">
        <SecuritizeVaultOverview
          :vault="securitizeVault"
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
