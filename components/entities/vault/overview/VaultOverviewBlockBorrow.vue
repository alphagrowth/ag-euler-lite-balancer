<script setup lang="ts">
import type { Vault, EscrowVault } from '~/entities/vault'

const emits = defineEmits(['vault-click'])
const { vault } = defineProps<{ vault: Vault }>()
const { borrowList, escrowMap } = useVaults()

const borrowVaultPairs = computed(() => borrowList.value.filter(pair => pair.borrow.address === vault.address))

const escrowCollateralPairs = computed(() => {
  const pairs: Array<{
    borrow: Vault
    collateral: EscrowVault
    borrowLTV: bigint
    liquidationLTV: bigint
    initialLiquidationLTV: bigint
    isEscrow: true
  }> = []

  vault.collateralLTVs.forEach((ltv) => {
    if (ltv.borrowLTV <= 0n) return

    const escrowVault = escrowMap.value.get(ltv.collateral)
    if (escrowVault) {
      pairs.push({
        borrow: vault,
        collateral: escrowVault,
        borrowLTV: ltv.borrowLTV,
        liquidationLTV: ltv.liquidationLTV,
        initialLiquidationLTV: ltv.initialLiquidationLTV,
        isEscrow: true,
      })
    }
  })

  return pairs
})

const allCollateralPairs = computed(() => [
  ...escrowCollateralPairs.value,
  ...borrowVaultPairs.value.map(pair => ({ ...pair, isEscrow: false })),
])
</script>

<template>
  <div
    v-if="allCollateralPairs.length"
    class="bg-euler-dark-300 rounded-16 flex flex-col gap-24 p-24"
  >
    <div>
      <p class="text-h3 text-white mb-12">
        Collateral exposure
      </p>
      <p class="text-euler-dark-900">
        Deposits in this market can be borrowed.
        Please make sure you're comfortable accepting the collateral
        listed in the table below before depositing.
      </p>
    </div>

    <div class="flex flex-col gap-12">
      <div
        v-for="pair in allCollateralPairs"
        :key="pair.collateral.address"
        @click="emits('vault-click')"
      >
        <NuxtLink
          class="bg-euler-dark-500 rounded-16 text-white block no-underline"
          :to="`/lend/${pair.collateral.address}`"
        >
          <div
            class="px-16 pt-16 pb-12"
            style="border-bottom: 1px solid var(--c-euler-dark-600)"
          >
            <VaultLabelsAndAssets
              :vault="pair.collateral"
              :assets="[pair.collateral.asset]"
            />
          </div>
          <div class="flex flex-col gap-12 px-16 pt-12 pb-16">
            <VaultOverviewLabelValue
              label="Max LTV"
              orientation="horizontal"
              :value="`${formatNumber(nanoToValue(pair.borrowLTV, 2), 2)}%`"
            />
            <VaultOverviewLabelValue
              label="LLTV"
              orientation="horizontal"
              :value="`${formatNumber(nanoToValue(pair.liquidationLTV, 2), 2)}%`"
            />
          </div>
        </NuxtLink>
      </div>
    </div>
  </div>
</template>
