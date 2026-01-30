<script setup lang="ts">
import { MaxUint256, ethers } from 'ethers'
import type { SecuritizeVault, Vault, VaultCollateralLTV } from '~/entities/vault'
import { useEulerEntitiesOfVault } from '~/composables/useEulerLabels'
import { getEulerLabelEntityLogo } from '~/entities/euler/labels'
import { getExplorerLink } from '~/utils/block-explorer'

const { vault } = defineProps<{ vault: SecuritizeVault, desktopOverview?: boolean }>()

const { EVM_PROVIDER_URL } = useEulerConfig()
const { chainId } = useEulerAddresses()
const { list, borrowList, isVaultGovernorVerified } = useVaults()
const { getOpportunityOfLendVault } = useMerkl()
const { getIntrinsicApy } = useIntrinsicApy()
const product = useEulerProductOfVault(vault.address)
const entities = useEulerEntitiesOfVault(vault as unknown as Vault)
const isGovernorVerified = computed(() => isVaultGovernorVerified(vault as unknown as Vault))

const shortenAddress = (address: string) => {
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

const onCopyClick = (address: string) => {
  navigator.clipboard.writeText(address)
}

const getExplorerAddressLink = (address: string) => getExplorerLink(address, chainId.value, true)

// Count markets where this can be borrowed (securitize vaults cannot be borrow destinations)
const borrowCount = computed(() => 0)

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

// Supply APY calculation (intrinsic + rewards, no base interest for securitize vaults)
const rewardSupplyAPY = computed(() => getOpportunityOfLendVault(vault.address)?.apr || 0)
const intrinsicApy = computed(() => getIntrinsicApy(vault.asset.symbol, 'supply'))
const supplyApyWithRewards = computed(() => intrinsicApy.value + rewardSupplyAPY.value)

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

// Supply cap display - supplyCap is in shares denomination (vault.decimals), same as regular vaults
const supplyCapDisplay = computed(() => {
  if (!vault.supplyCap || vault.supplyCap === 0n || vault.supplyCap >= MaxUint256) {
    return '∞'
  }
  // Display in shares (like regular vaults, but without USD conversion since we don't have price info)
  return `${compactNumber(nanoToValue(vault.supplyCap, vault.decimals))} ${vault.symbol}`
})

const supplyCapPercentageDisplay = computed(() => {
  if (!vault.supplyCap || vault.supplyCap >= MaxUint256 || vault.supplyCap === 0n) return 0
  const scale = 10n ** 2n
  // Compare totalShares to supplyCap (both in shares denomination)
  const fraction = (vault.totalShares * scale * 100n) / vault.supplyCap
  return parseFloat(`${fraction / scale}.${fraction % scale}`)
})
</script>

<template>
  <div
    class="flex flex-col"
    :class="[!desktopOverview ? 'gap-12' : '']"
  >
    <!-- Overview -->
    <div
      class="bg-euler-dark-300 rounded-16 flex flex-col gap-24 p-24"
      :class="[desktopOverview ? 'py-16 [&:first-child]:!pt-0 px-0 bg-transparent' : '']"
    >
      <p class="text-h3 text-white">
        Overview
      </p>
      <div class="flex flex-col items-start gap-24">
        <VaultOverviewLabelValue
          label="Market"
          :value="product.name"
        />
        <VaultOverviewLabelValue label="Risk manager(s)">
          <div
            v-if="entities.length && isGovernorVerified"
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
          <div
            v-else-if="!isGovernorVerified"
            class="flex gap-8 items-center py-8 px-12 rounded-8 bg-[var(--c-yellow-opaque-200)] text-yellow-700"
          >
            <UiIcon
              class="mr-2 !w-20 !h-20 text-yellow-600"
              name="warning"
            />
            Unknown
          </div>
          <div v-else>
            -
          </div>
        </VaultOverviewLabelValue>
        <VaultOverviewLabelValue label="Vault type">
          <VaultTypeChip
            :vault="vault as unknown as Vault"
            type="securitize"
          />
        </VaultOverviewLabelValue>
        <VaultOverviewLabelValue label="Can be borrowed">
          <div class="flex items-center gap-8">
            <div>
              <UiIcon :name="borrowCount ? 'green-tick' : 'red-cross'" />
            </div>
            <span class="text-p2 text-white">
              {{ borrowCount ? `Yes in ${borrowCount} markets` : 'No' }}
            </span>
          </div>
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
        <VaultOverviewLabelValue
          label="Total supply"
          :value="`${compactNumber(nanoToValue(vault.totalAssets, vault.asset.decimals))} ${vault.asset.symbol}`"
          orientation="horizontal"
        />
        <VaultOverviewLabelValue
          label="Supply APY"
          :value="`${formatNumber(supplyApyWithRewards)}%`"
          orientation="horizontal"
        />
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
          label="Supply cap"
          orientation="horizontal"
        >
          <div class="flex gap-4 items-center">
            <span>
              {{ supplyCapDisplay }}
              <span v-if="vault.supplyCap && vault.supplyCap < MaxUint256 && vault.supplyCap > 0n">
                ({{ compactNumber(supplyCapPercentageDisplay, 2) }}%)
              </span>
            </span>
            <UiRadialProgress
              v-if="vault.supplyCap && vault.supplyCap < MaxUint256 && vault.supplyCap > 0n"
              :value="supplyCapPercentageDisplay"
              :max="100"
            />
          </div>
        </VaultOverviewLabelValue>
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
        <VaultOverviewLabelValue
          :label="`Underlying ${vault.asset.symbol} token`"
          orientation="horizontal"
        >
          <div class="flex gap-4 items-center">
            <NuxtLink
              :to="getExplorerAddressLink(vault.asset.address)"
              class="text-aquamarine-700 underline cursor-pointer hover:text-aquamarine-600"
              target="_blank"
            >
              {{ shortenAddress(vault.asset.address) }}
            </NuxtLink>
            <button
              class="text-euler-dark-900 cursor-pointer outline-none hover:text-euler-dark-800 active:text-euler-dark-700"
              @click="onCopyClick(vault.asset.address)"
            >
              <SvgIcon
                class="!w-18 !h-18"
                name="copy"
              />
            </button>
          </div>
        </VaultOverviewLabelValue>
        <VaultOverviewLabelValue
          :label="`${vault.symbol} vault`"
          orientation="horizontal"
        >
          <div class="flex gap-4 items-center">
            <NuxtLink
              :to="getExplorerAddressLink(vault.address)"
              class="text-aquamarine-700 underline cursor-pointer hover:text-aquamarine-600"
              target="_blank"
            >
              {{ shortenAddress(vault.address) }}
            </NuxtLink>
            <button
              class="text-euler-dark-900 cursor-pointer outline-none hover:text-euler-dark-800 active:text-euler-dark-700"
              @click="onCopyClick(vault.address)"
            >
              <SvgIcon
                class="!w-18 !h-18"
                name="copy"
              />
            </button>
          </div>
        </VaultOverviewLabelValue>
        <VaultOverviewLabelValue
          v-if="vault.governorAdmin && vault.governorAdmin !== '0x0000000000000000000000000000000000000000'"
          label="Risk manager"
          orientation="horizontal"
        >
          <div class="flex gap-4 items-center">
            <NuxtLink
              :to="getExplorerAddressLink(vault.governorAdmin)"
              class="text-aquamarine-700 underline cursor-pointer hover:text-aquamarine-600"
              target="_blank"
            >
              {{ shortenAddress(vault.governorAdmin) }}
            </NuxtLink>
            <button
              class="text-euler-dark-900 cursor-pointer outline-none hover:text-euler-dark-800 active:text-euler-dark-700"
              @click="onCopyClick(vault.governorAdmin)"
            >
              <SvgIcon
                class="!w-18 !h-18"
                name="copy"
              />
            </button>
          </div>
        </VaultOverviewLabelValue>
      </div>
    </div>
  </div>
</template>
