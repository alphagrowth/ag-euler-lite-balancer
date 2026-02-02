<script setup lang="ts">
import { ethers } from 'ethers'
import { type EarnVault, type Vault, getVaultPrice } from '~/entities/vault'
import { useVaultRegistry } from '~/composables/useVaultRegistry'

const emits = defineEmits<{
  'vault-click': [address: string]
}>()

const onExposureClick = (address: string) => {
  emits('vault-click', address)
}
const { vault } = defineProps<{ vault: EarnVault }>()

const { getOrFetch } = useVaultRegistry()
const { isEscrowLoadedOnce } = useVaults()

const exposureVaults: Ref<Vault[]> = ref([])
const isLoading = ref(false)

const exposureList = computed(() => {
  return [...vault.strategies].sort((a, b) => {
    return nanoToValue(b.allocatedAssets) - nanoToValue(a.allocatedAssets)
  })
})

const totalAllocatedAssets = computed(() => {
  return exposureList.value.reduce((prev, curr) => {
    return prev + curr.allocatedAssets
  }, 0n)
})

const load = async () => {
  try {
    isLoading.value = true
    // Wait for escrow vaults to load first, so they're properly identified in registry
    await until(isEscrowLoadedOnce).toBe(true)
    const promises = exposureList.value.map((exposure) => {
      return getOrFetch(exposure.info.vault) as Promise<Vault>
    })
    exposureVaults.value = (await Promise.all(promises)).filter(Boolean)
  }
  catch (e) {
    console.warn(e)
  }
  finally {
    isLoading.value = false
  }
}

const getExposureVaultByAddress = (address: string) => {
  const normalized = ethers.getAddress(address)
  return exposureVaults.value.find(vlt => normalized === ethers.getAddress(vlt.address))
}

const getExposureUsdPrice = (exposure: typeof exposureList.value[0]) => {
  const exposureVault = getExposureVaultByAddress(exposure.info.vault)
  if (!exposureVault) return 0
  return getVaultPrice(exposure.allocatedAssets, exposureVault)
}

const getExposureAssetAmount = (exposure: typeof exposureList.value[0]) => {
  return `${roundAndCompactTokens(exposure.allocatedAssets, exposure.info.assetDecimals)} ${exposure.info.assetSymbol}`
}

load()
</script>

<template>
  <div
    v-if="exposureList.length"
    class="bg-surface-secondary rounded-xl flex flex-col gap-24 py-24 px-32 shadow-card"
  >
    <div>
      <p class="text-h3 text-content-primary mb-12">
        Exposure
      </p>
    </div>

    <div
      v-if="isLoading"
      class="flex items-center justify-center py-32"
    >
      <UiLoader class="icon--48" />
    </div>

    <div
      v-else
      class="flex flex-col gap-12"
    >
      <div
        v-for="exposure in exposureList"
        :key="exposure.strategy"
        class="bg-surface rounded-xl text-content-primary block no-underline cursor-pointer shadow-card hover:shadow-card-hover transition-shadow border border-line-default"
        @click="onExposureClick(exposure.info.vault)"
      >
        <div
          class="px-16 pt-16 pb-12 border-b border-line-subtle"
        >
          <VaultLabelsAndAssets
            :vault="getExposureVaultByAddress(exposure.info.vault) as Vault"
            :assets="[{
              address: exposure.info.vault,
              decimals: exposure.info.assetDecimals,
              name: exposure.info.assetName,
              symbol: exposure.info.assetSymbol,
            }]"
          />
        </div>
        <div class="flex flex-col gap-12 px-16 pt-12 pb-16">
          <VaultOverviewLabelValue
            label="Allocation (%)"
            orientation="horizontal"
            :value="`${formatNumber(Number(exposure.allocatedAssets) / Number(totalAllocatedAssets) * 100, 2)}%`"
          />
          <VaultOverviewLabelValue
            label="Allocation ($)"
            orientation="horizontal"
          >
            <div class="flex items-center gap-4">
              <template v-if="getExposureUsdPrice(exposure) > 0">
                {{ `$${compactNumber(getExposureUsdPrice(exposure), 2)}` }}
                <span @click.stop.prevent>
                  <UiFootnote
                    title="Amount in assets"
                    :text="getExposureAssetAmount(exposure)"
                    class="[--ui-footnote-icon-color:var(--c-content-tertiary)]"
                  />
                </span>
              </template>
              <template v-else>
                {{ getExposureAssetAmount(exposure) }}
              </template>
            </div>
          </VaultOverviewLabelValue>
        </div>
      </div>
    </div>
  </div>
</template>
