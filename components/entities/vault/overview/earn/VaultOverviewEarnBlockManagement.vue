<script setup lang="ts">
import type { EarnVault } from '~/entities/vault'
import { formatTtl } from '~/utils/crypto-utils'
import { getExplorerLink } from '~/utils/block-explorer'

const { vault } = defineProps<{ vault: EarnVault }>()
const { chainId } = useEulerAddresses()

const vaultAddressesInfo = computed(() => ([
  {
    title: `Owner`,
    address: vault.owner,
  },
  {
    title: `Curator`,
    address: vault.curator,
  },
  {
    title: `Guardian`,
    address: vault.guardian,
  },
]))

const shortenAddress = (address: string) => {
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

const timelockDisplay = computed(() => {
  if (vault.timelock === 0n) {
    return '0 days'
  }

  const timelockInSeconds = vault.timelock
  const timelockInDays = timelockInSeconds / 86400n
  return formatTtl(timelockInDays)?.display || 'Unknown'
})

const onCopyClick = (address: string) => {
  navigator.clipboard.writeText(address)
}

const getExplorerAddressLink = (address: string) => getExplorerLink(address, chainId.value, true)
</script>

<template>
  <div class="bg-euler-dark-300 rounded-16 flex flex-col gap-24 p-24">
    <p class="text-h3 text-white">
      Management
    </p>
    <div class="flex flex-col items-start gap-24">
      <VaultOverviewLabelValue
        v-for="infoItem in vaultAddressesInfo"
        :key="infoItem.title"
        :label="infoItem.title"
        orientation="horizontal"
      >
        <div class="flex gap-4 items-center">
          <NuxtLink
            :to="getExplorerAddressLink(infoItem.address)"
            class="text-aquamarine-700 underline cursor-pointer hover:text-aquamarine-600"
            target="_blank"
          >
            {{ shortenAddress(infoItem.address) }}
          </NuxtLink>
          <button
            class="text-euler-dark-900 cursor-pointer outline-none hover:text-euler-dark-800 active:text-euler-dark-700"
            @click="onCopyClick(infoItem.address)"
          >
            <SvgIcon
              class="!w-18 !h-18"
              name="copy"
            />
          </button>
        </div>
      </VaultOverviewLabelValue>
      <VaultOverviewLabelValue
        label="Timelock"
        :value="timelockDisplay"
        orientation="horizontal"
      />
    </div>
  </div>
</template>
