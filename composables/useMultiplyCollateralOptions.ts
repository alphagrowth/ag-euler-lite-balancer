import { ethers } from 'ethers'
import type { Address } from 'viem'
import { getProductByVault } from '~/composables/useEulerLabels'
import { useMerkl } from '~/composables/useMerkl'
import { useIntrinsicApy } from '~/composables/useIntrinsicApy'
import { useVaultRegistry } from '~/composables/useVaultRegistry'
import { type CollateralOption, type Vault } from '~/entities/vault'
import { getAssetUsdValue } from '~/services/pricing/priceProvider'

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
  const { getOpportunityOfLendVault } = useMerkl()
  const { withIntrinsicSupplyApy } = useIntrinsicApy()

  const currentVaultAddress = computed(() => {
    const current = currentVault.value
    return current ? ethers.getAddress(current.address) : ''
  })

  const walletItems = computed<CollateralItem[]>(() => {
    const liability = liabilityVault?.value
    if (!liability) {
      return []
    }

    const items: CollateralItem[] = []
    liability.collateralLTVs
      .filter(ltv => ltv.borrowLTV > 0n)
      .forEach((ltv) => {
        const vault = getVault(ltv.collateral) as Vault | undefined
        if (!vault) return

        const balance = getBalance(vault.asset.address as Address)
        const isCurrent = currentVaultAddress.value
          && ethers.getAddress(vault.address) === currentVaultAddress.value
        if (!balance && !isCurrent) return

        const amount = nanoToValue(balance, vault.asset.decimals)
        const product = getProductByVault(vault.address)
        const baseApy = nanoToValue(vault.interestRateInfo.supplyAPY || 0n, 25)
        const opportunity = getOpportunityOfLendVault(vault.address)
        const apy = withIntrinsicSupplyApy(baseApy, vault.asset.symbol) + (opportunity?.apr || 0)

        items.push({
          vault,
          option: {
            type: 'wallet',
            amount,
            price: getAssetUsdValue(amount, vault),
            apy,
            symbol: vault.asset.symbol,
            label: product.name || vault.name,
            vaultAddress: vault.address,
          },
        })
      })

    return items
  })

  const savingItems = computed<CollateralItem[]>(() => {
    return depositPositions.value
      .filter(position => position.assets > 0n)
      .map((position) => {
        const vault = position.vault
        const amount = nanoToValue(position.assets, vault.asset.decimals)
        const product = getProductByVault(vault.address)
        const baseApy = nanoToValue(vault.interestRateInfo.supplyAPY || 0n, 25)
        const opportunity = getOpportunityOfLendVault(vault.address)
        const apy = withIntrinsicSupplyApy(baseApy, vault.asset.symbol) + (opportunity?.apr || 0)

        return {
          vault,
          option: {
            type: 'saving',
            amount,
            price: getAssetUsdValue(amount, vault),
            apy,
            symbol: vault.asset.symbol,
            label: product.name || vault.name,
            vaultAddress: vault.address,
          },
        }
      })
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
