<script setup lang="ts">
import { useAccount } from '@wagmi/vue'
import { ethers } from 'ethers'
import type { AccountBorrowPosition } from '~/entities/account'
import { getSubAccountIndex } from '~/entities/account'
import { getAssetLogoUrl } from '~/composables/useTokens'
import { useEulerProductOfVault } from '~/composables/useEulerLabels'
import {
  getNetAPY,
  type Vault,
} from '~/entities/vault'
import {
  getAssetUsdValue,
  formatAssetValue,
  getCollateralUsdValue,
} from '~/services/pricing/priceProvider'
import { eulerAccountLensABI } from '~/entities/euler/abis'
import { useVaultRegistry } from '~/composables/useVaultRegistry'

const { position } = defineProps<{ position: AccountBorrowPosition }>()

const { address } = useAccount()
const { portfolioAddress } = useEulerAccount()
const ownerAddress = computed(() => portfolioAddress.value || address.value || '')
const subAccountIndex = computed(() => {
  if (!ownerAddress.value || !position.subAccount) return 0
  return getSubAccountIndex(ownerAddress.value, position.subAccount)
})

const { getOpportunityOfBorrowVault, getOpportunityOfLendVault } = useMerkl()
const { withIntrinsicBorrowApy, withIntrinsicSupplyApy } = useIntrinsicApy()

const { name: collateralProductName } = useEulerProductOfVault(position.collateral.address)
const { name: borrowProductName } = useEulerProductOfVault(position.borrow.address)

type PositionCollateral = {
  vault: Vault
  assets: bigint
}

const collateralItems = ref<PositionCollateral[]>([])
const { isReady: isVaultsReady } = useVaults()
const { getOrFetch } = useVaultRegistry()
const { eulerLensAddresses, isReady: isEulerAddressesReady, loadEulerConfig } = useEulerAddresses()
const { EVM_PROVIDER_URL } = useEulerConfig()

const borrowVault = computed(() => position.borrow)
const collateralVault = computed(() => position.collateral)
const hasMultipleCollaterals = computed(() => (position.collaterals?.length || 0) > 1)
const collateralSymbolLabel = computed(() => {
  const symbol = position.collateral.asset.symbol
  return hasMultipleCollaterals.value ? `${symbol} & others` : symbol
})
const pairSymbols = computed(() => `${collateralSymbolLabel.value}/${position.borrow.asset.symbol}`)

const isAnyUnverified = computed(() => {
  const collateralUnverified = 'verified' in position.collateral && !position.collateral.verified
  const borrowUnverified = 'verified' in position.borrow && !position.borrow.verified
  return collateralUnverified || borrowUnverified
})

const collateralLabel = computed(() => {
  if ('vaultCategory' in position.collateral && position.collateral.vaultCategory === 'escrow') {
    return 'Escrowed collateral'
  }
  return collateralProductName || position.collateral.name
})
const borrowLabel = computed(() => borrowProductName || position.borrow.name)

const pairName = computed(() => {
  if (collateralLabel.value === borrowLabel.value) {
    return collateralLabel.value
  }
  return `${collateralLabel.value} / ${borrowLabel.value}`
})
const opportunityInfoForBorrow = computed(() => getOpportunityOfBorrowVault(borrowVault.value.asset.address || ''))
const opportunityInfoForCollateral = computed(() => getOpportunityOfLendVault(collateralVault.value.address || ''))
const collateralSupplyApy = computed(() => {
  return withIntrinsicSupplyApy(
    nanoToValue(collateralVault.value.interestRateInfo.supplyAPY || 0n, 25),
    collateralVault.value?.asset.symbol,
  )
})
const borrowApy = computed(() => withIntrinsicBorrowApy(
  nanoToValue(borrowVault.value?.interestRateInfo.borrowAPY || 0n, 25),
  borrowVault.value?.asset.symbol,
))

const collateralValueUsd = ref(0)

