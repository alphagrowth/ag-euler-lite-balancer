<script setup lang="ts">
import { getEarnVaultPrice } from '~/entities/vault'
import { getAssetLogoUrl } from '~/composables/useTokens'
import type { AccountEarnPosition } from '~/entities/account'
import { VaultOverviewModal } from '#components'
import { useModal } from '~/components/ui/composables/useModal'

const { position } = defineProps<{ position: AccountEarnPosition }>()
const modal = useModal()

const { getOpportunityOfLendVault } = useMerkl()

const vault = computed(() => position.vault)
const opportunityInfo = computed(() => getOpportunityOfLendVault(vault.value.address))

const { name } = useEulerProductOfVault(vault.value.address)

const earnDisplay = computed(() => {
  return compactNumber(getEarnVaultPrice(position.assets, vault.value) * (vault.value.supplyAPY || 0) * 90 / 365 / 100)
})
const earnDisplayWithReward = computed(() => {
  return compactNumber(getEarnVaultPrice(position.assets, vault.value) * (((vault.value.supplyAPY || 0) + (opportunityInfo.value?.apr || 0))) * 90 / 365 / 100)
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
            {{ name || vault.name }}
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
            {{ formatNumber((vault.supplyAPY || 0) + (opportunityInfo?.apr || 0)) }}%
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
              ${{ compactNumber(getEarnVaultPrice(position.assets, vault)) }}
            </div>
            <div class="text-euler-dark-900 text-p3">
              ~ {{ compactNumber(nanoToValue(position.assets, vault.asset.decimals)) }} {{ vault.asset.symbol }}
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
