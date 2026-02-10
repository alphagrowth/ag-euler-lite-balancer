import { getAddress, type Address } from 'viem'
import { getProductByVault } from '~/composables/useEulerLabels'
import { useIntrinsicApy } from '~/composables/useIntrinsicApy'
import { useVaultRegistry } from '~/composables/useVaultRegistry'
import { type CollateralOption, type Vault } from '~/entities/vault'
import { getAssetUsdValueOrZero } from '~/services/pricing/priceProvider'

type CollateralItem = {
  vault: Vault
  option: CollateralOption
}

export const useMultiplyCollateralOptions = ({
  currentVault,
  liabilityVault,
}: {
  currentVault: Ref<Vault | undefined>
  liabilityVault?: Ref<Vault | undefined>
}) => {
  const { getVault } = useVaultRegistry()
  const { getBalance } = useWallets()
  const { depositPositions } = useEulerAccount()
  const { withIntrinsicSupplyApy, version: intrinsicVersion } = useIntrinsicApy()
  const { getSupplyRewardApy, version: rewardsVersion } = useRewardsApy()

  const currentVaultAddress = computed(() => {
    const current = currentVault.value
    return current ? getAddress(current.address) : ''
  })

  const walletItemsInput = computed(() => {
    const liability = liabilityVault?.value
    if (!liability) {
      return []
    }

    const items: { vault: Vault; balance: bigint }[] = []
    liability.collateralLTVs
      .filter(ltv => ltv.borrowLTV > 0n)
      .forEach((ltv) => {
        const vault = getVault(ltv.collateral) as Vault | undefined
        if (!vault) return

        const balance = getBalance(vault.asset.address as Address)
        const isCurrent = currentVaultAddress.value
          && getAddress(vault.address) === currentVaultAddress.value
        if (!balance && !isCurrent) return

        items.push({ vault, balance })
      })

    return items
  })

  const walletItems = ref<CollateralItem[]>([])

  watchEffect(async () => {
    const inputs = walletItemsInput.value
    void rewardsVersion.value
    void intrinsicVersion.value
    const items = await Promise.all(inputs.map(async ({ vault, balance }) => {
      const amount = nanoToValue(balance, vault.asset.decimals)
      const product = getProductByVault(vault.address)
      const baseApy = nanoToValue(vault.interestRateInfo.supplyAPY || 0n, 25)
      const apy = withIntrinsicSupplyApy(baseApy, vault.asset.symbol) + getSupplyRewardApy(vault.address)

      return {
        vault,
        option: {
          type: 'wallet',
          amount,
          price: await getAssetUsdValueOrZero(amount, vault, 'off-chain'),
          apy,
          symbol: vault.asset.symbol,
          assetAddress: vault.asset.address,
          label: product.name || vault.name,
          vaultAddress: vault.address,
        },
      } as CollateralItem
    }))
    walletItems.value = items
  })

  const savingItemsInput = computed(() => {
    const liability = liabilityVault?.value
    if (!liability) return []
    const validCollaterals = new Set(
      liability.collateralLTVs.filter(ltv => ltv.borrowLTV > 0n).map(ltv => getAddress(ltv.collateral)),
    )
    return depositPositions.value
      .filter(position => position.assets > 0n && validCollaterals.has(getAddress(position.vault.address)))
      .map(position => ({ vault: position.vault as Vault, assets: position.assets }))
  })

  const savingItems = ref<CollateralItem[]>([])

  watchEffect(async () => {
    const inputs = savingItemsInput.value
    void rewardsVersion.value
    void intrinsicVersion.value
    const items = await Promise.all(inputs.map(async ({ vault, assets }) => {
      const amount = nanoToValue(assets, vault.asset.decimals)
      const product = getProductByVault(vault.address)
      const baseApy = nanoToValue(vault.interestRateInfo.supplyAPY || 0n, 25)
      const apy = withIntrinsicSupplyApy(baseApy, vault.asset.symbol) + getSupplyRewardApy(vault.address)

      return {
        vault,
        option: {
          type: 'saving',
          amount,
          price: await getAssetUsdValueOrZero(amount, vault, 'off-chain'),
          apy,
          symbol: vault.asset.symbol,
          assetAddress: vault.asset.address,
          label: product.name || vault.name,
          vaultAddress: vault.address,
        },
      } as CollateralItem
    }))
    savingItems.value = items
  })

  const combinedItems = computed<CollateralItem[]>(() => {
    const items = [...savingItems.value, ...walletItems.value]
    items.sort((a, b) => (b.option.price || 0) - (a.option.price || 0))
    return items
  })

  const collateralOptions = computed<CollateralOption[]>(() => {
    return combinedItems.value.map(item => item.option)
  })

  const collateralVaults = computed<Vault[]>(() => {
    return combinedItems.value.map(item => item.vault)
  })

  return {
    collateralOptions,
    collateralVaults,
  }
}
