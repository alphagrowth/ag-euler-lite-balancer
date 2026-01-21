<script setup lang="ts">
import { ethers } from 'ethers'
import type { SecuritizeVault, Vault, VaultCollateralLTV } from '~/entities/vault'
import { useEulerEntitiesOfVault } from '~/composables/useEulerLabels'
import { getEulerLabelEntityLogo } from '~/entities/euler/labels'

const { vault } = defineProps<{ vault: SecuritizeVault, desktopOverview?: boolean }>()

const { EVM_PROVIDER_URL } = useEulerConfig()
const product = useEulerProductOfVault(vault.address)
const entities = useEulerEntitiesOfVault(vault.address)

const { list } = useVaults()

// Find EVK vaults where this securitize vault can be used as collateral
const borrowMarkets = computed(() => {
  const markets: Array<{
    borrowVault: Vault
    ltv: VaultCollateralLTV
  }> = []

  list.value.forEach((v) => {
    const ltv = v.collateralLTVs.find(l => l.collateral === vault.address && l.borrowLTV > 0n)
    if (ltv) {
      markets.push({ borrowVault: v, ltv })
    }
  })

  return markets
})

const collateralCount = computed(() => borrowMarkets.value.length)

// Risk parameters - fetch share token exchange rate (ERC4626 standard)
const shareTokenExchangeRate: Ref<bigint | undefined> = ref()

const loadRiskParameters = async () => {
  try {
    const provider = new ethers.JsonRpcProvider(EVM_PROVIDER_URL)
    const contract = new ethers.Contract(
      vault.address,
      [{
        type: 'function',
        name: 'convertToAssets',
        inputs: [{ name: 'shares', type: 'uint256' }],
        outputs: [{ name: 'assets', type: 'uint256' }],
        stateMutability: 'view',
      }],
      provider,
    )
    shareTokenExchangeRate.value = await contract.convertToAssets(1n * 10n ** vault.decimals)
  }
  catch (e) {
    console.warn('[SecuritizeVaultOverview] Failed to load share token exchange rate', e)
  }
}

loadRiskParameters()
</script>

