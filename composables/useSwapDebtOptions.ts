import { ethers } from 'ethers'
import { getProductByVault } from '~/composables/useEulerLabels'
import { useMerkl } from '~/composables/useMerkl'
import { useIntrinsicApy } from '~/composables/useIntrinsicApy'
import { useVaultRegistry } from '~/composables/useVaultRegistry'
import { type CollateralOption, type Vault } from '~/entities/vault'
import { getAssetUsdValue } from '~/services/pricing/priceProvider'

export const useSwapDebtOptions = ({
  collateralVault,
  currentBorrowVault,
}: {
  collateralVault: Ref<Vault | undefined>
  currentBorrowVault?: Ref<Vault | undefined>
}) => {
  const { getVerifiedEvkVaults } = useVaultRegistry()
  const { getOpportunityOfBorrowVault } = useMerkl()
  const { withIntrinsicBorrowApy } = useIntrinsicApy()

  const borrowVaults = computed(() => {
    const collateral = collateralVault.value
    if (!collateral) {
      return []
    }

    const collateralAddress = ethers.getAddress(collateral.address)
    const currentBorrowAddress = currentBorrowVault?.value
      ? ethers.getAddress(currentBorrowVault.value.address)
      : null

    return getVerifiedEvkVaults().filter((vault) => {
      if (!vault.collateralLTVs?.length) {
        return false
      }
      const hasCollateral = vault.collateralLTVs.some(ltv =>
        ethers.getAddress(ltv.collateral) === collateralAddress && ltv.borrowLTV > 0n,
      )
      if (!hasCollateral) {
        return false
      }
      if (currentBorrowAddress && ethers.getAddress(vault.address) === currentBorrowAddress) {
        return false
      }
      return vault.supply > 0n && vault.borrowCap > 0n && vault.totalCash > 0n
    })
  })

  const borrowOptions = computed<CollateralOption[]>(() => {
    return borrowVaults.value.map((vault) => {
      const product = getProductByVault(vault.address)
      const baseApy = nanoToValue(vault.interestRateInfo.borrowAPY || 0n, 25)
      const opportunity = getOpportunityOfBorrowVault(vault.asset.address)
      const apy = withIntrinsicBorrowApy(baseApy, vault.asset.symbol) - (opportunity?.apr || 0)

      return {
        type: 'vault',
        amount: 0,
        price: getAssetUsdValue(1, vault),
        apy,
        symbol: vault.asset.symbol,
        label: product.name || vault.name,
        vaultAddress: vault.address,
      }
    })
  })

  return {
    borrowVaults,
    borrowOptions,
  }
}
