<script setup lang="ts">
import { MaxUint256, ethers } from 'ethers'
import { getVaultPrice, type Vault } from '~/entities/vault'

const { vault } = defineProps<{ vault: Vault }>()

const { EVM_PROVIDER_URL } = useEulerConfig()

const shareTokenExchangeRate: Ref<bigint | undefined> = ref()

const calcPrice = (amount: bigint) => {
  return getVaultPrice(nanoToValue(amount, vault.decimals), vault)
}

const load = async () => {
  const provider = new ethers.JsonRpcProvider(EVM_PROVIDER_URL)
  const contract = new ethers.Contract(
    vault.address,
    [{
      type: 'function',
      name: 'convertToAssets',
      inputs: [
        {
          name: 'shares',
          type: 'uint256',
        },
      ],
      outputs: [
        {
          name: 'assets',
          type: 'uint256',
        },
      ],
      stateMutability: 'view',
    }],
    provider,
  )
  shareTokenExchangeRate.value = await contract.convertToAssets(1n * 10n ** vault.decimals)
}

load()
</script>

<template>
  <div class="bg-euler-dark-300 br-16 column gap-24 p-24">
    <p class="h3 text-white">
      Risk parameters
    </p>
    <div class="column align-start gap-24">
      <VaultOverviewLabelValue
        label="Liquidation"
        :value="`0-${vault.maxLiquidationDiscount / 100n}%`"
        orientation="horizontal"
      />
      <VaultOverviewLabelValue
        label="Supply cap"
        :value="vault.supplyCap >= MaxUint256 ? '∞' : `$${compactNumber(calcPrice(vault.supplyCap))}`"
        orientation="horizontal"
      />
      <VaultOverviewLabelValue
        label="Borrow cap"
        :value="vault.borrowCap >= MaxUint256 ? '∞' :`$${compactNumber(calcPrice(vault.borrowCap))}`"
        orientation="horizontal"
      />
      <VaultOverviewLabelValue
        label="Share token exchange rate"
        orientation="horizontal"
      >
        <template v-if="shareTokenExchangeRate !== undefined">
          {{ formatNumber(nanoToValue(shareTokenExchangeRate, vault.decimals), 6, 2) }}
        </template>
        <template v-else>
          -
        </template>
      </VaultOverviewLabelValue>
      <VaultOverviewLabelValue
        label="Bad debt socialisation"
        :value="vault.configFlags === 0n ? 'Yes' : 'No'"
        orientation="horizontal"
      />
      <VaultOverviewLabelValue
        label="Interest fee"
        :value="`${formatNumber(nanoToValue(vault.interestFee, 2))}%`"
        orientation="horizontal"
      />
    </div>
  </div>
</template>

<style scoped lang="scss">

</style>
