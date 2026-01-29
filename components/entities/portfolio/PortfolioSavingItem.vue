<script setup lang="ts">
import type { Vault } from '~/entities/vault'
import { getVaultPrice } from '~/entities/vault'
import { getAssetLogoUrl } from '~/composables/useTokens'
import type { AccountDepositPosition } from '~/entities/account'
import { VaultOverviewModal } from '#components'
import { useModal } from '~/components/ui/composables/useModal'

const { position } = defineProps<{ position: AccountDepositPosition }>()
const modal = useModal()

const { getOpportunityOfLendVault } = useMerkl()
const { withIntrinsicSupplyApy } = useIntrinsicApy()

const vault = computed(() => position.vault)
const isSecuritize = computed(() => position.isSecuritize || false)

// Type guard for regular vault properties
const regularVault = computed(() => isSecuritize.value ? null : vault.value as Vault)

const opportunityInfo = computed(() => getOpportunityOfLendVault(vault.value.address))
const supplyApy = computed(() => {
  if (isSecuritize.value || !regularVault.value) return 0
  return withIntrinsicSupplyApy(
    nanoToValue(regularVault.value.interestRateInfo.supplyAPY, 25),
    vault.value.asset.symbol,
  )
})
const supplyApyWithRewards = computed(() => supplyApy.value + (opportunityInfo.value?.apr || 0))

const product = useEulerProductOfVault(computed(() => vault.value.address))
const displayName = computed(() => product.name || vault.value.name)

const earnDisplay = computed(() => {
  if (isSecuritize.value) return 0
  return compactNumber(getVaultPrice(position.assets, vault.value as Vault) * supplyApy.value * 90 / 365 / 100)
})
const earnDisplayWithReward = computed(() => {
  if (isSecuritize.value) return 0
  return compactNumber(getVaultPrice(position.assets, vault.value as Vault) * supplyApyWithRewards.value * 90 / 365 / 100)
})

// Securitize-specific computed properties
const assetAmount = computed(() => {
  return nanoToValue(position.assets, vault.value.asset.decimals)
})

const onClick = () => {
  if (isSecuritize.value) return // No modal for Securitize vaults
  modal.open(VaultOverviewModal, {
    props: {
      vault: vault,
    },
  })
}
</script>

<template>
  <!-- Securitize vault display -->
  <div
    v-if="isSecuritize"
    class="block no-underline text-white bg-euler-dark-500 rounded-16"
  >
    <div class="flex py-16 px-16 pb-12 border-b border-border-primary">
      <div
        class="flex w-full"
      >
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
            Type
          </div>
          <div class="text-p2 text-aquamarine-700">
            Securitize
          </div>
        </div>
      </div>
    </div>
    <div class="flex py-12 px-16 pb-16">
      <div
        class="flex flex-col gap-12 w-full"
      >
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
        <div class="flex justify-between">
          <div class="text-euler-dark-900 text-p3">
            Shares
          </div>
          <div class="flex justify-between gap-8 text-right">
            <div class="text-white text-p3">
              {{ formatNumber(nanoToValue(position.shares, vault.decimals)) }}
            </div>
          </div>
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
      <div
        class="flex w-full"
      >
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
          <div
            class="text-p2 flex text-aquamarine-700"
          >
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
      <div
        class="flex flex-col gap-12 w-full"
      >
        <div class="flex justify-between">
          <div class="text-euler-dark-900 text-p3">
            Supply value
          </div>
          <div class="flex justify-between gap-8 text-right">
            <div class="text-white text-p3">
              ${{ compactNumber(getVaultPrice(position.assets, regularVault!)) }}
            </div>
            <div class="text-euler-dark-900 text-p3">
              ~ {{ roundAndCompactTokens(position.assets, vault.decimals) }} {{ vault.asset.symbol }}
            </div>
          </div>
        </div>
        <div class="flex justify-between">
          <div class="text-euler-dark-900 text-p3">
            Earn in 90 days
          </div>
          <div class="flex justify-between gap-8 text-right">
            <div class="text-white text-p3">
              ${{ earnDisplay }}
            </div>
            <div
              v-if="opportunityInfo?.apr"
              class="text-white text-p3 flex gap-2 items-center"
            >
              + <SvgIcon
                name="sparks"
                class="!w-18 !h-18 text-aquamarine-700"
              /> ${{ earnDisplayWithReward }}
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
