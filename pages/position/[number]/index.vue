<script setup lang="ts">
import { useAccount } from '@wagmi/vue'
import { getNetAPY, getVaultPrice } from '~/entities/vault'
import type { AccountBorrowPosition } from '~/entities/account'
import { getRelativeTimeBetweenDates } from '~/utils/time-utils'
import { VaultOverviewModal, OperationReviewModal } from '#components'
import { useModal } from '~/components/ui/composables/useModal'
import { useToast } from '~/components/ui/composables/useToast'

const route = useRoute()
const router = useRouter()
const modal = useModal()
const { error } = useToast()
const { isConnected } = useAccount()
const { isPositionsLoaded, isPositionsLoading, borrowPositions, updateBorrowPositions } = useEulerAccount()
const { getOpportunityOfBorrowVault, getOpportunityOfLendVault } = useMerkl()
const { disableCollateral: disableCollateralOperation } = useEulerOperations()

const positionIndex = route.params.number as string

const position: Ref<AccountBorrowPosition | undefined> = ref()
const isSubmitting = ref(false)

const borrowVault = computed(() => position.value!.borrow)
const collateralVault = computed(() => position.value!.collateral)
const pairAssets = computed(() => [collateralVault.value.asset, borrowVault.value.asset])
const hasNoBorrow = computed(() => position.value!.borrow.borrow === 0n)

const opportunityInfoForBorrow = computed(() => getOpportunityOfBorrowVault(borrowVault.value.asset.address || ''))
const opportunityInfoForCollateral = computed(() => getOpportunityOfLendVault(collateralVault.value.address || ''))

const netAssetValueUsd = computed(() => {
  if (!position.value) {
    return '-'
  }

  return getVaultPrice(position.value.supplied, position.value.collateral) - getVaultPrice(position.value.borrowed, borrowVault.value)
})
const liquidationPrice = computed(() => {
  if (nanoToValue(position.value?.health || 0n, 18) < 0.1) {
    return Infinity
  }
  return nanoToValue(position.value?.price || 0n, 18) / nanoToValue(position.value?.health || 1n, 18)
})
const timeToLiquidationDisplay = computed(() => {
  if (!position.value) {
    return '-'
  }
  if (position.value.timeToLiquidation >= 4000000000000n) {
    return '∞'
  }

  try {
    const nowDate = new Date()
    const currentDate = new Date(Number(position?.value?.timeToLiquidation))
    if (currentDate > nowDate) {
      return 'Expired'
    }

    return getRelativeTimeBetweenDates(nowDate, currentDate)
  }
  catch {
    return '∞'
  }
})
const netAPY = computed(() => {
  return getNetAPY(
    getVaultPrice(position.value?.supplied || 0n, collateralVault.value!),
    nanoToValue(collateralVault.value?.interestRateInfo.supplyAPY || 0n, 25),
    getVaultPrice(position.value?.borrowed || 0n || 0, borrowVault.value!),
    nanoToValue(borrowVault.value?.interestRateInfo.borrowAPY || 0n, 25),
    opportunityInfoForCollateral.value?.apr || null,
    opportunityInfoForBorrow.value?.apr || null,
  )
})

const disableCollateral = async () => {
  modal.open(OperationReviewModal, {
    props: {
      type: 'disableCollateral',
      asset: position.value!.borrow.asset,
      amount: '0',
      onConfirm: () => {
        setTimeout(() => {
          send()
        }, 400)
      },
    },
  })
}
const send = async () => {
  try {
    isSubmitting.value = true
    await disableCollateralOperation(
      position.value!.subAccount,
      position.value!.collateral.address,
      position.value!.collateral.asset.address,
      0n,
      position.value!.borrow.address,
      position.value!.borrow.asset.address,
    )

    modal.close()
    updateBorrowPositions()
    setTimeout(() => {
      router.replace('/portfolio')
    }, 400)
  }
  catch (e) {
    error('Transaction failed')
    console.warn(e)
  }
  finally {
    isSubmitting.value = false
  }
}
const load = async () => {
  try {
    await until(isPositionsLoaded).toBe(true)
    position.value = borrowPositions.value[+positionIndex - 1]
  }
  catch (e) {
    showError('Unable to load Position')
    console.warn(e)
  }
}
const openInfoModal = () => {
  modal.open(VaultOverviewModal, {
    props: {
      pair: position.value,
    },
  })
}
watch(isConnected, () => {
  load()
}, { immediate: true })
</script>

