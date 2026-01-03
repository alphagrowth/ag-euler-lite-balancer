<script setup lang="ts">
import { useAccount } from '@wagmi/vue'
import { getNetAPY, getVaultPrice } from '~/entities/vault'
import type { AccountBorrowPosition } from '~/entities/account'
import type { TxPlan } from '~/entities/txPlan'
import { formatTtl } from '~/utils/crypto-utils'
import { VaultOverviewModal, OperationReviewModal } from '#components'
import { useModal } from '~/components/ui/composables/useModal'
import { useToast } from '~/components/ui/composables/useToast'

const route = useRoute()
const router = useRouter()
const modal = useModal()
const { error } = useToast()
const { isConnected } = useAccount()
const { isPositionsLoaded, isPositionsLoading, borrowPositions } = useEulerAccount()
const { getOpportunityOfBorrowVault, getOpportunityOfLendVault } = useMerkl()
const { disableCollateral: disableCollateralOperation, buildDisableCollateralPlan } = useEulerOperations()

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
  if (!position.value) return undefined

  const price = position.value.price || 0n

  if (price <= 0n) {
    return undefined
  }

  return nanoToValue(price, 18)
})
const borrowLiquidationPrice = computed(() => {
  if (!position.value) return undefined

  const collateralValueLiquidation = position.value.collateralValueLiquidation
  const liabilityValue = position.value.liabilityValue

  if (liabilityValue === 0n || collateralValueLiquidation === 0n) {
    return undefined
  }

  const multiplier = nanoToValue(collateralValueLiquidation, 18) / nanoToValue(liabilityValue, 18)
  const currentBorrowPrice = getVaultPrice(1, borrowVault.value)

  return currentBorrowPrice * multiplier
})
const timeToLiquidationDisplay = computed(() => {
  if (!position.value) {
    return '-'
  }

  const result = formatTtl(position.value.timeToLiquidation)
  return result?.display || '-'
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
  let plan: TxPlan | null = null
  try {
    plan = await buildDisableCollateralPlan(
      position.value!.subAccount,
      position.value!.collateral.address,
    )
  }
  catch (e) {
    console.warn('[OperationReviewModal] failed to build plan', e)
  }

  modal.open(OperationReviewModal, {
    props: {
      type: 'disableCollateral',
      asset: position.value!.borrow.asset,
      amount: '0',
      plan: plan || undefined,
      subAccount: position.value?.subAccount,
      hasBorrows: (position.value?.borrowed || 0n) > 0n,
      onConfirm: (disableOperator?: boolean, transferAssets?: boolean) => {
        setTimeout(() => {
          send(disableOperator, transferAssets)
        }, 400)
      },
    },
  })
}
const send = async (_disableOperator?: boolean, _transferAssets?: boolean) => {
  try {
    isSubmitting.value = true
    // Note: disableCollateral operation doesn't support operator parameter
    await disableCollateralOperation(
      position.value!.subAccount,
      position.value!.collateral.address,
      position.value!.borrow.address,
    )

    modal.close()
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
const openCollateralInfoModal = () => {
  modal.open(VaultOverviewModal, {
    props: {
      vault: collateralVault.value,
    },
  })
}
const openPairInfoModal = () => {
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
  <section class="flex flex-col gap-16 min-h-[calc(100dvh-178px)]">
    <template v-if="isPositionsLoading">
      <div class="h-[calc(100dvh-178px)] flex items-center justify-center">
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
        class="flex flex-col gap-16 p-16 rounded-16 border border-euler-dark-600"
      >
        <div class="flex justify-between items-center">
          <div class="text-p2 text-euler-dark-900">
            Net APY
          </div>
          <div class="text-h5 text-white">
            {{ formatNumber(netAPY) }}%
          </div>
        </div>
        <div class="flex justify-between items-center">
          <div class="text-p2 text-euler-dark-900">
            Net asset value
          </div>
          <div class="text-h5 text-white">
            ${{ formatNumber(netAssetValueUsd) }}
          </div>
        </div>
      </div>
      <div
        v-if="!hasNoBorrow"
        class="rounded-16 bg-euler-dark-500 p-16"
      >
        <div class="text-h4 flex items-center flex-wrap gap-12 mb-16">
          Position risk

          <div class="text-h6 text-euler-dark-900 bg-euler-dark-600 py-4 px-12 rounded-8 border border-euler-dark-700">
            Position {{ positionIndex }}
          </div>
        </div>
        <div class="flex justify-between gap-8 flex-wrap mb-16">
          <div class="text-euler-dark-900 text-p3">
            Health score
          </div>
          <div class="text-white text-p3">
            {{ formatNumber(nanoToValue(position.health, 18)) }}
          </div>
        </div>
        <div class="flex justify-between gap-8 flex-wrap mb-16">
          <div class="text-euler-dark-900 text-p3">
            Time to liquidation
          </div>
          <div class="text-white text-p3">
            {{ timeToLiquidationDisplay }}
          </div>
        </div>
        <div class="flex justify-between gap-8 flex-wrap mb-12">
          <div class="text-euler-dark-900 text-p3">
            Your LTV
          </div>
          <div class="text-white text-p3">
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
      <div
        v-if="!hasNoBorrow"
        class="cursor-pointer"
        @click="openPairInfoModal"
      >
        <div class="mb-12 text-h4">
          Borrow
        </div>
        <div class="rounded-16 bg-euler-dark-500">
          <div class="flex gap-16 p-16 pb-12 border-b border-border-primary">
            <VaultLabelsAndAssets
              :vault="position.borrow"
              :assets="[position.borrow.asset]"
            />
          </div>
          <div class="pt-12 px-16 pb-16">
            <div class="flex justify-between gap-8 flex-wrap mb-16">
              <div class="text-euler-dark-900 text-p3">
                Market value
              </div>
              <div class="flex justify-between gap-8 justify-self-end">
                <div class="text-white text-p3">
                  ${{ formatNumber(getVaultPrice(position.borrowed, borrowVault)) }}
                </div>
                <div class="text-euler-dark-900 text-p3">
                  ~ {{ roundAndCompactTokens(position.borrowed, borrowVault.decimals) }} {{ borrowVault.asset.symbol }}
                </div>
              </div>
            </div>
            <div class="flex justify-between gap-8 flex-wrap mb-16">
              <div class="text-euler-dark-900 text-p3">
                Borrow APY
              </div>
              <div class="text-white text-p3">
                {{ formatNumber(nanoToValue(position.borrow.interestRateInfo.borrowAPY, 25) - (opportunityInfoForBorrow?.apr || 0)) }}%
              </div>
            </div>
            <div class="flex justify-between gap-8 flex-wrap mb-12">
              <div class="text-euler-dark-900 text-p3">
                Oracle price
              </div>
              <div class="text-white text-p3">
                ${{ formatNumber(getVaultPrice(1, position.borrow)) }}
              </div>
            </div>
            <div class="flex justify-between gap-8 flex-wrap mb-12">
              <div class="text-euler-dark-900 text-p3">
                Liquidation price
              </div>
              <div class="text-white text-p3">
                ${{ borrowLiquidationPrice ? formatNumber(borrowLiquidationPrice) : '-' }}
              </div>
            </div>
            <div
              class="flex justify-between gap-8"
              @click.stop
            >
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
      <div
        class="cursor-pointer"
        @click="openCollateralInfoModal"
      >
        <div class="mb-12 text-h4">
          {{ !hasNoBorrow ? 'Collateral' : 'Deposit' }}
        </div>
        <div class="rounded-16 bg-euler-dark-500">
          <div class="flex gap-16 p-16 pb-12 border-b border-border-primary">
            <VaultLabelsAndAssets
              :vault="position.collateral"
              :assets="[position.collateral.asset]"
            />
          </div>
          <div class="pt-12 px-16 pb-16">
            <div class="flex justify-between gap-8 flex-wrap mb-16">
              <div class="text-euler-dark-900 text-p3">
                {{ !hasNoBorrow ? 'Market value' : 'Supply value' }}
              </div>
              <div class="flex justify-between gap-8 justify-self-end">
                <div class="text-white text-p3">
                  ${{ formatNumber(getVaultPrice(
                    nanoToValue(position.supplied, position.collateral.decimals), position.collateral,
                  )) }}
                </div>
                <div class="text-euler-dark-900 text-p3">
                  ~ {{ roundAndCompactTokens(position.supplied, position.collateral.decimals) }}
                  {{ position.collateral.asset.symbol }}
                </div>
              </div>
            </div>
            <div class="flex justify-between gap-8 flex-wrap mb-16">
              <div class="text-euler-dark-900 text-p3">
                Supply APY
              </div>
              <div class="text-white text-p3">
                {{ formatNumber(nanoToValue(position.collateral.interestRateInfo.supplyAPY, 25) + (opportunityInfoForCollateral?.apr || 0)) }}%
              </div>
            </div>
            <div class="flex justify-between gap-8 flex-wrap mb-16">
              <div class="text-euler-dark-900 text-p3">
                Oracle price
              </div>
              <div class="text-white text-p3">
                ${{ formatNumber(getVaultPrice(1, position.collateral)) }}
              </div>
            </div>
            <div
              v-if="!hasNoBorrow"
              class="flex justify-between gap-8 flex-wrap mb-16"
            >
              <div class="text-euler-dark-900 text-p3">
                Liquidation price
              </div>
              <div class="text-white text-p3">
                ${{ liquidationPrice ? formatNumber(liquidationPrice) : '-' }}
              </div>
            </div>
            <div
              v-if="!hasNoBorrow"
              class="flex justify-between gap-8 flex-wrap mb-16"
            >
              <div class="text-euler-dark-900 text-p3">
                LLTV
              </div>
              <div class="text-white text-p3">
                {{ formatNumber(nanoToValue(position.liquidationLTV, 2)) }}%
              </div>
            </div>
            <div
              v-if="!hasNoBorrow"
              class="flex gap-8"
              @click.stop
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

      <div class="mt-auto flex flex-col gap-8">
        <UiButton
          size="large"
          variant="primary-stroke"
          @click="openPairInfoModal"
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
