<script setup lang="ts">
import { type Vault } from '~/entities/vault'
import { getUtilisationWarning } from '~/composables/useVaultWarnings'
import { getAssetUsdValue, formatAssetValue } from '~/services/pricing/priceProvider'
import { getAssetLogoUrl } from '~/composables/useTokens'
import type { AccountDepositPosition } from '~/entities/account'
import { VaultOverviewModal } from '#components'
import { useModal } from '~/components/ui/composables/useModal'

const { position } = defineProps<{ position: AccountDepositPosition }>()
const modal = useModal()

const { getOpportunityOfLendVault } = useMerkl()
const { withIntrinsicSupplyApy } = useIntrinsicApy()

const vault = computed(() => position.vault)
const utilisationWarning = computed(() => {
  if ('type' in vault.value && vault.value.type === 'securitize') return null
  return getUtilisationWarning(vault.value as Vault, 'lend')
})

// Check if securitize vault by type field
const isSecuritize = computed(() => 'type' in vault.value && vault.value.type === 'securitize')
const regularVault = computed(() => isSecuritize.value ? null : vault.value as Vault)

const opportunityInfo = computed(() => getOpportunityOfLendVault(vault.value.address))
const supplyApy = computed(() => {
  return withIntrinsicSupplyApy(
    nanoToValue(vault.value.interestRateInfo.supplyAPY, 25),
    vault.value.asset.symbol,
  )
})
const supplyApyWithRewards = computed(() => supplyApy.value + (opportunityInfo.value?.apr || 0))

const product = useEulerProductOfVault(computed(() => vault.value.address))
const isEscrow = computed(() => 'vaultCategory' in vault.value && vault.value.vaultCategory === 'escrow')
const isUnverified = computed(() => 'verified' in vault.value && !vault.value.verified)
const displayName = computed(() => {
  if (isEscrow.value) return 'Escrowed collateral'
  return product.name || vault.value.name
})

const supplyValueDisplay = ref('-')

const updateSupplyValueDisplay = async () => {
  if (!regularVault.value) {
    supplyValueDisplay.value = `${formatNumber(nanoToValue(position.assets, vault.value.asset.decimals))} ${vault.value.asset.symbol}`
    return
  }
  const price = await formatAssetValue(position.assets, regularVault.value, 'off-chain')
  supplyValueDisplay.value = price.hasPrice ? formatCompactUsdValue(price.usdValue) : price.display
}

watchEffect(() => {
  updateSupplyValueDisplay()
})

const hasPrice = ref(false)

const updateHasPrice = async () => {
  if (!regularVault.value) {
    hasPrice.value = false
    return
  }
  const price = await getAssetUsdValue(position.assets, regularVault.value, 'off-chain')
  hasPrice.value = price !== undefined && price > 0
}

watchEffect(() => {
  updateHasPrice()
})

const projectedEarningsPerMonth = ref('—')

const updateProjectedEarningsPerMonth = async () => {
  if (!regularVault.value) {
    projectedEarningsPerMonth.value = '—'
    return
  }
  const price = await getAssetUsdValue(position.assets, regularVault.value, 'off-chain')
  if (price === undefined || price === 0) {
    projectedEarningsPerMonth.value = '—'
    return
  }
  // Monthly earnings = (value * APY%) / 12
  projectedEarningsPerMonth.value = compactNumber((price * supplyApyWithRewards.value) / 12 / 100)
}

watchEffect(() => {
  updateProjectedEarningsPerMonth()
})

// Securitize-specific computed properties
const assetAmount = computed(() => {
  return nanoToValue(position.assets, vault.value.asset.decimals)
})

const onClick = () => {
  modal.open(VaultOverviewModal, {
    props: isSecuritize.value
      ? { securitizeVault: vault.value }
      : { vault: vault.value },
  })
}
</script>

