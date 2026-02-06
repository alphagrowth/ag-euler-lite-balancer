<script setup lang="ts">
import { useAccount } from '@wagmi/vue'
import { ethers } from 'ethers'
import { eulerAccountLensABI } from '~/entities/euler/abis'
import { getNetAPY, getVaultPrice, getVaultOraclePrice, getCollateralAssetPriceFromLiability, type Vault, type SecuritizeVault } from '~/entities/vault'
import type { AccountBorrowPosition } from '~/entities/account'
import type { TxPlan } from '~/entities/txPlan'
import { formatTtl } from '~/utils/crypto-utils'
import { VaultOverviewModal, OperationReviewModal, VaultNetApyModal } from '#components'
import { useModal } from '~/components/ui/composables/useModal'
import { useToast } from '~/components/ui/composables/useToast'
import { useVaultRegistry } from '~/composables/useVaultRegistry'

const route = useRoute()
const router = useRouter()
const modal = useModal()
const { error } = useToast()
const { isConnected } = useAccount()
const { isPositionsLoaded, isPositionsLoading, getPositionBySubAccountIndex } = useEulerAccount()
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
  vault: Vault | SecuritizeVault
  assets: bigint
}

const position: Ref<AccountBorrowPosition | undefined> = ref()
const isSubmitting = ref(false)
const collateralItems = ref<PositionCollateral[]>([])
const isCollateralsLoading = ref(false)
const disableCollateralErrorVault = ref<string | null>(null)

const { isReady: isVaultsReady } = useVaults()
const { getOrFetch } = useVaultRegistry()
const { eulerLensAddresses, isReady: isEulerAddressesReady, loadEulerConfig } = useEulerAddresses()
const { EVM_PROVIDER_URL } = useEulerConfig()

const borrowVault = computed(() => position.value?.borrow)
const collateralVault = computed(() => position.value?.collateral)
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
  return [collateralVault.value!.asset, borrowVault.value!.asset]
})
const hasNoBorrow = computed(() => position.value?.borrow.borrow === 0n)

const opportunityInfoForBorrow = computed(() => getOpportunityOfBorrowVault(borrowVault.value?.asset.address || ''))
const opportunityInfoForCollateral = computed(() => getOpportunityOfLendVault(collateralVault.value?.address || ''))
const baseSupplyAPY = computed(() => {
  return nanoToValue(collateralVault.value?.interestRateInfo.supplyAPY || 0n, 25)
})
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

    // Collateral price ALWAYS comes from liability vault's oracle
    let valueUsd = 0
    let unitPriceUsd = 0
    if (position.value) {
      const priceInfo = getCollateralAssetPriceFromLiability(position.value.borrow, item.vault)
      if (priceInfo) {
        const amount = nanoToValue(item.assets, item.vault.decimals)
        valueUsd = amount * nanoToValue(priceInfo.amountOutMid, 18)
        unitPriceUsd = nanoToValue(priceInfo.amountOutMid, 18)
      }
    }

    return {
      ...item,
      supplyApy,
      supplyApyWithRewards: supplyApy + (opportunity?.apr || 0),
      valueUsd,
      unitPriceUsd,
    }
  })
})

const collateralValueUsd = computed(() => {
  if (!position.value) {
    return 0
  }

  // Collateral price ALWAYS comes from liability vault's oracle
  if (!collateralItems.value.length) {
    const priceInfo = getCollateralAssetPriceFromLiability(position.value.borrow, position.value.collateral)
    if (!priceInfo) return 0
    const amount = nanoToValue(position.value.supplied, position.value.collateral.decimals)
    return amount * nanoToValue(priceInfo.amountOutMid, 18)
  }

  // For multiple collaterals, sum up using liability vault's oracle for each
  return collateralItems.value.reduce((total, item) => {
    const priceInfo = getCollateralAssetPriceFromLiability(position.value!.borrow, item.vault)
    if (!priceInfo) return total
    const amount = nanoToValue(item.assets, item.vault.decimals)
    return total + amount * nanoToValue(priceInfo.amountOutMid, 18)
  }, 0)
})

