<script setup lang="ts">
import { type EarnVault, type Vault, getVaultPrice } from '~/entities/vault'

const emits = defineEmits(['vault-click'])
const { vault } = defineProps<{ vault: EarnVault }>()

const { getVault, getEscrowVault, escrowList } = useVaults()

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
      return escrowList.value.find(escrow => escrow.address === exposure.info.vault) ? getEscrowVault(exposure.info.vault) : getVault(exposure.info.vault)
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
      v-if="!isLoading"
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
              :value="`$${compactNumber(getVaultPrice(exposure.allocatedAssets, exposureVaults.find((vlt) => exposure.info.vault === vlt.address) as Vault), 2)}`"
            />
          </div>
        </NuxtLink>
      </div>
    </div>
  </div>
</template>
