<script setup lang="ts">
import type { EarnVault } from '~/entities/vault'

const { vault } = defineProps<{ vault: EarnVault }>()

const vaultAddresesInfo = computed(() => ([
  {
    title: `Underlying ${vault.asset.symbol} token`,
    address: vault.asset.address,
  },
  {
    title: `Earn vault`,
    address: vault.address,
  },
  {
    title: `Fee receiver`,
    address: vault.feeReceiver,
  },
]))

const shortenAddress = (address: string) => {
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

const onCopyClick = (address: string) => {
  navigator.clipboard.writeText(address)
}
</script>

<template>
  <div class="bg-euler-dark-300 rounded-16 flex flex-col gap-24 p-24">
    <p class="text-h3 text-white">
      Addresses
    </p>
    <div class="flex flex-col items-start gap-24">
      <VaultOverviewLabelValue
        v-for="infoItem in vaultAddresesInfo"
        :key="infoItem.title"
        :label="infoItem.title"
        orientation="horizontal"
      >
        <div class="flex gap-4 items-center">
          <NuxtLink
            :to="`https://etherscan.io/address/${infoItem.address}`"
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
    </div>
  </div>
</template>
