<script setup lang="ts">
import { getVaultPrice, getVaultPriceDisplay, type Vault } from '~/entities/vault'
import { getAssetLogoUrl } from '~/composables/useTokens'
import type { AccountDepositPosition } from '~/entities/account'
import { VaultOverviewModal } from '#components'
import { useModal } from '~/components/ui/composables/useModal'

const { position } = defineProps<{ position: AccountDepositPosition }>()
const modal = useModal()

const { getOpportunityOfLendVault } = useMerkl()
const { withIntrinsicSupplyApy } = useIntrinsicApy()

const vault = computed(() => position.vault)

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
const displayName = computed(() => product.name || vault.value.name)

const supplyValueDisplay = computed(() => {
  if (!regularVault.value)
    return `${formatNumber(nanoToValue(position.assets, vault.value.asset.decimals))} ${vault.value.asset.symbol}`
  const price = getVaultPriceDisplay(position.assets, regularVault.value)
  return price.hasPrice ? `$${compactNumber(price.usdValue)}` : price.display
})

const hasPrice = computed(() => {
  if (!regularVault.value) return false
  return getVaultPrice(position.assets, regularVault.value) > 0
})

const projectedEarningsPerMonth = computed(() => {
  if (!regularVault.value) return '—'
  const price = getVaultPrice(position.assets, regularVault.value)
  if (price === 0) return '—'
  // Monthly earnings = (value * APY%) / 12
  return compactNumber((price * supplyApyWithRewards.value) / 12 / 100)
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
    class="block no-underline text-white bg-euler-dark-500 rounded-16 cursor-pointer"
    @click="onClick"
  >
    <div class="flex py-16 px-16 pb-12 border-b border-border-primary">
      <div class="flex w-full">
        <BaseAvatar
          class="icon--40"
          :src="getAssetLogoUrl(vault.asset.symbol)"
          :label="vault.asset.symbol"
        />
        <div class="flex-grow ml-12">
          <div class="text-euler-dark-900 text-p3 mb-4">
            {{ displayName }}
          </div>
          <div class="text-h5">
            {{ vault.asset.symbol }}
          </div>
        </div>
        <div class="flex flex-col items-end">
          <div class="text-euler-dark-900 text-p3 mb-4">
            Supply APY
          </div>
          <div class="text-p2 flex text-aquamarine-700">
            <SvgIcon
              v-if="opportunityInfo?.apr"
              name="sparks"
              class="!w-20 !h-20 text-aquamarine-700 mr-4"
            />
            {{ formatNumber(supplyApyWithRewards) }}%
          </div>
        </div>
      </div>
    </div>
    <div class="flex py-12 px-16 pb-16">
      <div class="flex flex-col gap-12 w-full">
        <div class="flex justify-between">
          <div class="text-euler-dark-900 text-p3">
            Supply value
          </div>
          <div class="flex justify-between gap-8 text-right">
            <div class="text-white text-p3">
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
            :to="`/lend/${vault.address}/withdraw`"
            rounded
          >
            Withdraw
          </UiButton>
          <UiButton
            variant="primary-stroke"
            :to="`/lend/${vault.address}/swap`"
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
    class="block no-underline text-white bg-euler-dark-500 rounded-16 cursor-pointer"
    @click="onClick"
  >
    <div class="flex py-16 px-16 pb-12 border-b border-border-primary">
      <div class="flex w-full">
        <BaseAvatar
          class="icon--40"
          :src="getAssetLogoUrl(vault.asset.symbol)"
          :label="vault.asset.symbol"
        />
        <div class="flex-grow ml-12">
          <div class="text-euler-dark-900 text-p3 mb-4">
            {{ displayName }}
          </div>
          <div class="text-h5">
            {{ vault.asset.symbol }}
          </div>
        </div>
        <div class="flex flex-col items-end">
          <div class="text-euler-dark-900 text-p3 mb-4">
            Supply APY
          </div>
          <div class="text-p2 flex text-aquamarine-700">
            <SvgIcon
              v-if="opportunityInfo?.apr"
              name="sparks"
              class="!w-20 !h-20 text-aquamarine-700 mr-4"
            />
            {{ formatNumber(supplyApyWithRewards) }}%
          </div>
        </div>
      </div>
    </div>
    <div class="flex py-12 px-16 pb-16">
      <div class="flex flex-col gap-12 w-full">
        <div class="flex justify-between">
          <div class="text-euler-dark-900 text-p3">
            Supply value
          </div>
          <div class="flex justify-between gap-8 text-right">
            <div class="text-white text-p3">
              {{ supplyValueDisplay }}
            </div>
            <div
              v-if="regularVault"
              class="text-euler-dark-900 text-p3"
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
          <div class="text-euler-dark-900 text-p3">
            Projected Earnings per Month
          </div>
          <div class="flex justify-between gap-8 text-right">
            <div class="text-white text-p3 flex items-center gap-4">
              <SvgIcon
                v-if="opportunityInfo?.apr"
                name="sparks"
                class="!w-18 !h-18 text-aquamarine-700"
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
            :to="`/lend/${vault.address}/withdraw`"
            rounded
          >
            Withdraw
          </UiButton>
          <UiButton
            variant="primary-stroke"
            :to="`/lend/${vault.address}/swap`"
            rounded
          >
            Asset swap
          </UiButton>
        </div>
      </div>
    </div>
  </div>
</template>
