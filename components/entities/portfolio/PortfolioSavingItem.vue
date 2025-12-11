<script setup lang="ts">
import { getVaultPrice } from '~/entities/vault'
import { getAssetLogoUrl } from '~/entities/assets'
import type { AccountDepositPosition } from '~/entities/account'
import { VaultOverviewModal } from '#components'
import { useModal } from '~/components/ui/composables/useModal'

const { position } = defineProps<{ position: AccountDepositPosition }>()
const modal = useModal()

const { getOpportunityOfLendVault } = useMerkl()

const vault = computed(() => position.vault)
const opportunityInfo = computed(() => getOpportunityOfLendVault(vault.value.address))

const { name } = useEulerProductOfVault(vault.value.address)

const earnDisplay = computed(() => {
  return compactNumber(getVaultPrice(position.assets, vault.value) * ((nanoToValue(vault.value.interestRateInfo.supplyAPY, 25))) * 90 / 365 / 100)
})
const earnDisplayWithReward = computed(() => {
  return compactNumber(getVaultPrice(position.assets, vault.value) * ((nanoToValue(vault.value.interestRateInfo.supplyAPY, 25) + (opportunityInfo.value?.apr || 0))) * 90 / 365 / 100)
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
    :class="$style.VaultItem"
    class="text-white bg-euler-dark-500 br-16"
    @click="onClick"
  >
    <div :class="$style.top">
      <div
        :class="$style.portfolioWrap"
        class="flex"
      >
        <BaseAvatar
          class="icon--40"
          :src="getAssetLogoUrl(vault.asset.symbol)"
          :label="vault.asset.symbol"
        />
        <div :class="$style.topCenter">
          <div class="text-euler-dark-900 p3 mb-4">
            {{ name || vault.name }}
          </div>
          <div class="h5">
            {{ vault.asset.symbol }}
          </div>
        </div>
        <div :class="$style.topRight">
          <div class="text-euler-dark-900 p3 mb-4">
            Supply APY
          </div>
          <div
            :class="$style.apy"
            class="p2"
          >
            <SvgIcon
              v-if="opportunityInfo?.apr"
              name="sparks"
              class="icon--20 text-aquamarine-700 mr-4"
            />
            {{ formatNumber(nanoToValue(vault.interestRateInfo.supplyAPY, 25) + (opportunityInfo?.apr || 0)) }}%
          </div>
        </div>
      </div>
    </div>
    <div :class="$style.bottom">
      <div
        class="column gap-12"
        :class="$style.portfolioWrap"
      >
        <div class="between">
          <div class="text-euler-dark-900 p3">
            Supply value
          </div>
          <div class="between gap-8 right">
            <div class="text-white p3">
              ${{ compactNumber(getVaultPrice(position.assets, vault)) }}
            </div>
            <div class="text-euler-dark-900 p3">
              ~ {{ compactNumber(nanoToValue(position.assets, vault.asset.decimals)) }} {{ vault.asset.symbol }}
            </div>
          </div>
        </div>
        <div class="between">
          <div class="text-euler-dark-900 p3">
            Earn in 90 days
          </div>
          <div class="between gap-8 right">
            <div class="text-white p3">
              ${{ earnDisplay }}
            </div>
            <div
              v-if="opportunityInfo?.apr"
              class="text-white p3 flex gap-2 align-center"
            >
              + <SvgIcon
                name="sparks"
                class="icon--18 text-aquamarine-700"
              /> ${{ earnDisplayWithReward }}
            </div>
          </div>
        </div>
        <div
          class="between align-center gap-8"
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
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="scss" module>
.VaultItem {
  display: block;
  text-decoration: none;
  cursor: pointer;
}

.top {
  display: flex;
  padding: 16px 16px 12px;
  border-bottom: 1px solid #1B3C5F;
}

.topCenter {
  flex-grow: 1;
  margin-left: 12px;
}

.topRight {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}

.bottom {
  display: flex;
  padding: 12px 16px 16px;
}

.bottomCenter {
  display: flex;
  flex-direction: column;
  align-items: end;
  flex-grow: 1;
}

.bottomRight {
  text-align: right;
}

.apy {
  display: flex;
  color: var(--c-aquamarine-700)
}

.portfolioWrap {
  width: 100%;
}

.position {
  border: 1px solid var(--c-euler-dark-700);
}
</style>
