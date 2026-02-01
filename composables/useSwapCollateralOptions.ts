import { ethers } from 'ethers'
import type { Address } from 'viem'
import { getProductByVault } from '~/composables/useEulerLabels'
import { useMerkl } from '~/composables/useMerkl'
import { useIntrinsicApy } from '~/composables/useIntrinsicApy'
import { useVaultRegistry } from '~/composables/useVaultRegistry'
import { type CollateralOption, getVaultPrice, type Vault } from '~/entities/vault'

export const useSwapCollateralOptions = ({
  currentVault,
  liabilityVault,
}: {
  currentVault: Ref<Vault | undefined>
  liabilityVault?: Ref<Vault | undefined>
}) => {
  const { borrowList } = useVaults()
  const { getVault: registryGetVault, getByType, getByTypes } = useVaultRegistry()
  const { getBalance } = useWallets()
  const { getOpportunityOfLendVault } = useMerkl()
  const { withIntrinsicSupplyApy } = useIntrinsicApy()

  const resolveVault = (address: string): Vault | undefined => {
    return registryGetVault(address) as Vault | undefined
  }

  const collateralVaults = computed(() => {
    const current = currentVault.value
    const currentAddress = current ? ethers.getAddress(current.address) : null
    const liability = liabilityVault?.value

    let candidates: Vault[] = []

    if (liability) {
      candidates = liability.collateralLTVs
        .filter(ltv => ltv.borrowLTV > 0n)
        .map(ltv => resolveVault(ltv.collateral))
        .filter((vault): vault is Vault => Boolean(vault))
    }
    else {
      const borrowable = new Set(
        borrowList.value.map(pair => ethers.getAddress(pair.borrow.address)),
      )
      // Get EVK and escrow vaults as potential collateral candidates
      const evkAndEscrowVaults = getByTypes(['evk', 'escrow']) as Vault[]
      const baseVaults = evkAndEscrowVaults.filter(vault => borrowable.has(ethers.getAddress(vault.address)))
      const escrowVaults = getByType('escrow') as Vault[]

      candidates = [...baseVaults, ...escrowVaults]
    }

    const unique = new Map<string, Vault>()
    candidates.forEach((vault) => {
      const address = ethers.getAddress(vault.address)
      if (currentAddress && address === currentAddress) {
        return
      }
      if (!unique.has(address)) {
        unique.set(address, vault)
      }
    })

    return [...unique.values()]
  })

  const collateralOptions = computed<CollateralOption[]>(() => {
    return collateralVaults.value.map((vault) => {
      const balance = getBalance(vault.asset.address as Address)
      const amount = nanoToValue(balance, vault.asset.decimals)
      const product = getProductByVault(vault.address)
      const baseApy = nanoToValue(vault.interestRateInfo.supplyAPY || 0n, 25)
      const opportunity = getOpportunityOfLendVault(vault.address)
      const apy = withIntrinsicSupplyApy(baseApy, vault.asset.symbol) + (opportunity?.apr || 0)

      const optionType = ('type' in vault && vault.type === 'escrow') ? 'escrow' : 'vault'

      return {
        type: optionType,
        amount,
        price: getVaultPrice(amount, vault),
        apy,
        symbol: vault.asset.symbol,
        label: product.name || vault.name,
        vaultAddress: vault.address,
      }
    })
  })

  return {
    collateralVaults,
    collateralOptions,
  }
}