<template>
  <!-- Securitize vault display -->
  <div
    v-if="isSecuritize"
    class="block no-underline bg-surface rounded-xl border border-line-subtle shadow-card cursor-pointer transition-all duration-default ease-default hover:shadow-card-hover hover:border-line-emphasis"
    @click="onClick"
  >
    <div class="flex py-16 px-16 pb-12 border-b border-line-default">
      <div class="flex w-full">
        <BaseAvatar
          class="icon--40"
          :src="getAssetLogoUrl(vault.asset.address, vault.asset.symbol)"
          :label="vault.asset.symbol"
        />
        <div class="flex-grow ml-12">
          <div class="text-content-tertiary text-p3 mb-4">
            <VaultDisplayName
              :name="displayName"
              :is-unverified="isUnverified"
            />
          </div>
          <div class="text-h5 text-content-primary">
            {{ vault.asset.symbol }}
          </div>
        </div>
        <div class="flex flex-col items-end">
          <div class="text-content-tertiary text-p3 mb-4">
            Supply APY
          </div>
          <div class="text-p2 flex text-accent-600">
            <SvgIcon
              v-if="opportunityInfo?.apr"
              name="sparks"
              class="!w-20 !h-20 text-accent-600 mr-4"
            />
            {{ formatNumber(supplyApyWithRewards) }}%
          </div>
        </div>
      </div>
    </div>
    <div class="flex py-12 px-16 pb-16">
      <div class="flex flex-col gap-12 w-full">
        <div class="flex justify-between">
          <div class="text-content-tertiary text-p3">
            Supply value
          </div>
          <div class="flex justify-between gap-8 text-right">
            <div class="text-content-primary text-p3">
              {{ formatNumber(assetAmount) }} {{ vault.asset.symbol }}
            </div>
          </div>
        </div>
        <div
          class="flex flex-wrap items-center gap-8"
          @click.stop
        >
          <UiButton
            :to="`/lend/${vault.address}/`"
            rounded
          >
            Supply
          </UiButton>
          <UiButton
            variant="primary-stroke"
            :to="{ path: `/lend/${vault.address}/withdraw`, query: { subAccount: position.subAccount } }"
            rounded
          >
            Withdraw
          </UiButton>
          <UiButton
            variant="primary-stroke"
            :to="{ path: `/lend/${vault.address}/swap`, query: { subAccount: position.subAccount } }"
            rounded
          >
            Asset swap
          </UiButton>
        </div>
      </div>
    </div>
  </div>

  <!-- Regular vault display -->
  <div
    v-else
    class="block no-underline bg-surface rounded-xl border border-line-subtle shadow-card cursor-pointer transition-all duration-default ease-default hover:shadow-card-hover hover:border-line-emphasis"
    @click="onClick"
  >
    <div class="flex py-16 px-16 pb-12 border-b border-line-default">
      <div class="flex w-full">
        <BaseAvatar
          class="icon--40"
          :src="getAssetLogoUrl(vault.asset.address, vault.asset.symbol)"
          :label="vault.asset.symbol"
        />
        <div class="flex-grow ml-12">
          <div class="text-content-tertiary text-p3 mb-4 flex items-center gap-4">
            <VaultDisplayName
              :name="displayName"
              :is-unverified="isUnverified"
            />
            <VaultWarningIcon :warning="utilisationWarning" tooltip-placement="top-start" />
          </div>
          <div class="text-h5 text-content-primary">
            {{ vault.asset.symbol }}
          </div>
        </div>
        <div class="flex flex-col items-end">
          <div class="text-content-tertiary text-p3 mb-4">
            Supply APY
          </div>
          <div class="text-p2 flex text-accent-600">
            <SvgIcon
              v-if="opportunityInfo?.apr"
              name="sparks"
              class="!w-20 !h-20 text-accent-600 mr-4"
            />
            {{ formatNumber(supplyApyWithRewards) }}%
          </div>
        </div>
      </div>
    </div>
    <div class="flex py-12 px-16 pb-16">
      <div class="flex flex-col gap-12 w-full">
        <div class="flex justify-between">
          <div class="text-content-tertiary text-p3">
            Supply value
          </div>
          <div class="flex justify-between gap-8 text-right">
            <div class="text-content-primary text-p3">
              {{ supplyValueDisplay }}
            </div>
            <div
              v-if="regularVault && hasPrice"
              class="text-content-tertiary text-p3"
            >
              ~ {{ roundAndCompactTokens(position.assets, regularVault.decimals) }}
              {{ vault.asset.symbol }}
            </div>
          </div>
        </div>
        <div
          v-if="hasPrice"
          class="flex justify-between"
        >
          <div class="text-content-tertiary text-p3">
            Projected Earnings per Month
          </div>
          <div class="flex justify-between gap-8 text-right">
            <div class="text-content-primary text-p3 flex items-center gap-4">
              <SvgIcon
                v-if="opportunityInfo?.apr"
                name="sparks"
                class="!w-18 !h-18 text-accent-600"
              />
              ${{ projectedEarningsPerMonth }}
            </div>
          </div>
        </div>
        <div
          class="flex flex-wrap items-center gap-8"
          @click.stop
        >
          <UiButton
            :to="`/lend/${vault.address}/`"
            rounded
          >
            Supply
          </UiButton>
          <UiButton
            variant="primary-stroke"
            :to="{ path: `/lend/${vault.address}/withdraw`, query: { subAccount: position.subAccount } }"
            rounded
          >
            Withdraw
          </UiButton>
          <UiButton
            variant="primary-stroke"
            :to="{ path: `/lend/${vault.address}/swap`, query: { subAccount: position.subAccount } }"
            rounded
          >
            Asset swap
          </UiButton>
        </div>
      </div>
    </div>
  </div>
</template>
