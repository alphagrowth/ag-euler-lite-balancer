<script setup lang="ts">
import type { Vault } from '~/entities/vault'
import { collectOracleAdapters, type OracleAdapterEntry } from '~/entities/oracle'

const props = defineProps<{ vault?: Vault, vaults?: Vault[] }>()
const { tokens, loadTokens } = useTokens()

const USD_ADDRESS = '0x0000000000000000000000000000000000000348'
const EUR_ADDRESS = '0x00000000000000000000000000000000000003d2'

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
  })

  entries.forEach((adapter) => {
    const key = `${adapter.oracle.toLowerCase()}:${adapter.base.toLowerCase()}:${adapter.quote.toLowerCase()}`
    if (!deduped.has(key)) {
      deduped.set(key, adapter)
    }
  })

  return [...deduped.values()]
})

onMounted(() => {
  if (!Object.keys(tokens).length) {
    loadTokens()
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
</script>

<template>
  <div class="bg-euler-dark-300 br-16 column gap-24 p-24">
    <p class="h3 text-white">
      Oracles
    </p>
    <div v-if="!adapters.length" class="p3 text-euler-dark-900">
      No oracle adapters found
    </div>
    <div v-else class="column align-start gap-16">
      <VaultOverviewLabelValue
        v-for="adapter in adapters"
        :key="getAdapterKey(adapter)"
        orientation="horizontal"
      >
        <template #label>
          <div class="gap-4 align-center">
            <div class="p2">
              {{ resolveSymbol(adapter.base) }}/{{ resolveSymbol(adapter.quote) }}
            </div>
            <!-- <NuxtLink
              :to="`https://etherscan.io/address/${adapter.base}`"
              class="link"
              target="_blank"
            >
              {{ resolveSymbol(adapter.base) }}
            </NuxtLink> -->
            <!-- <span class="text-euler-dark-900">/</span>
            <NuxtLink
              :to="`https://etherscan.io/address/${adapter.quote}`"
              class="link"
              target="_blank"
            >
              {{ resolveSymbol(adapter.quote) }}
            </NuxtLink> -->
          </div>
        </template>
        <div class="gap-4 align-center">
          <NuxtLink
            :to="`https://etherscan.io/address/${adapter.oracle}`"
            class="link"
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
              class="icon--18"
              name="copy"
            />
          </button>
          <!-- <span class="text-euler-dark-900">({{ adapter.name }})</span> -->
        </div>
      </VaultOverviewLabelValue>
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
