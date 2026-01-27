<script setup lang="ts">
import { useAccount } from '@wagmi/vue'
import { ethers } from 'ethers'
import { eulerAccountLensABI } from '~/entities/euler/abis'
import { getNetAPY, getVaultPrice, type Vault } from '~/entities/vault'
import type { AccountBorrowPosition } from '~/entities/account'
import type { TxPlan } from '~/entities/txPlan'
import { formatTtl } from '~/utils/crypto-utils'
import { VaultOverviewModal, OperationReviewModal, VaultNetApyModal } from '#components'
import { useModal } from '~/components/ui/composables/useModal'
import { useToast } from '~/components/ui/composables/useToast'

const route = useRoute()
const router = useRouter()
const modal = useModal()
const { error } = useToast()
const { isConnected } = useAccount()
const { isPositionsLoaded, isPositionsLoading, borrowPositions } = useEulerAccount()
const { getOpportunityOfBorrowVault, getOpportunityOfLendVault } = useMerkl()
const { withIntrinsicBorrowApy, withIntrinsicSupplyApy, getIntrinsicApy } = useIntrinsicApy()
const { disableCollateral: disableCollateralOperation, buildDisableCollateralPlan } = useEulerOperations()
const {
  runSimulation: runDisableCollateralSimulation,
  simulationError: disableCollateralSimulationError,
  clearSimulationError: clearDisableCollateralSimulationError,
} = useTxPlanSimulation()

const positionIndex = route.params.number as string

type PositionCollateral = {
  vault: Vault
  assets: bigint
}

const position: Ref<AccountBorrowPosition | undefined> = ref()
const isSubmitting = ref(false)
const collateralItems = ref<PositionCollateral[]>([])
const isCollateralsLoading = ref(false)
const disableCollateralErrorVault = ref<string | null>(null)

const { map, getVault, isReady: isVaultsReady } = useVaults()
const { eulerLensAddresses, isReady: isEulerAddressesReady, loadEulerConfig } = useEulerAddresses()
const { EVM_PROVIDER_URL } = useEulerConfig()

const borrowVault = computed(() => position.value!.borrow)
const collateralVault = computed(() => position.value!.collateral)
const primaryCollateralAddress = computed(() => position.value ? ethers.getAddress(position.value.collateral.address) : '')
const collateralCount = computed(() => position.value?.collaterals?.length ?? collateralItems.value.length)
const collateralSymbolLabel = computed(() => {
  if (!position.value) {
    return ''
  }
  const symbol = position.value.collateral.asset.symbol
  return collateralCount.value > 1 ? `${symbol} & others` : symbol
})
const pairAssetsLabel = computed(() => {
  if (!position.value) {
    return ''
  }
  return `${collateralSymbolLabel.value}/${position.value.borrow.asset.symbol}`
})
const pairAssets = computed(() => {
  if (!position.value) return []
  return [collateralVault.value.asset, borrowVault.value.asset]
})
const hasNoBorrow = computed(() => position.value!.borrow.borrow === 0n)

const opportunityInfoForBorrow = computed(() => getOpportunityOfBorrowVault(borrowVault.value.asset.address || ''))
const opportunityInfoForCollateral = computed(() => getOpportunityOfLendVault(collateralVault.value.address || ''))
const baseSupplyAPY = computed(() => nanoToValue(collateralVault.value?.interestRateInfo.supplyAPY || 0n, 25))
const baseBorrowAPY = computed(() => nanoToValue(borrowVault.value?.interestRateInfo.borrowAPY || 0n, 25))
const intrinsicSupplyAPY = computed(() => getIntrinsicApy(collateralVault.value?.asset.symbol))
const intrinsicBorrowAPY = computed(() => getIntrinsicApy(borrowVault.value?.asset.symbol))
const collateralSupplyApy = computed(() => withIntrinsicSupplyApy(
  baseSupplyAPY.value,
  collateralVault.value?.asset.symbol,
))
const borrowApy = computed(() => withIntrinsicBorrowApy(
  baseBorrowAPY.value,
  borrowVault.value?.asset.symbol,
))
const borrowApyWithRewards = computed(() => borrowApy.value - (opportunityInfoForBorrow.value?.apr || 0))

const collateralRows = computed(() => {
  return collateralItems.value.map((item) => {
    const opportunity = getOpportunityOfLendVault(item.vault.address || '')
    const supplyApy = withIntrinsicSupplyApy(
      nanoToValue(item.vault.interestRateInfo.supplyAPY || 0n, 25),
      item.vault.asset.symbol,
    )
    return {
      ...item,
      supplyApy,
      supplyApyWithRewards: supplyApy + (opportunity?.apr || 0),
    }
  })
})

const collateralValueUsd = computed(() => {
  if (!position.value) {
    return 0
  }

  if (!collateralItems.value.length) {
    return getVaultPrice(position.value.supplied, position.value.collateral)
  }

  return collateralItems.value.reduce((total, item) => total + getVaultPrice(item.assets, item.vault), 0)
})

