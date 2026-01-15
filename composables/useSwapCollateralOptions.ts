import { ethers } from 'ethers'
import type { Address } from 'viem'
import { getProductByVault } from '~/composables/useEulerLabels'
import { type CollateralOption, getVaultPrice, type Vault } from '~/entities/vault'

export const useSwapCollateralOptions = (borrowVault: Ref<Vault | undefined>) => {
  const { borrowList, escrowMap } = useVaults()
  const { getBalance } = useWallets()

  const collateralVaults = computed(() => {
    const baseVault = borrowVault.value
    if (!baseVault) {
      return []
    }

    const baseAddress = ethers.getAddress(baseVault.address)
    const standardVaults = borrowList.value
      .filter(pair => ethers.getAddress(pair.borrow.address) === baseAddress)
      .map(pair => pair.collateral)

    const escrowVaults = baseVault.collateralLTVs
      .filter(ltv => ltv.borrowLTV > 0n)
      .map(ltv => escrowMap.value.get(ethers.getAddress(ltv.collateral)))
      .filter((vault): vault is Vault => Boolean(vault))

    const unique = new Map<string, Vault>()
    const addVault = (vault: Vault) => {
      const address = ethers.getAddress(vault.address)
      if (address === baseAddress || unique.has(address)) {
        return
      }
      unique.set(address, vault)
    }

    standardVaults.forEach(addVault)
    escrowVaults.forEach(addVault)

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