const updateCollateralValueUsd = async () => {
  // Collateral price ALWAYS comes from liability vault's oracle, converted to USD
  if (!collateralItems.value.length) {
    collateralValueUsd.value = await getCollateralUsdValue(position.supplied, position.borrow, position.collateral, 'off-chain')
    return
  }

  // For multiple collaterals, sum up using liability vault's oracle for each
  const promises = collateralItems.value.map(item =>
    getCollateralUsdValue(item.assets, position.borrow, item.vault, 'off-chain'),
  )
  const values = await Promise.all(promises)
  collateralValueUsd.value = values.reduce((total, val) => total + val, 0)
}

watchEffect(() => {
  updateCollateralValueUsd()
})

const collateralValueInfo = computed(() => {
  const hasPrice = collateralValueUsd.value > 0
  return {
    display: hasPrice ? formatCompactUsdValue(collateralValueUsd.value) : `${roundAndCompactTokens(collateralItems.value[0]?.assets ?? 0n, BigInt(position.collateral.decimals))} ${position.collateral.asset.symbol}`,
    hasPrice,
  }
})
// collateralValueInfo stays as computed since it derives from collateralValueUsd ref

const collateralValueDisplay = computed(() => collateralValueInfo.value.display)

const borrowedValueInfo = ref<{ display: string; hasPrice: boolean }>({ display: '-', hasPrice: false })

const updateBorrowedValueInfo = async () => {
  const price = await formatAssetValue(position.borrowed ?? 0n, borrowVault.value!, 'off-chain')
  borrowedValueInfo.value = {
    display: price.hasPrice ? formatCompactUsdValue(price.usdValue) : price.display,
    hasPrice: price.hasPrice,
  }
}

watchEffect(() => {
  updateBorrowedValueInfo()
})

const borrowedValueDisplay = computed(() => borrowedValueInfo.value.display)

const borrowedValueUsd = ref(0)

const updateBorrowedValueUsd = async () => {
  borrowedValueUsd.value = await getAssetUsdValue(position.borrowed, borrowVault.value, 'off-chain')
}

watchEffect(() => {
  updateBorrowedValueUsd()
})

const netAssetValueUsd = computed(() => {
  return collateralValueUsd.value - borrowedValueUsd.value
})

const netAssetValueDisplay = computed(() => {
  return formatCompactUsdValue(netAssetValueUsd.value)
})

const netAPY = computed(() => {
  return getNetAPY(
    collateralValueUsd.value,
    collateralSupplyApy.value,
    borrowedValueUsd.value,
    borrowApy.value,
    opportunityInfoForCollateral.value?.apr || null,
    opportunityInfoForBorrow.value?.apr || null,
  )
})

const loadCollaterals = async () => {
  // Only load additional collaterals if position has multiple
  if (!position.collaterals?.length || position.collaterals.length <= 1) return

  const collateralAddresses = position.collaterals?.length
    ? position.collaterals
    : [position.collateral.address]

  const normalized = collateralAddresses.reduce<string[]>((acc, address) => {
    try {
      acc.push(ethers.getAddress(address))
    }
    catch {
      return acc
    }
    return acc
  }, [])

  const primaryAddress = ethers.getAddress(position.collateral.address)
  const unique = Array.from(new Set(normalized))
  const orderedAddresses = [primaryAddress, ...unique.filter(address => address !== primaryAddress)]

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
          const vault = await getOrFetch(address) as Vault | undefined
          let assets = 0n

          try {
            const res = await accountLensContract.getAccountInfo(position.subAccount, address)
            assets = res.vaultAccountInfo.assets
          }
          catch {
            if (address === primaryAddress) {
              assets = position.supplied
            }
          }

          return { vault, assets }
        }
        catch (e) {
          console.warn('[PortfolioBorrowItem] failed to load collateral vault', address, e)
          return null
        }
      }),
    )

    collateralItems.value = items.filter((item): item is PositionCollateral => !!item)
  }
  catch (e) {
    console.warn('[PortfolioBorrowItem] failed to load collaterals', e)
  }
}

// Initialize collateralItems - for securitize, we won't load additional collaterals
collateralItems.value = [{
  vault: position.collateral as Vault,
  assets: position.supplied,
}]

