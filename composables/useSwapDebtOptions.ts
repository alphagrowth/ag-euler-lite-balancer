import { getAddress } from 'viem'
import { getProductByVault } from '~/composables/useEulerLabels'
import { useIntrinsicApy } from '~/composables/useIntrinsicApy'
import { useVaultRegistry } from '~/composables/useVaultRegistry'
import { type CollateralOption, type Vault } from '~/entities/vault'
import { getAssetUsdValueOrZero } from '~/services/pricing/priceProvider'
import { getVaultTags } from '~/composables/useGeoBlock'

export const useSwapDebtOptions = ({
  collateralVault,
  currentBorrowVault,
}: {
  collateralVault: Ref<Vault | undefined>
  currentBorrowVault?: Ref<Vault | undefined>
}) => {
  const { getVerifiedEvkVaults } = useVaultRegistry()
  const { withIntrinsicBorrowApy, version: intrinsicVersion } = useIntrinsicApy()
  const { getBorrowRewardApy, version: rewardsVersion } = useRewardsApy()

  const borrowVaults = computed(() => {
    const collateral = collateralVault.value
    if (!collateral) {
      return []
    }

    const collateralAddress = getAddress(collateral.address)
    const currentBorrowAddress = currentBorrowVault?.value
      ? getAddress(currentBorrowVault.value.address)
      : null

    return getVerifiedEvkVaults().filter((vault) => {
      if (!vault.collateralLTVs?.length) {
        return false
      }
      const hasCollateral = vault.collateralLTVs.some(ltv =>
        getAddress(ltv.collateral) === collateralAddress && ltv.borrowLTV > 0n,
      )
      if (!hasCollateral) {
        return false
      }
      if (currentBorrowAddress && getAddress(vault.address) === currentBorrowAddress) {
        return false
      }
      return vault.supply > 0n && vault.borrowCap > 0n && vault.totalCash > 0n
    })
  })

  const borrowOptions = ref<CollateralOption[]>([])

  watchEffect(async () => {
    const vaults = borrowVaults.value
    void rewardsVersion.value
    void intrinsicVersion.value
    const options = await Promise.all(vaults.map(async (vault) => {
      const product = getProductByVault(vault.address)
      const baseApy = nanoToValue(vault.interestRateInfo.borrowAPY || 0n, 25)
      const apy = withIntrinsicBorrowApy(baseApy, vault.asset.symbol) - getBorrowRewardApy(vault.asset.address, vault.address)

      const { tags, disabled } = getVaultTags(vault.address, 'swap-target')

      return {
        type: 'vault',
        amount: 0,
        price: await getAssetUsdValueOrZero(1, vault, 'off-chain'),
        apy,
        symbol: vault.asset.symbol,
        assetAddress: vault.asset.address,
        label: product.name || vault.name,
        vaultAddress: vault.address,
        tags,
        disabled,
      }
    }))
    borrowOptions.value = options
  })

  return {
    borrowVaults,
    borrowOptions,
  }
}
