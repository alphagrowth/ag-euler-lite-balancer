<script setup lang="ts">
import { useAccount } from '@wagmi/vue'
import { ethers } from 'ethers'
import type { AccountBorrowPosition } from '~/entities/account'
import { getSubAccountIndex } from '~/entities/account'
import { getAssetLogoUrl } from '~/composables/useTokens'
import { useEulerProductOfVault } from '~/composables/useEulerLabels'
import { getNetAPY, getUnitOfAccountUsdPrice, getVaultPrice, getVaultPriceDisplay, getCollateralAssetPriceFromLiability, type Vault } from '~/entities/vault'
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

const collateralLabel = computed(() => {
  if ('type' in position.collateral && position.collateral.type === 'escrow') {
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
const liquidationPriceUsd = computed(() => {
  const price = position.price || 0n

  if (price <= 0n) {
    return undefined
  }

  const unitPrice = getUnitOfAccountUsdPrice(borrowVault.value)
  if (!unitPrice) {
    return undefined
  }

  return nanoToValue(price, 18) * unitPrice
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

const collateralValueUsd = computed(() => {
  // Collateral price ALWAYS comes from liability vault's oracle
  if (!collateralItems.value.length) {
    const priceInfo = getCollateralAssetPriceFromLiability(position.borrow, position.collateral)
    if (!priceInfo) return 0
    const amount = nanoToValue(position.supplied, position.collateral.decimals)
    return amount * nanoToValue(priceInfo.amountOutMid, 18)
  }

  // For multiple collaterals, sum up using liability vault's oracle for each
  return collateralItems.value.reduce((total, item) => {
    const priceInfo = getCollateralAssetPriceFromLiability(position.borrow, item.vault)
    if (!priceInfo) return total
    const amount = nanoToValue(item.assets, item.vault.decimals)
    return total + amount * nanoToValue(priceInfo.amountOutMid, 18)
  }, 0)
})

const collateralValueDisplay = computed(() => {
  return `$${formatNumber(collateralValueUsd.value)}`
})

const borrowedValueDisplay = computed(() => {
  const price = getVaultPriceDisplay(position.borrowed || 0n, borrowVault.value!)
  return price.hasPrice ? `$${formatNumber(price.usdValue)}` : price.display
})

const netAssetValueUsd = computed(() => {
  return collateralValueUsd.value - getVaultPrice(position.borrowed, borrowVault.value)
})

const netAssetValueDisplay = computed(() => {
  return `$${formatNumber(netAssetValueUsd.value)}`
})

const currentPriceDisplay = computed(() => {
  // Collateral price ALWAYS comes from liability vault's oracle
  const priceInfo = getCollateralAssetPriceFromLiability(position.borrow, collateralVault.value)
  if (!priceInfo) return '-'
  const usdValue = nanoToValue(priceInfo.amountOutMid, 18)
  return `$${formatNumber(usdValue)}`
})

const netAPY = computed(() => {
  return getNetAPY(
    collateralValueUsd.value,
    collateralSupplyApy.value,
    getVaultPrice(position.borrowed || 0n || 0, borrowVault.value!),
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
              {{ pairName }}
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
            <div class="text-content-tertiary text-p3">
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
            <div class="text-content-tertiary text-p3">
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
            Current price
          </div>
          <div class="flex justify-between gap-8 text-right">
            <span class="text-content-primary text-p3">
              {{ currentPriceDisplay }}
            </span>
            <span class="text-content-tertiary text-p3">
              {{ position.collateral.asset.symbol }}
            </span>
          </div>
        </div>
        <div class="flex justify-between">
          <div class="text-content-tertiary text-p3">
            Liquidation price
          </div>
          <div class="flex justify-between gap-8 text-right">
            <span class="text-content-primary text-p3">
              ${{ liquidationPriceUsd ? formatNumber(liquidationPriceUsd) : '-' }}
            </span>
            <span class="text-content-tertiary text-p3">
              {{ position.collateral.asset.symbol }}
            </span>
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