<template>
  <section
    :class="$style.PortfolioVaultPage"
    class="column gap-16"
  >
    <template v-if="isPositionsLoading">
      <div :class="$style.loader">
        <UiLoader class="text-euler-dark-900" />
      </div>
    </template>
    <template v-else-if="position">
      <VaultLabelsAndAssets
        :vault="position.collateral"
        :assets="pairAssets"
      />

      <div
        v-if="!hasNoBorrow"
        class="column gap-16 p-16 br-16"
        :class="$style.assetsInfo"
      >
        <div class="between align-center">
          <div
            class="p2 text-euler-dark-900"
          >
            Net APY
          </div>
          <div
            class="h5 text-white"
          >
            {{ formatNumber(netAPY) }}%
          </div>
        </div>
        <div class="between align-center">
          <div
            class="p2 text-euler-dark-900"
          >
            Net asset value
          </div>
          <div
            class="h5 text-white"
          >
            ${{ formatNumber(netAssetValueUsd) }}
          </div>
        </div>
      </div>
      <div
        v-if="!hasNoBorrow"
        class="br-16 bg-euler-dark-500 p-16"
      >
        <div class="h4 flex align-center flex-wrap gap-12 mb-16">
          Position risk

          <div
            :class="$style.position"
            class="h6 text-euler-dark-900 bg-euler-dark-600 py-4 px-12 br-8"
          >
            Position {{ positionIndex }}
          </div>
        </div>
        <div class="between gap-8 flex-wrap mb-16">
          <div class="text-euler-dark-900 p3">
            Health score
          </div>
          <div class="text-white p3">
            {{ formatNumber(nanoToValue(position.health, 18)) }}
          </div>
        </div>
        <div class="between gap-8 flex-wrap mb-16">
          <div class="text-euler-dark-900 p3">
            Time to liquidation
          </div>
          <div class="text-white p3">
            {{ timeToLiquidationDisplay }}
          </div>
        </div>
        <div class="between gap-8 flex-wrap mb-12">
          <div class="text-euler-dark-900 p3">
            Your LTV
          </div>
          <div class="text-white p3">
            {{ formatNumber(nanoToValue(position.userLTV, 18), 2) }}/{{ nanoToValue(position.liquidationLTV, 2) }}%
          </div>
        </div>
        <UiProgress
          :model-value="nanoToValue(position.userLTV, 18)"
          :max="nanoToValue(position.liquidationLTV, 2)"
          :color="nanoToValue(position.userLTV, 18) >= (nanoToValue(position.liquidationLTV, 2) - 2) ? 'danger' : undefined"
          size="small"
        />
      </div>
      <div v-if="!hasNoBorrow">
        <div class="mb-12 h4">
          Borrow
        </div>
        <div class="br-16 bg-euler-dark-500">
          <div
            :class="$style.top"
            class="flex gap-16"
          >
            <VaultLabelsAndAssets
              :vault="position.borrow"
              :assets="[position.borrow.asset]"
            />
          </div>
          <div class="pt-12 px-16 pb-16">
            <div class="between gap-8 flex-wrap mb-16">
              <div class="text-euler-dark-900 p3">
                Market value
              </div>
              <div class="between gap-8 right">
                <div class="text-white p3">
                  ${{ formatNumber(getVaultPrice(position.borrowed, borrowVault)) }}
                </div>
                <div class="text-euler-dark-900 p3">
                  ~ {{ formatNumber(nanoToValue(position.borrowed, borrowVault.decimals)) }} {{ borrowVault.asset.symbol }}
                </div>
              </div>
            </div>
            <div class="between gap-8 flex-wrap mb-16">
              <div class="text-euler-dark-900 p3">
                Borrow APY
              </div>
              <div class="text-white p3">
                {{ formatNumber(nanoToValue(position.borrow.interestRateInfo.borrowAPY, 25) - (opportunityInfoForBorrow?.apr || 0)) }}%
              </div>
            </div>
            <div class="between gap-8 flex-wrap mb-12">
              <div class="text-euler-dark-900 p3">
                Current price
              </div>
              <div class="text-white p3">
                ${{ formatNumber(getVaultPrice(1, position.borrow)) }}
              </div>
            </div>
            <div class="between gap-8">
              <UiButton
                size="medium"
                variant="primary"
                rounded
                :to="`/position/${positionIndex}/borrow`"
              >
                Borrow
              </UiButton>
              <UiButton
                size="medium"
                variant="primary-stroke"
                rounded
                :to="`/position/${positionIndex}/repay`"
              >
                Repay
              </UiButton>
            </div>
          </div>
        </div>
      </div>
      <div>
        <div class="mb-12 h4">
          {{ !hasNoBorrow ? 'Collateral' : 'Deposit' }}
        </div>
        <div class="br-16 bg-euler-dark-500">
          <div
            :class="$style.top"
            class="flex gap-16"
          >
            <VaultLabelsAndAssets
              :vault="position.collateral"
              :assets="[position.collateral.asset]"
            />
          </div>
          <div class="pt-12 px-16 pb-16">
            <div class="between gap-8 flex-wrap mb-16">
              <div class="text-euler-dark-900 p3">
                {{ !hasNoBorrow ? 'Market value' : 'Supply value' }}
              </div>
              <div class="between gap-8 right">
                <div class="text-white p3">
                  ${{ formatNumber(getVaultPrice(
                    nanoToValue(position.supplied, position.collateral.decimals), position.collateral,
                  )) }}
                </div>
                <div class="text-euler-dark-900 p3">
                  ~ {{ formatNumber(nanoToValue(position.supplied, position.collateral.decimals)) }}
                  {{ position.collateral.asset.symbol }}
                </div>
              </div>
            </div>
            <div class="between gap-8 flex-wrap mb-16">
              <div class="text-euler-dark-900 p3">
                Supply APY
              </div>
              <div class="text-white p3">
                {{ formatNumber(nanoToValue(position.collateral.interestRateInfo.supplyAPY, 25) + (opportunityInfoForCollateral?.apr || 0)) }}%
              </div>
            </div>
            <div class="between gap-8 flex-wrap mb-16">
              <div class="text-euler-dark-900 p3">
                Current price
              </div>
              <div class="text-white p3">
                ${{ formatNumber(getVaultPrice(1, position.collateral)) }}
              </div>
            </div>
            <div
              v-if="!hasNoBorrow"
              class="between gap-8 flex-wrap mb-16"
            >
              <div class="text-euler-dark-900 p3">
                Liquidation price
              </div>
              <div class="text-white p3">
                ${{ liquidationPrice ? formatNumber(getVaultPrice(liquidationPrice, position.collateral)) : '-' }}
              </div>
            </div>
            <div
              v-if="!hasNoBorrow"
              class="between gap-8 flex-wrap mb-16"
            >
              <div class="text-euler-dark-900 p3">
                LLTV
              </div>
              <div class="text-white p3">
                {{ formatNumber(nanoToValue(position.liquidationLTV, 2)) }}%
              </div>
            </div>
            <div
              v-if="!hasNoBorrow"
              class="flex gap-8"
            >
              <UiButton
                size="medium"
                variant="primary"
                rounded
                :to="`/position/${positionIndex}/supply`"
              >
                Supply
              </UiButton>
              <UiButton
                size="medium"
                variant="primary-stroke"
                rounded
                :to="`/position/${positionIndex}/withdraw`"
              >
                Withdraw
              </UiButton>
            </div>
            <div v-else>
              <UiButton
                size="medium"
                variant="primary"
                rounded
                :loading="isSubmitting"
                @click="disableCollateral"
              >
                Disable collateral
              </UiButton>
            </div>
          </div>
        </div>
      </div>

      <div class="mt-auto column gap-8">
        <UiButton
          size="large"
          variant="primary-stroke"
          @click="openInfoModal"
        >
          Pair information
        </UiButton>
      </div>
    </template>
    <template v-else-if="!isConnected">
      Connect your wallet to see your positions
    </template>
    <template v-else>
      Position not found
    </template>
  </section>
</template>

<style module lang="scss">
.PortfolioVaultPage {
  min-height: calc(100dvh - 178px);
}

.loader {
  height: calc(100dvh - 178px);
  display: flex;
  align-items: center;
  justify-content: center;
}

.assetsInfo {
  border: 1px solid var(--c-euler-dark-600);
}

.position {
  border: 1px solid var(--c-euler-dark-700);
}

.top {
  padding: 16px 16px 12px;
  border-bottom: 1px solid #1B3C5F;
}
</style>
