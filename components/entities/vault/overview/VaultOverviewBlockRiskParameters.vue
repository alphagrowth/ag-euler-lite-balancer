<script setup lang="ts">
import { MaxUint256, ethers } from 'ethers'
import { vaultConvertToAssetsAbi } from '~/abis/vault'
import { getVaultPrice, type Vault } from '~/entities/vault'

const { vault } = defineProps<{ vault: Vault }>()

const { EVM_PROVIDER_URL } = useEulerConfig()
const { borrowList } = useVaults()

const shareTokenExchangeRate: Ref<bigint | undefined> = ref()

const borrowCount = computed(() => {
  return borrowList.value.filter(pair => pair.borrow.address === vault.address).length
})

const isBorrowable = computed(() => borrowCount.value > 0)

const supplyCapPercentageDisplay = computed(() => {
  if (vault.supplyCap >= MaxUint256 || vault.supplyCap === 0n) return 0
  const scale = 10n ** 2n
  const fraction = (vault.supply * scale * 100n) / vault.supplyCap
  return parseFloat(`${fraction / scale}.${fraction % scale}`)
})

const borrowCapPercentageDisplay = computed(() => {
  if (vault.borrowCap >= MaxUint256 || vault.borrowCap === 0n) return 0
  const scale = 10n ** 2n
  const fraction = (vault.borrow * scale * 100n) / vault.borrowCap
  return parseFloat(`${fraction / scale}.${fraction % scale}`)
})

const calcPrice = (amount: bigint) => {
  return getVaultPrice(nanoToValue(amount, vault.decimals), vault)
}

const load = async () => {
  const provider = new ethers.JsonRpcProvider(EVM_PROVIDER_URL)
  const contract = new ethers.Contract(
    vault.address,
    vaultConvertToAssetsAbi,
    provider,
  )
  shareTokenExchangeRate.value = await contract.convertToAssets(1n * 10n ** vault.decimals)
}

load()
</script>

<template>
  <div class="bg-surface-secondary rounded-xl flex flex-col gap-24 p-24 shadow-card">
    <p class="text-h3 text-content-primary">
      Risk parameters
    </p>
    <div class="flex flex-col items-start gap-24">
      <VaultOverviewLabelValue
        v-if="isBorrowable"
        label="Liquidation bonus"
        :value="`0-${vault.maxLiquidationDiscount / 100n}%`"
        orientation="horizontal"
      />
      <VaultOverviewLabelValue
        label="Supply cap"
        orientation="horizontal"
      >
        <div class="flex gap-4 items-center">
          <span>
            {{ vault.supplyCap >= MaxUint256 ? '∞' : `$${compactNumber(calcPrice(vault.supplyCap))}` }}
            <span v-if="vault.supplyCap < MaxUint256">({{ compactNumber(supplyCapPercentageDisplay, 2) }}%)</span>
          </span>
          <UiRadialProgress
            :value="supplyCapPercentageDisplay"
            :max="100"
          />
        </div>
      </VaultOverviewLabelValue>
      <VaultOverviewLabelValue
        v-if="isBorrowable"
        label="Borrow cap"
        orientation="horizontal"
      >
        <div class="flex gap-4 items-center">
          <span>
            {{ vault.borrowCap >= MaxUint256 ? '∞' :`$${compactNumber(calcPrice(vault.borrowCap))}` }}
            <span v-if="vault.supplyCap < MaxUint256">({{ compactNumber(borrowCapPercentageDisplay, 2) }}%)</span>
          </span>
          <UiRadialProgress
            :value="borrowCapPercentageDisplay"
            :max="100"
          />
        </div>
      </VaultOverviewLabelValue>
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
        v-if="isBorrowable"
        label="Bad debt socialisation"
        :value="vault.configFlags === 0n ? 'Yes' : 'No'"
        orientation="horizontal"
      />
      <VaultOverviewLabelValue
        v-if="isBorrowable"
        label="Interest fee"
        :value="`${formatNumber(nanoToValue(vault.interestFee, 2))}%`"
        orientation="horizontal"
      />
    </div>
  </div>
</template>
