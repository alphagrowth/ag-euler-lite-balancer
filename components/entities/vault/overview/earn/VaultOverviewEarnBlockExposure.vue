<script setup lang="ts">
import { type EarnVault, type Vault, getVaultPrice } from '~/entities/vault'
import { useVaultRegistry } from '~/composables/useVaultRegistry'

const emits = defineEmits(['vault-click'])
const { vault } = defineProps<{ vault: EarnVault }>()

const { getVault, getEscrowVault } = useVaults()
const { getType: registryGetType } = useVaultRegistry()

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
    const promises = exposureList.value.map((exposure) => {
      return registryGetType(exposure.info.vault) === 'escrow' ? getEscrowVault(exposure.info.vault) : getVault(exposure.info.vault)
    })
    exposureVaults.value = await Promise.all(promises)
  }
  catch (e) {
    console.warn(e)
  }
  finally {
    isLoading.value = false
  }
}

const getExposureVaultByAddress = (address: string) => {
  return exposureVaults.value.find(vlt => address === vlt.address)
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
    class="bg-euler-dark-300 rounded-16 flex flex-col gap-24 p-24"
  >
    <div>
      <p class="text-h3 text-white mb-12">
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
        @click="emits('vault-click')"
      >
        <NuxtLink
          class="bg-euler-dark-500 rounded-16 text-white block no-underline"
          :to="`/lend/${exposure.info.vault}`"
        >
          <div
            class="px-16 pt-16 pb-12"
            style="border-bottom: 1px solid var(--c-euler-dark-600)"
          >
            <VaultLabelsAndAssets
              :vault="exposureVaults.find((vlt) => exposure.info.vault === vlt.address) as Vault"
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
                      class="[--ui-footnote-icon-color:var(--c-euler-dark-900)]"
                    />
                  </span>
                </template>
                <template v-else>
                  {{ getExposureAssetAmount(exposure) }}
                </template>
              </div>
            </VaultOverviewLabelValue>
          </div>
        </NuxtLink>
      </div>
    </div>
  </div>
</template>
