<script setup lang="ts">
import { getAddress } from 'viem'
import type { EarnVault } from '~/entities/vault'
import { formatAssetValue } from '~/services/pricing/priceProvider'
import { useEulerEntitiesOfEarnVault, useEulerProductOfVault } from '~/composables/useEulerLabels'
import { getEulerLabelEntityLogo } from '~/entities/euler/labels'
import { isVaultBlockedByCountry } from '~/composables/useGeoBlock'
import { isEarnVaultDeprecated, getEarnVaultDeprecationReason, getEarnVaultDescription } from '~/utils/eulerLabelsUtils'
import { autoLink } from '~/utils/autoLink'
import { getVaultTypeDescription, getVaultTypeLabel } from '~/entities/vault/descriptions'

const { vault } = defineProps<{ vault: EarnVault }>()
const { enableEntityBranding: enableEntityBrandingDisplay, enableVaultType: enableVaultTypeDisplay } = useDeployConfig()

const { isEarnVaultOwnerVerified } = useVaults()
const vaultAddress = computed(() => getAddress(vault.address))
const product = useEulerProductOfVault(vaultAddress)
const entities = useEulerEntitiesOfEarnVault(vault)
const isOwnerVerified = computed(() => isEarnVaultOwnerVerified(vault))
const earnDescription = computed(() => getEarnVaultDescription(vault.address))

const isDeprecated = computed(() => {
  return isEarnVaultDeprecated(vault.address)
    || (product.deprecatedVaults?.includes(vaultAddress.value) ?? false)
})
const deprecationReason = computed(() => {
  if (!isDeprecated.value) return ''
  return getEarnVaultDeprecationReason(vault.address) || product.deprecationReason || ''
})
const isRestricted = computed(() => isVaultBlockedByCountry(vault.address))

const priceDisplay = ref('-')

watchEffect(async () => {
  const price = await formatAssetValue(1, vault, 'off-chain')
  priceDisplay.value = price.hasPrice ? formatUsdValue(price.usdValue) : '-'
})

const feeDisplay = computed(() => {
  return `${compactNumber(nanoToValue(vault.performanceFee, 18) * 100, 2, 2)}%`
})

const earnVaultType = computed(() => entities.length ? 'managed' : 'unknown')
const vaultTypeLabel = computed(() =>
  getVaultTypeLabel(earnVaultType.value, isOwnerVerified.value),
)
const vaultTypeDescription = computed(() =>
  getVaultTypeDescription(earnVaultType.value, isOwnerVerified.value),
)
</script>

<template>
  <div class="bg-surface-secondary rounded-xl flex flex-col gap-24 p-24 shadow-card">
    <p class="text-h3 text-content-primary">
      Overview
    </p>
    <div class="flex flex-col items-start gap-24">
      <div
        v-if="isDeprecated && deprecationReason"
        class="w-full rounded-12 p-16 bg-warning-100 text-warning-500"
      >
        <div class="flex items-start gap-8">
          <SvgIcon
            name="warning"
            class="!w-20 !h-20 flex-shrink-0 mt-2"
          />
          <!-- eslint-disable vue/no-v-html -- trusted label content -->
          <p
            class="text-p3 text-warning-500 auto-link"
            v-html="autoLink(deprecationReason)"
          />
          <!-- eslint-enable vue/no-v-html -->
        </div>
      </div>
      <div
        v-if="isRestricted"
        class="w-full rounded-12 p-16 bg-warning-100 text-warning-500"
      >
        <div class="flex items-start gap-8">
          <SvgIcon
            name="warning"
            class="!w-20 !h-20 flex-shrink-0 mt-2"
          />
          <p class="text-p3 text-warning-500">
            This vault is not available in your region.
          </p>
        </div>
      </div>
      <div
        v-if="earnDescription"
        class="w-full rounded-12 p-16 bg-surface-tertiary"
      >
        <!-- eslint-disable vue/no-v-html -- trusted label content -->
        <p
          class="text-p3 text-content-secondary auto-link"
          v-html="autoLink(earnDescription)"
        />
        <!-- eslint-enable vue/no-v-html -->
      </div>
      <div
        v-if="product.description"
        class="w-full rounded-12 p-16 bg-surface-tertiary"
      >
        <!-- eslint-disable vue/no-v-html -- trusted label content -->
        <p
          class="text-p3 text-content-secondary auto-link"
          v-html="autoLink(product.description)"
        />
        <!-- eslint-enable vue/no-v-html -->
      </div>
      <VaultOverviewLabelValue
        label="Price"
        :value="priceDisplay"
      />
      <VaultOverviewLabelValue
        label="Performance fee"
        :value="feeDisplay"
      />
      <VaultOverviewLabelValue
        v-if="enableEntityBrandingDisplay"
        label="Capital allocator"
      >
        <div
          v-if="entities.length && isOwnerVerified"
          class="flex flex-col gap-16"
        >
          <div
            v-for="(entity, idx) in entities"
            :key="idx"
            class="flex items-center gap-8"
          >
            <BaseAvatar
              :label="entity.name"
              :src="getEulerLabelEntityLogo(entity.logo)"
            />
            <a
              :href="entity.url"
              target="_blank"
              class="text-p2 text-neutral-800 hover:text-accent-600 underline transition-colors"
            >{{ entity.name }}</a>
          </div>
        </div>
        <div
          v-else
          class="flex gap-8 items-center py-8 px-12 rounded-8 bg-[var(--c-red-opaque-200)] text-red-700"
        >
          <UiIcon
            class="mr-2 !w-20 !h-20"
            name="warning"
          />
          Unknown
        </div>
      </VaultOverviewLabelValue>
      <VaultOverviewLabelValue
        v-if="enableVaultTypeDisplay"
      >
        <template #label>
          <span class="flex items-center gap-4">
            Vault type
            <UiFootnote
              :title="vaultTypeLabel"
              :text="vaultTypeDescription"
              class="[--ui-footnote-icon-color:var(--text-muted)] hover:[--ui-footnote-icon-color:var(--text-secondary)]"
            />
          </span>
        </template>
        <VaultTypeChip
          :vault="vault"
          :type="earnVaultType"
        />
      </VaultOverviewLabelValue>
    </div>
  </div>
</template>
