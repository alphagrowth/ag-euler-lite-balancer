import { ethers } from 'ethers'
import type { Address } from 'viem'
import { getProductByVault } from '~/composables/useEulerLabels'
import { type CollateralOption, getVaultPrice, type Vault } from '~/entities/vault'

export const useSwapCollateralOptions = ({
  currentVault,
  liabilityVault,
}: {
  currentVault: Ref<Vault | undefined>
  liabilityVault?: Ref<Vault | undefined>
}) => {
  const { list, map, escrowMap } = useVaults()
  const { getBalance } = useWallets()

  const resolveVault = (address: string) => {
    const normalized = ethers.getAddress(address)
    return map.value.get(normalized) || escrowMap.value.get(normalized)
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
      candidates = [
        ...list.value,
        ...escrowMap.value.values(),
      ]
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

      return {
        type: 'vault',
        amount,
        price: getVaultPrice(amount, vault),
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