const netAssetValueUsd = computed(() => {
  if (!position.value) {
    return 0
  }

  return collateralValueUsd.value - getVaultPrice(position.value.borrowed, borrowVault.value!)
})
const unitOfAccountUsdPrice = computed(() => {
  if (!position.value) {
    return 0
  }

  return getUnitOfAccountUsdPrice(borrowVault.value!)
})
const liquidationPrice = computed(() => {
  if (!position.value) return undefined

  const price = position.value.price || 0n

  if (price <= 0n) {
    return undefined
  }

  const unitPrice = unitOfAccountUsdPrice.value
  if (!unitPrice) {
    return undefined
  }

  return nanoToValue(price, 18) * unitPrice
})
const borrowLiquidationPrice = computed(() => {
  if (!position.value) return undefined

  const collateralValueLiquidation = position.value.collateralValueLiquidation
  const liabilityValue = position.value.liabilityValue

  if (liabilityValue === 0n || collateralValueLiquidation === 0n) {
    return undefined
  }

  const multiplier = nanoToValue(collateralValueLiquidation, 18) / nanoToValue(liabilityValue, 18)
  const currentBorrowPrice = getVaultOraclePrice(1, borrowVault.value)

  if (!currentBorrowPrice) {
    return undefined
  }

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
    collateralValueUsd.value,
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
          const vault = await getOrFetch(address) as Vault | SecuritizeVault | undefined
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
  // Redirect to portfolio if not connected
  if (!isConnected.value) {
    router.replace('/portfolio')
    return
  }

  try {
    await until(isPositionsLoaded).toBe(true)
    position.value = getPositionBySubAccountIndex(+positionIndex)
    if (position.value) {
      collateralItems.value = [{
        vault: position.value.collateral as Vault,
        assets: position.value.supplied,
      }]
      // Only load additional collaterals if position has multiple
      if (position.value.collaterals?.length && position.value.collaterals.length > 1) {
        await loadCollaterals()
      }
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
const openCollateralInfoModal = (vault: Vault | SecuritizeVault) => {
  const isSecuritize = 'type' in vault && vault.type === 'securitize'
  modal.open(VaultOverviewModal, {
    props: isSecuritize
      ? { securitizeVault: vault as SecuritizeVault }
      : { vault: vault as Vault },
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
        <UiLoader class="text-neutral-500" />
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
        class="flex flex-col gap-16 p-16 rounded-12 border border-line-default bg-card shadow-card"
      >
        <div class="flex justify-between items-center">
          <div class="text-p2 text-neutral-500">
            Net APY
          </div>
          <div class="text-h5 text-neutral-800 flex justify-end items-center gap-4">
            {{ formatNumber(netAPY) }}%
            <SvgIcon
              class="!w-24 !h-24 text-neutral-400 cursor-pointer"
              name="info-circle"
              @click="onNetApyInfoIconClick"
            />
          </div>
        </div>
        <div class="flex justify-between items-center">
          <div class="text-p2 text-neutral-500">
            Net asset value
          </div>
          <div class="text-h5 text-neutral-800">
            ${{ isCollateralsLoading ? '-' : formatNumber(netAssetValueUsd) }}
          </div>
        </div>
      </div>
      <div
        v-if="!hasNoBorrow"
        class="rounded-12 bg-card border border-line-default shadow-card p-16"
      >
        <div class="text-h4 text-neutral-800 flex items-center flex-wrap gap-12 mb-16">
          Position risk

          <div class="text-h6 text-content-secondary bg-surface-elevated py-4 px-12 rounded-8 border border-line-default">
            Position {{ positionIndex }}
          </div>
        </div>
        <div class="flex justify-between gap-8 flex-wrap mb-16">
          <div class="text-neutral-500 text-p3">
            Health score
          </div>
          <div class="text-neutral-800 text-p3">
            {{ formatNumber(nanoToValue(position.health, 18)) }}
          </div>
        </div>
        <div class="flex justify-between gap-8 flex-wrap mb-16">
          <div class="text-neutral-500 text-p3">
            Time to liquidation
          </div>
          <div class="text-neutral-800 text-p3">
            {{ timeToLiquidationDisplay }}
          </div>
        </div>
        <div class="flex justify-between gap-8 flex-wrap mb-12">
          <div class="text-neutral-500 text-p3">
            Your LTV
          </div>
          <div class="text-neutral-800 text-p3">
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
        <div class="mb-12 text-h4 text-neutral-800">
          Borrow
        </div>
        <div class="rounded-12 bg-card border border-line-default shadow-card">
          <div class="flex gap-16 p-16 pb-12 border-b border-line-default">
            <VaultLabelsAndAssets
              :vault="position.borrow"
              :assets="[position.borrow.asset]"
            />
          </div>
          <div class="pt-12 px-16 pb-16">
            <div class="flex justify-between gap-8 flex-wrap mb-16">
              <div class="text-neutral-500 text-p3">
                Market value
              </div>
              <div class="flex justify-between gap-8 justify-self-end">
                <div class="text-neutral-800 text-p3">
                  ${{ formatNumber(getVaultPrice(position.borrowed, borrowVault)) }}
                </div>
                <div class="text-neutral-500 text-p3">
                  ~ {{ roundAndCompactTokens(position.borrowed, borrowVault.decimals) }} {{ borrowVault.asset.symbol }}
                </div>
              </div>
            </div>
            <div class="flex justify-between gap-8 flex-wrap mb-16">
              <div class="text-neutral-500 text-p3">
                Borrow APY
              </div>
              <div class="text-neutral-800 text-p3">
                {{ formatNumber(borrowApyWithRewards) }}%
              </div>
            </div>
            <div class="flex justify-between gap-8 flex-wrap mb-12">
              <div class="text-neutral-500 text-p3">
                Current price
              </div>
              <div class="text-neutral-800 text-p3">
                ${{ formatNumber(getVaultPrice(1, position.borrow)) }}
              </div>
            </div>
            <div class="flex justify-between gap-8 flex-wrap mb-12">
              <div class="text-neutral-500 text-p3">
                Oracle price
              </div>
              <div class="text-neutral-800 text-p3">
                {{
                  getVaultOraclePrice(1, position.borrow)
                    ? `$${formatNumber(getVaultOraclePrice(1, position.borrow))}`
                    : '-'
                }}
              </div>
            </div>
            <div class="flex justify-between gap-8 flex-wrap mb-12">
              <div class="text-neutral-500 text-p3">
                Liquidation price
              </div>
              <div class="text-neutral-800 text-p3">
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
        <div class="mb-12 text-h4 text-neutral-800">
          {{ !hasNoBorrow ? 'Collateral' : 'Deposit' }}
        </div>
        <div class="flex flex-col gap-12">
          <div
            v-for="collateral in collateralRows"
            :key="collateral.vault.address"
            class="rounded-12 bg-card border border-line-default shadow-card cursor-pointer"
            @click="openCollateralInfoModal(collateral.vault)"
          >
            <div class="flex gap-16 p-16 pb-12 border-b border-line-default">
              <VaultLabelsAndAssets
                :vault="collateral.vault"
                :assets="[collateral.vault.asset]"
              />
            </div>
            <div class="pt-12 px-16 pb-16">
              <div class="flex justify-between gap-8 flex-wrap mb-16">
                <div class="text-neutral-500 text-p3">
                  {{ !hasNoBorrow ? 'Market value' : 'Supply value' }}
                </div>
                <div class="flex justify-between gap-8 justify-self-end">
                  <div class="text-neutral-800 text-p3">
                    ${{ formatNumber(collateral.valueUsd) }}
                  </div>
                  <div class="text-neutral-500 text-p3">
                    ~ {{ roundAndCompactTokens(collateral.assets, collateral.vault.decimals) }}
                    {{ collateral.vault.asset.symbol }}
                  </div>
                </div>
              </div>
              <div class="flex justify-between gap-8 flex-wrap mb-16">
                <div class="text-neutral-500 text-p3">
                  Supply APY
                </div>
                <div class="text-neutral-800 text-p3">
                  {{ formatNumber(collateral.supplyApyWithRewards) }}%
                </div>
              </div>
              <div class="flex justify-between gap-8 flex-wrap mb-16">
                <div class="text-neutral-500 text-p3">
                  Current price
                </div>
                <div class="text-neutral-800 text-p3">
                  ${{ formatNumber(collateral.unitPriceUsd) }}
                </div>
              </div>
              <div class="flex justify-between gap-8 flex-wrap mb-16">
                <div class="text-neutral-500 text-p3">
                  Oracle price
                </div>
                <div class="text-neutral-800 text-p3">
  {{
                    getVaultOraclePrice(1, collateral.vault, borrowVault)
                      ? `$${formatNumber(getVaultOraclePrice(1, collateral.vault, borrowVault))}`
                      : '-'
                  }}
                </div>
              </div>
              <div
                v-if="!hasNoBorrow && isPrimaryCollateral(collateral.vault)"
                class="flex justify-between gap-8 flex-wrap mb-16"
              >
                <div class="text-neutral-500 text-p3">
                  Liquidation price
                </div>
                <div class="text-neutral-800 text-p3">
                  ${{ liquidationPrice ? formatNumber(liquidationPrice) : '-' }}
                </div>
              </div>
              <div
                v-if="!hasNoBorrow && isPrimaryCollateral(collateral.vault)"
                class="flex justify-between gap-8 flex-wrap mb-16"
              >
                <div class="text-neutral-500 text-p3">
                  LLTV
                </div>
                <div class="text-neutral-800 text-p3">
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
            class="flex items-center justify-center rounded-12 bg-card border border-line-default p-16"
          >
            <UiLoader class="text-neutral-500" />
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
    <template v-else>
      Position not found
    </template>
  </section>
</template>