<template>
  <div
    class="flex flex-col"
    :class="[!desktopOverview ? 'gap-12' : '']"
  >
    <!-- General Overview -->
    <div
      class="bg-euler-dark-300 rounded-16 flex flex-col gap-24 p-24"
      :class="[desktopOverview ? 'py-16 [&:first-child]:!pt-0 px-0 bg-transparent' : '']"
    >
      <p class="text-h3 text-white">
        Overview
      </p>
      <div class="flex flex-col items-start gap-24">
        <VaultOverviewLabelValue
          label="Vault"
          :value="vault.name"
        />
        <VaultOverviewLabelValue
          label="Asset"
          :value="vault.asset.symbol"
        />
        <VaultOverviewLabelValue
          v-if="product.name"
          label="Market"
          :value="product.name"
        />
        <VaultOverviewLabelValue label="Risk curator(s)">
          <div
            v-if="entities.length"
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
                class="text-p2 text-white underline"
              >{{ entity.name }}</a>
            </div>
          </div>
          <div v-else>
            -
          </div>
        </VaultOverviewLabelValue>
        <VaultOverviewLabelValue label="Market type">
          <span class="text-p2 text-white">Securitize</span>
        </VaultOverviewLabelValue>
        <VaultOverviewLabelValue label="Can be used as collateral">
          <div class="flex items-center gap-8">
            <div>
              <UiIcon :name="collateralCount ? 'green-tick' : 'red-cross'" />
            </div>
            <span class="text-p2 text-white">
              {{ collateralCount ? `Yes in ${collateralCount} markets` : 'No' }}
            </span>
          </div>
        </VaultOverviewLabelValue>
      </div>
    </div>

    <!-- Statistics -->
    <div
      class="bg-euler-dark-300 rounded-16 flex flex-col gap-24 p-24"
      :class="[desktopOverview ? 'py-16 px-0 bg-transparent' : '']"
    >
      <p class="text-h3 text-white">
        Statistics
      </p>
      <div class="flex flex-col items-start gap-24">
        <VaultOverviewLabelValue label="Total shares">
          {{ compactNumber(nanoToValue(vault.totalShares, vault.decimals)) }} {{ vault.symbol }}
        </VaultOverviewLabelValue>
        <VaultOverviewLabelValue label="Total assets">
          {{ compactNumber(nanoToValue(vault.totalAssets, vault.asset.decimals)) }} {{ vault.asset.symbol }}
        </VaultOverviewLabelValue>
      </div>
    </div>

    <!-- Risk Parameters -->
    <div
      class="bg-euler-dark-300 rounded-16 flex flex-col gap-24 p-24"
      :class="[desktopOverview ? 'py-16 px-0 bg-transparent' : '']"
    >
      <p class="text-h3 text-white">
        Risk parameters
      </p>
      <div class="flex flex-col items-start gap-24">
        <VaultOverviewLabelValue
          label="Share token exchange rate"
          orientation="horizontal"
        >
          <template v-if="shareTokenExchangeRate !== undefined">
            {{ formatNumber(nanoToValue(shareTokenExchangeRate, vault.asset.decimals), 6, 2) }}
          </template>
          <template v-else>
            -
          </template>
        </VaultOverviewLabelValue>
        <VaultOverviewLabelValue
          label="Is EVault"
          :value="vault.isEVault ? 'Yes' : 'No'"
          orientation="horizontal"
        />
      </div>
    </div>

    <!-- Borrow Markets - shows which EVK vaults accept this as collateral -->
    <div
      v-if="borrowMarkets.length"
      class="bg-euler-dark-300 rounded-16 flex flex-col gap-24 p-24"
      :class="[desktopOverview ? 'py-16 px-0 bg-transparent' : '']"
    >
      <div>
        <p class="text-h3 text-white mb-12">
          Borrow Markets
        </p>
        <p class="text-euler-dark-900">
          This vault can be used as collateral to borrow from the following markets.
        </p>
      </div>

      <div class="flex flex-col gap-12">
        <div
          v-for="market in borrowMarkets"
          :key="market.borrowVault.address"
        >
          <NuxtLink
            class="bg-euler-dark-500 rounded-16 text-white block no-underline"
            :to="`/borrow-securitize/${vault.address}/${market.borrowVault.address}`"
          >
            <div
              class="px-16 pt-16 pb-12"
              style="border-bottom: 1px solid var(--c-euler-dark-600)"
            >
              <VaultLabelsAndAssets
                :vault="market.borrowVault"
                :assets="[market.borrowVault.asset]"
              />
            </div>
            <div class="flex flex-col gap-12 px-16 pt-12 pb-16">
              <VaultOverviewLabelValue
                label="Max LTV"
                orientation="horizontal"
                :value="`${formatNumber(nanoToValue(market.ltv.borrowLTV, 2), 2)}%`"
              />
              <VaultOverviewLabelValue
                label="LLTV"
                orientation="horizontal"
                :value="`${formatNumber(nanoToValue(market.ltv.liquidationLTV, 2), 2)}%`"
              />
            </div>
          </NuxtLink>
        </div>
      </div>
    </div>

    <!-- Addresses -->
    <div
      class="bg-euler-dark-300 rounded-16 flex flex-col gap-24 p-24"
      :class="[desktopOverview ? 'py-16 px-0 bg-transparent' : '']"
    >
      <p class="text-h3 text-white">
        Addresses
      </p>
      <div class="flex flex-col items-start gap-24">
        <VaultOverviewLabelValue label="Vault">
          <AddressChip :address="vault.address" />
        </VaultOverviewLabelValue>
        <VaultOverviewLabelValue label="Underlying asset">
          <AddressChip :address="vault.asset.address" />
        </VaultOverviewLabelValue>
        <VaultOverviewLabelValue
          v-if="vault.governorAdmin && vault.governorAdmin !== '0x0000000000000000000000000000000000000000'"
          label="Governor admin"
        >
          <AddressChip :address="vault.governorAdmin" />
        </VaultOverviewLabelValue>
      </div>
    </div>
  </div>
</template>