const netAssetValueUsd = computed(() => {
  if (!position.value) {
    return 0
  }

  return collateralValueUsd.value - getVaultPrice(position.value.borrowed, borrowVault.value)
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
    collateralSupplyApy.value,
    getVaultPrice(position.value?.borrowed || 0n || 0, borrowVault.value!),
    borrowApy.value,
    opportunityInfoForCollateral.value?.apr || null,
    opportunityInfoForBorrow.value?.apr || null,
  )
})

const isPrimaryCollateral = (vault: Vault) => {
  if (!primaryCollateralAddress.value) {
    return false
  }

  return ethers.getAddress(vault.address) === primaryCollateralAddress.value
}

const isDisableCollateralError = (vault: Vault) => {
  if (!disableCollateralErrorVault.value) {
    return false
  }
  try {
    return ethers.getAddress(vault.address) === disableCollateralErrorVault.value
  }
  catch {
    return false
  }
}

const loadCollaterals = async () => {
  if (!position.value) {
    collateralItems.value = []
    return
  }

  const collateralAddresses = position.value.collaterals?.length
    ? position.value.collaterals
    : [position.value.collateral.address]

  const normalized = collateralAddresses.reduce<string[]>((acc, address) => {
    try {
      acc.push(ethers.getAddress(address))
    }
    catch {
      return acc
    }
    return acc
  }, [])

  const primaryAddress = ethers.getAddress(position.value.collateral.address)
  const unique = Array.from(new Set(normalized))
  const orderedAddresses = [primaryAddress, ...unique.filter(address => address !== primaryAddress)]

  isCollateralsLoading.value = true

  try {
    if (!isEulerAddressesReady.value) {
      await loadEulerConfig()
    }

    await until(isVaultsReady).toBe(true)

    const lensAddress = eulerLensAddresses.value?.accountLens
    if (!lensAddress) {
      throw new Error('Account lens address is not available')
    }

    const provider = ethers.getDefaultProvider(EVM_PROVIDER_URL)
    const accountLensContract = new ethers.Contract(lensAddress, eulerAccountLensABI, provider)

    const items = await Promise.all(
      orderedAddresses.map(async (address) => {
        try {
          const vault = map.value.get(address) || await getVault(address)
          let assets = 0n

          try {
            const res = await accountLensContract.getAccountInfo(position.value!.subAccount, address)
            assets = res.vaultAccountInfo.assets
          }
          catch {
            if (address === primaryAddress) {
              assets = position.value!.supplied
            }
          }

          return { vault, assets }
        }
        catch (e) {
          console.warn('[Position] failed to load collateral vault', address, e)
          return null
        }
      }),
    )

    collateralItems.value = items.filter((item): item is PositionCollateral => !!item)
  }
  catch (e) {
    console.warn('[Position] failed to load collaterals', e)
  }
  finally {
    isCollateralsLoading.value = false
  }
}

