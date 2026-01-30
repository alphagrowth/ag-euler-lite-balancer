<script setup lang="ts">
import { getVaultPrice, getVaultPriceDisplay } from '~/entities/vault'
import { getAssetLogoUrl } from '~/composables/useTokens'
import type { AccountDepositPosition } from '~/entities/account'
import { VaultOverviewModal } from '#components'
import { useModal } from '~/components/ui/composables/useModal'

const { position } = defineProps<{ position: AccountDepositPosition }>()
const modal = useModal()

const { getOpportunityOfLendVault } = useMerkl()
const { withIntrinsicSupplyApy } = useIntrinsicApy()

const vault = computed(() => position.vault)
const opportunityInfo = computed(() => getOpportunityOfLendVault(vault.value.address))
const supplyApy = computed(() => withIntrinsicSupplyApy(
  nanoToValue(vault.value.interestRateInfo.supplyAPY, 25),
  vault.value.asset.symbol,
))
const supplyApyWithRewards = computed(() => supplyApy.value + (opportunityInfo.value?.apr || 0))

const product = useEulerProductOfVault(computed(() => vault.value.address))
const vaultLabel = useEulerVaultLabelOfVault(computed(() => vault.value.address))
const displayName = computed(() => vaultLabel.name || product.name || vault.value.name)

const supplyValueDisplay = computed(() => {
  const price = getVaultPriceDisplay(position.assets, vault.value)
  return price.hasPrice ? `$${compactNumber(price.usdValue)}` : price.display
})

const earnDisplay = computed(() => {
  const price = getVaultPrice(position.assets, vault.value)
  if (price === 0) return '—'
  return compactNumber(price * supplyApy.value * 90 / 365 / 100)
})
const earnDisplayWithReward = computed(() => {
  const price = getVaultPrice(position.assets, vault.value)
  if (price === 0) return '—'
  return compactNumber(price * supplyApyWithRewards.value * 90 / 365 / 100)
})

const onClick = () => {
  modal.open(VaultOverviewModal, {
    props: {
      vault: vault,
    },
  })
}
</script>

<template>
  <div
    class="block no-underline bg-surface rounded-xl border border-line-subtle shadow-card cursor-pointer transition-all duration-default ease-default hover:shadow-card-hover hover:border-line-emphasis"
    @click="onClick"
  >
    <div class="flex py-16 px-16 pb-12 border-b border-line-default">
      <div
        class="flex w-full"
      >
        <BaseAvatar
          class="icon--40"
          :src="getAssetLogoUrl(vault.asset.symbol)"
          :label="vault.asset.symbol"
        />
        <div class="flex-grow ml-12">
          <div class="text-content-tertiary text-p3 mb-4">
            {{ displayName }}
          </div>
          <div class="text-h5 text-content-primary">
            {{ vault.asset.symbol }}
          </div>
        </div>
        <div class="flex flex-col items-end">
          <div class="text-content-tertiary text-p3 mb-4">
            Supply APY
          </div>
          <div
            class="text-p2 flex text-accent-600"
          >
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
      <div
        class="flex flex-col gap-12 w-full"
      >
        <div class="flex justify-between">
          <div class="text-content-tertiary text-p3">
            Supply value
          </div>
          <div class="flex justify-between gap-8 text-right">
            <div class="text-content-primary text-p3">
              {{ supplyValueDisplay }}
            </div>
            <div class="text-content-tertiary text-p3">
              ~ {{ roundAndCompactTokens(position.assets, vault.decimals) }} {{ vault.asset.symbol }}
            </div>
          </div>
        </div>
        <div class="flex justify-between">
          <div class="text-content-tertiary text-p3">
            Earn in 90 days
          </div>
          <div class="flex justify-between gap-8 text-right">
            <div class="text-content-primary text-p3">
              ${{ earnDisplay }}
            </div>
            <div
              v-if="opportunityInfo?.apr"
              class="text-content-primary text-p3 flex gap-2 items-center"
            >
              + <SvgIcon
                name="sparks"
                class="!w-18 !h-18 text-accent-600"
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
