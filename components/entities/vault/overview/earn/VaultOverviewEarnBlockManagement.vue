<script setup lang="ts">
import type { EarnVault } from '~/entities/vault'

const { vault } = defineProps<{ vault: EarnVault }>()

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

const onCopyClick = (address: string) => {
  navigator.clipboard.writeText(address)
}
</script>

<template>
  <div class="bg-euler-dark-300 br-16 column gap-24 p-24">
    <p class="h3 text-white">
      Management
    </p>
    <div class="column align-start gap-24">
      <VaultOverviewLabelValue
        v-for="infoItem in vaultAddressesInfo"
        :key="infoItem.title"
        :label="infoItem.title"
        orientation="horizontal"
      >
        <div class="gap-4 align-center">
          <NuxtLink
            :to="`https://etherscan.io/address/${infoItem.address}`"
            class="link"
            target="_blank"
          >
            {{ shortenAddress(infoItem.address) }}
          </NuxtLink>
          <button
            :class="$style.copyBtn"
            class="text-euler-dark-900"
            @click="onCopyClick(infoItem.address)"
          >
            <SvgIcon
              class="icon--18"
              name="copy"
            />
          </button>
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