const disableCollateral = async (vault: Vault) => {
  clearDisableCollateralSimulationError()
  disableCollateralErrorVault.value = null
  let plan: TxPlan | null = null
  try {
    plan = await buildDisableCollateralPlan(
      position.value!.subAccount,
      vault.address,
    )
  }
  catch (e) {
    console.warn('[OperationReviewModal] failed to build plan', e)
  }

  if (plan) {
    const ok = await runDisableCollateralSimulation(plan)
    if (!ok) {
      disableCollateralErrorVault.value = ethers.getAddress(vault.address)
      return
    }
  }

  modal.open(OperationReviewModal, {
    props: {
      type: 'disableCollateral',
      asset: position.value!.borrow.asset,
      amount: '0',
      plan: plan || undefined,
      subAccount: position.value?.subAccount,
      hasBorrows: (position.value?.borrowed || 0n) > 0n,
      onConfirm: () => {
        setTimeout(() => {
          send(vault.address)
        }, 400)
      },
    },
  })
}
const send = async (collateralAddress: string) => {
  try {
    isSubmitting.value = true
    // Note: disableCollateral operation doesn't support operator parameter
    await disableCollateralOperation(
      position.value!.subAccount,
      collateralAddress,
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
    if (position.value) {
      collateralItems.value = [{
        vault: position.value.collateral,
        assets: position.value.supplied,
      }]
      await loadCollaterals()
    }
    else {
      collateralItems.value = []
    }
  }
  catch (e) {
    showError('Unable to load Position')
    console.warn(e)
  }
}
const openCollateralInfoModal = (vault: Vault) => {
  modal.open(VaultOverviewModal, {
    props: {
      vault,
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
const onNetApyInfoIconClick = () => {
  if (!position.value) return

  const supplyUSD = getVaultPrice(position.value.supplied || 0n, collateralVault.value!)
  const borrowUSD = getVaultPrice(position.value.borrowed || 0n, borrowVault.value!)

  modal.open(VaultNetApyModal, {
    props: {
      supplyUSD,
      borrowUSD,
      baseSupplyAPY: baseSupplyAPY.value,
      baseBorrowAPY: baseBorrowAPY.value,
      intrinsicSupplyAPY: intrinsicSupplyAPY.value,
      intrinsicBorrowAPY: intrinsicBorrowAPY.value,
      supplyRewardAPY: opportunityInfoForCollateral.value?.apr || null,
      borrowRewardAPY: opportunityInfoForBorrow.value?.apr || null,
      netAPY: netAPY.value,
      supplyOpportunityInfo: opportunityInfoForCollateral.value,
      borrowOpportunityInfo: opportunityInfoForBorrow.value,
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
        :assets-label="pairAssetsLabel"
      />

      <div
        v-if="!hasNoBorrow"
        class="flex flex-col gap-16 p-16 rounded-16 border border-euler-dark-600"
      >
        <div class="flex justify-between items-center">
          <div class="text-p2 text-euler-dark-900">
            Net APY
          </div>
          <div class="text-h5 text-white flex justify-end items-center gap-4">
            {{ formatNumber(netAPY) }}%
            <SvgIcon
              class="!w-24 !h-24 text-euler-dark-800 cursor-pointer"
              name="question-circle"
              @click="onNetApyInfoIconClick"
            />
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
                {{ formatNumber(borrowApyWithRewards) }}%
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
                :to="`/position/${positionIndex}/multiply`"
              >
                Multiply
              </UiButton>
              <UiButton
                size="medium"
                variant="primary-stroke"
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
              <UiButton
                size="medium"
                variant="primary-stroke"
                rounded
                :to="`/position/${positionIndex}/borrow/swap`"
              >
                Debt swap
              </UiButton>
            </div>
          </div>
        </div>
      </div>
      <div>
        <div class="mb-12 text-h4">
          {{ !hasNoBorrow ? 'Collateral' : 'Deposit' }}
        </div>
        <div class="flex flex-col gap-12">
          <div
            v-for="collateral in collateralRows"
            :key="collateral.vault.address"
            class="rounded-16 bg-euler-dark-500 cursor-pointer"
            @click="openCollateralInfoModal(collateral.vault)"
          >
            <div class="flex gap-16 p-16 pb-12 border-b border-border-primary">
              <VaultLabelsAndAssets
                :vault="collateral.vault"
                :assets="[collateral.vault.asset]"
              />
            </div>
            <div class="pt-12 px-16 pb-16">
              <div class="flex justify-between gap-8 flex-wrap mb-16">
                <div class="text-euler-dark-900 text-p3">
                  {{ !hasNoBorrow ? 'Market value' : 'Supply value' }}
                </div>
                <div class="flex justify-between gap-8 justify-self-end">
                  <div class="text-white text-p3">
                    ${{ formatNumber(getVaultPrice(collateral.assets, collateral.vault)) }}
                  </div>
                  <div class="text-euler-dark-900 text-p3">
                    ~ {{ roundAndCompactTokens(collateral.assets, collateral.vault.decimals) }}
                    {{ collateral.vault.asset.symbol }}
                  </div>
                </div>
              </div>
              <div class="flex justify-between gap-8 flex-wrap mb-16">
                <div class="text-euler-dark-900 text-p3">
                  Supply APY
                </div>
                <div class="text-white text-p3">
                  {{ formatNumber(collateral.supplyApyWithRewards) }}%
                </div>
              </div>
              <div class="flex justify-between gap-8 flex-wrap mb-16">
                <div class="text-euler-dark-900 text-p3">
                  Oracle price
                </div>
                <div class="text-white text-p3">
                  ${{ formatNumber(getVaultPrice(1, collateral.vault)) }}
                </div>
              </div>
              <div
                v-if="!hasNoBorrow && isPrimaryCollateral(collateral.vault)"
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
                v-if="!hasNoBorrow && isPrimaryCollateral(collateral.vault)"
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
                  :to="`/position/${positionIndex}/supply?collateral=${collateral.vault.address}`"
                >
                  Supply
                </UiButton>
                <UiButton
                  size="medium"
                  variant="primary-stroke"
                  rounded
                  :to="`/position/${positionIndex}/withdraw?collateral=${collateral.vault.address}`"
                >
                  Withdraw
                </UiButton>
                <UiButton
                  size="medium"
                  variant="primary-stroke"
                  rounded
                  :to="`/position/${positionIndex}/collateral/swap?collateral=${collateral.vault.address}`"
                >
                  Collateral swap
                </UiButton>
              </div>
              <div
                v-else
                @click.stop
              >
                <UiButton
                  size="medium"
                  variant="primary"
                  rounded
                  :loading="isSubmitting"
                  @click="disableCollateral(collateral.vault)"
                >
                  Disable collateral
                </UiButton>
                <UiToast
                  v-if="disableCollateralSimulationError && isDisableCollateralError(collateral.vault)"
                  class="mt-12"
                  title="Error"
                  variant="error"
                  :description="disableCollateralSimulationError"
                  size="compact"
                />
              </div>
            </div>
          </div>
          <div
            v-if="!collateralRows.length && isCollateralsLoading"
            class="flex items-center justify-center rounded-16 bg-euler-dark-500 p-16"
          >
            <UiLoader class="text-euler-dark-900" />
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
