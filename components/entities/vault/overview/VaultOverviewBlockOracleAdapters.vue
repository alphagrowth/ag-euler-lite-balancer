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
const { oracleAdapters, loadOracleAdapter } = useEulerLabels()
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
    // Dedupe by oracle address - same oracle shows same provider/methodology
    const key = adapter.oracle.toLowerCase()
    if (!deduped.has(key)) {
      deduped.set(key, adapter)
    }
  })

  return [...deduped.values()]
})

const adapterViews = computed(() => adapters.value.map((adapter) => {
  const meta: OracleAdapterMeta | undefined = oracleAdapters[adapter.oracle.toLowerCase()]

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
})

watch(
  () => adapters.value,
  async (adapterList) => {
    if (!chainId.value || !adapterList.length) return

    // Load only the adapters we need
    await Promise.all(
      adapterList.map(a => loadOracleAdapter(chainId.value, a.oracle))
    )
  },
  { immediate: true }
)

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

const getAdapterKey = (adapter: OracleAdapterEntry) => adapter.oracle.toLowerCase()
const getExplorerAddressLink = (address: string) => getExplorerLink(address, chainId.value, true)
</script>

<template>
  <div class="bg-surface-secondary rounded-xl flex flex-col gap-24 p-24 shadow-card">
    <p class="text-h3 text-content-primary">
      Oracles
    </p>
    <div
      v-if="!adapterViews.length"
      class="text-p3 text-content-tertiary"
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
        class="w-full rounded-xl bg-surface p-16 flex flex-col gap-12 border border-line-subtle"
      >
        <div class="flex flex-wrap items-center gap-8">
          <div class="p2 text-content-primary">
            {{ resolveSymbol(adapter.base) }}/{{ resolveSymbol(adapter.quote) }}
          </div>
          <NuxtLink
            :to="getExplorerAddressLink(adapter.oracle)"
            class="text-accent-600 underline cursor-pointer hover:text-accent-500"
            target="_blank"
          >
            {{ shortenAddress(adapter.oracle) }}
          </NuxtLink>
          <button
            :class="$style.copyBtn"
            class="text-content-muted"
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
            <span class="text-content-tertiary">Provider</span>
            <span class="text-content-primary">{{ adapter.provider || '-' }}</span>
          </div>
          <div class="flex flex-col gap-4">
            <span class="text-content-tertiary">Methodology</span>
            <span class="text-content-primary">{{ adapter.methodology || '-' }}</span>
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
    color: var(--text-secondary);
  }

  &:active {
    color: var(--text-primary);
  }
}
</style>