onMounted(() => {
  loadCollaterals()
})
</script>

<template>
  <NuxtLink
    :to="`/position/${subAccountIndex}`"
    class="block no-underline bg-surface rounded-xl border border-line-subtle shadow-card transition-all duration-default ease-default hover:shadow-card-hover hover:border-line-emphasis"
  >
    <div class="flex py-16 px-16 pb-12 border-b border-line-default">
      <div
        class="flex flex-col gap-12 items-start w-full"
      >
        <div
          class="text-h6 text-content-secondary bg-surface-secondary py-4 px-12 rounded-8 border border-line-default"
        >
          Position {{ subAccountIndex }}
        </div>
        <div class="flex gap-12">
          <BaseAvatar
            :src="[position.collateral.asset.symbol, position.borrow.asset.symbol].map(s => getAssetLogoUrl(s))"
            :label="[position.collateral.asset.symbol, position.borrow.asset.symbol]"
            class="icon--40"
          />
          <div>
            <div class="text-content-tertiary text-p3 mb-4">
              <VaultDisplayName
                :name="pairName"
                :is-unverified="isAnyUnverified"
              />
            </div>
            <div class="text-h5 text-content-primary">
              {{ pairSymbols }}
            </div>
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
            Net asset value
          </div>
          <div class="flex justify-between gap-8 text-right">
            <div class="text-content-primary text-p3">
              {{ netAssetValueDisplay }}
            </div>
          </div>
        </div>
        <div class="flex justify-between">
          <div class="text-content-tertiary text-p3">
            My Debt
          </div>
          <div class="flex justify-between gap-8 text-right">
            <div class="text-content-primary text-p3">
              {{ borrowedValueDisplay }}
            </div>
            <div
              v-if="borrowedValueInfo.hasPrice"
              class="text-content-tertiary text-p3"
            >
              ~ {{ roundAndCompactTokens(position.borrowed, position.borrow.decimals) }}
              {{ position.borrow.asset.symbol }}
            </div>
          </div>
        </div>
        <div class="flex justify-between">
          <div class="text-content-tertiary text-p3">
            Collateral value
          </div>
          <div class="flex justify-between gap-8 text-right">
            <div class="text-content-primary text-p3">
              {{ collateralValueDisplay }}
            </div>
            <div
              v-if="collateralValueInfo.hasPrice"
              class="text-content-tertiary text-p3"
            >
              ~ {{ roundAndCompactTokens(collateralItems[0].assets, position.collateral.decimals) }}
              {{ position.collateral.asset.symbol }} {{ collateralItems.length > 1 ? '& others' : '' }}
            </div>
          </div>
        </div>
        <div class="flex justify-between">
          <div class="text-content-tertiary text-p3">
            Net APY
          </div>
          <div
            :class="[netAPY <= 0 ? 'text-error-500' : 'text-accent-600']"
            class="text-p2"
          >
            {{ formatNumber(netAPY) }}%
          </div>
        </div>
        <div class="flex justify-between">
          <div class="text-content-tertiary text-p3">
            Health score
          </div>
          <div class="text-content-primary text-p3">
            {{ formatNumber(nanoToValue(position.health, 18)) }}
          </div>
        </div>
        <div class="flex justify-between">
          <div class="text-content-tertiary text-p3">
            Your LTV
          </div>
          <div class="flex justify-between items-center gap-16">
            <UiProgress
              style="width: 111px"
              :model-value="nanoToValue(position.userLTV, 18)"
              :max="nanoToValue(position.liquidationLTV, 2)"
              :color="nanoToValue(position.userLTV, 18) >= (nanoToValue(position.liquidationLTV, 2) - 2) ? 'danger' : undefined"
              size="small"
            />
            <div class="flex justify-between gap-8 text-right">
              <div class="text-content-primary text-p3">
                {{ formatNumber(nanoToValue(position.userLTV, 18), 2) }}/{{ nanoToValue(position.liquidationLTV, 2) }}%
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </NuxtLink>
</template>
