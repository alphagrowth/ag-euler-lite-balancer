<script setup lang="ts">
import type { Address } from 'viem'
import type { Vault, SecuritizeVault } from '~/entities/vault'
import { EUR_ADDRESS, USD_ADDRESS } from '~/entities/constants'
import { collectOracleAdapters, type OracleAdapterEntry, type OracleAdapterMeta } from '~/entities/oracle'
import { getExplorerLink } from '~/utils/block-explorer'

const props = defineProps<{
  vault?: Vault
  vaults?: Vault[]
  collateralVaults?: (Vault | SecuritizeVault)[]
}>()
const { tokens, loadTokens } = useTokens()
const { oracleAdapters, loadOracleAdapters } = useEulerLabels()
const { chainId } = useEulerAddresses()

const sourceVaults = computed(() => {
  if (props.vaults?.length) {
    return props.vaults
  }

  if (props.vault) {
    return [props.vault]
  }

  return []
})

const adapters = computed(() => {
  const entries: OracleAdapterEntry[] = []
  const deduped = new Map<string, OracleAdapterEntry>()

  sourceVaults.value.forEach((vault) => {
    entries.push(...collectOracleAdapters(vault.oracleDetailedInfo, 3, {
      base: vault.asset.address,
      quote: vault.unitOfAccount,
      leafOnly: true,
    }))

    if (props.collateralVaults?.length) {
      props.collateralVaults.forEach((collateralVault) => {
        entries.push(...collectOracleAdapters(vault.oracleDetailedInfo, 3, {
          base: collateralVault.address,
          quote: vault.unitOfAccount,
          leafOnly: true,
        }))
      })
    }
  })

  entries.forEach((adapter) => {
    const key = `${adapter.oracle.toLowerCase()}:${adapter.base.toLowerCase()}:${adapter.quote.toLowerCase()}`
    if (!deduped.has(key)) {
      deduped.set(key, adapter)
    }
  })

  return [...deduped.values()]
})

const adapterViews = computed(() => adapters.value.map((adapter) => {
  const base = adapter.base.toLowerCase()
  const quote = adapter.quote.toLowerCase()
  const oracle = adapter.oracle.toLowerCase()
  const key = `${oracle}:${base}:${quote}`
  const meta: OracleAdapterMeta | undefined = oracleAdapters[key] || oracleAdapters[oracle]

  return {
    ...adapter,
    name: meta?.name || adapter.name,
    provider: meta?.provider,
    methodology: meta?.methodology,
  }
}))

onMounted(() => {
  if (!Object.keys(tokens).length) {
    loadTokens()
  }
  if (!Object.keys(oracleAdapters).length && chainId.value) {
    loadOracleAdapters(chainId.value)
  }
})

const shortenAddress = (address: string) => `${address.slice(0, 6)}...${address.slice(-4)}`

const tokenSymbolsByAddress = computed(() => {
  const map = new Map<string, string>()

  map.set(USD_ADDRESS, 'USD')
  map.set(EUR_ADDRESS, 'EUR')

  Object.values(tokens).forEach((token) => {
    if (token.address && token.symbol) {
      map.set(token.address.toLowerCase(), token.symbol)
    }
  })

  sourceVaults.value.forEach((vault) => {
    map.set(vault.asset.address.toLowerCase(), vault.asset.symbol)

    if (vault.unitOfAccountSymbol) {
      map.set(vault.unitOfAccount.toLowerCase(), vault.unitOfAccountSymbol)
    }
  })

  // Map collateral vault addresses to their underlying asset symbols
  props.collateralVaults?.forEach((vault) => {
    map.set(vault.address.toLowerCase(), vault.asset.symbol)
  })

  return map
})

const resolveSymbol = (address: string) => {
  const symbol = tokenSymbolsByAddress.value.get(address.toLowerCase())
  return symbol || shortenAddress(address)
}

const onCopyClick = (address: string) => {
  navigator.clipboard.writeText(address)
}

const getAdapterKey = (adapter: OracleAdapterEntry) => `${adapter.oracle}-${adapter.base}-${adapter.quote}`
const getExplorerAddressLink = (address: string) => getExplorerLink(address, chainId.value, true)
</script>

<template>
  <div class="bg-euler-dark-300 rounded-16 flex flex-col gap-24 p-24">
    <p class="text-h3 text-white">
      Oracles
    </p>
    <div
      v-if="!adapterViews.length"
      class="text-p3 text-euler-dark-900"
    >
      No oracle adapters found
    </div>
    <div
      v-else
      class="flex flex-col items-start gap-16"
    >
      <div
        v-for="adapter in adapterViews"
        :key="getAdapterKey(adapter)"
        class="w-full rounded-16 bg-euler-dark-500 p-16 flex flex-col gap-12"
      >
        <div class="flex flex-wrap items-center gap-8">
          <div class="p2 text-white">
            {{ resolveSymbol(adapter.base) }}/{{ resolveSymbol(adapter.quote) }}
          </div>
          <NuxtLink
            :to="getExplorerAddressLink(adapter.oracle)"
            class="text-aquamarine-700 underline cursor-pointer hover:text-aquamarine-600"
            target="_blank"
          >
            {{ shortenAddress(adapter.oracle) }}
          </NuxtLink>
          <button
            :class="$style.copyBtn"
            class="text-euler-dark-900"
            @click="onCopyClick(adapter.oracle)"
          >
            <SvgIcon
              class="!w-18 !h-18"
              name="copy"
            />
          </button>
        </div>
        <div class="grid grid-cols-2 gap-12 text-p4">
          <div class="flex flex-col gap-4">
            <span class="text-euler-dark-900">Provider</span>
            <span class="text-white">{{ adapter.provider || '-' }}</span>
          </div>
          <div class="flex flex-col gap-4">
            <span class="text-euler-dark-900">Methodology</span>
            <span class="text-white">{{ adapter.methodology || '-' }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style module lang="scss">
.copyBtn {
  cursor: pointer;
  outline: none;

  &:hover {
    color: var(--c-euler-dark-800);
  }

  &:active {
    color: var(--c-euler-dark-700);
  }
}
</style>
