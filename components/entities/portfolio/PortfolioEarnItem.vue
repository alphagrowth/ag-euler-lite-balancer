<script setup lang="ts">
import { getEarnVaultPrice, getEarnVaultPriceDisplay } from '~/entities/vault'
import { getAssetLogoUrl } from '~/composables/useTokens'
import type { AccountEarnPosition } from '~/entities/account'
import { VaultOverviewModal } from '#components'
import { useModal } from '~/components/ui/composables/useModal'

const { position } = defineProps<{ position: AccountEarnPosition }>()
const modal = useModal()

const { getOpportunityOfLendVault } = useMerkl()

const vault = computed(() => position.vault)
const opportunityInfo = computed(() => getOpportunityOfLendVault(vault.value.address))

const product = useEulerProductOfVault(computed(() => vault.value.address))
const displayName = computed(() => product.name || vault.value.name)

const supplyValueDisplay = computed(() => {
  const price = getEarnVaultPriceDisplay(position.assets, vault.value)
  return price.hasPrice ? `$${compactNumber(price.usdValue)}` : price.display
})

const supplyApyWithRewards = computed(() => (vault.value.supplyAPY || 0) + (opportunityInfo.value?.apr || 0))

const hasPrice = computed(() => getEarnVaultPrice(position.assets, vault.value) > 0)

const projectedEarningsPerMonth = computed(() => {
  const price = getEarnVaultPrice(position.assets, vault.value)
  if (price === 0) return '—'
  // Monthly earnings = (value * APY%) / 12
  return compactNumber((price * supplyApyWithRewards.value) / 12 / 100)
})

const onClick = () => {
  modal.open(VaultOverviewModal, {
    props: {
      earnVault: vault,
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
              ~ {{ roundAndCompactTokens(position.assets, vault.asset.decimals) }} {{ vault.asset.symbol }}
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
          class="flex justify-between items-center gap-8"
          @click.stop
        >
          <UiButton
            :to="`/earn/${vault.address}/`"
            rounded
          >
            Supply
          </UiButton>
          <UiButton
            variant="primary-stroke"
            :to="`/earn/${vault.address}/withdraw`"
            rounded
          >
            Withdraw
          </UiButton>
        </div>
      </div>
    </div>
  </div>
</template>
