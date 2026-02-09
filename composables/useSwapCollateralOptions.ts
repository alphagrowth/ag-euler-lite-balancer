import { getAddress, type Address } from 'viem'
import { getProductByVault } from '~/composables/useEulerLabels'
import { useMerkl } from '~/composables/useMerkl'
import { useIntrinsicApy } from '~/composables/useIntrinsicApy'
import { useVaultRegistry } from '~/composables/useVaultRegistry'
import { type CollateralOption, type Vault } from '~/entities/vault'
import { getAssetUsdValueOrZero } from '~/services/pricing/priceProvider'

export const useSwapCollateralOptions = ({
  currentVault,
  liabilityVault,
}: {
  currentVault: Ref<Vault | undefined>
  liabilityVault?: Ref<Vault | undefined>
}) => {
  const { borrowList } = useVaults()
  const { getVault: registryGetVault, getVerifiedEvkVaults, getEscrowVaults } = useVaultRegistry()
  const { getBalance } = useWallets()
  const { getOpportunityOfLendVault } = useMerkl()
  const { withIntrinsicSupplyApy } = useIntrinsicApy()

  const collateralVaults = computed(() => {
    const current = currentVault.value
    const currentAddress = current ? getAddress(current.address) : null
    const liability = liabilityVault?.value

    let candidates: Vault[] = []

    if (liability) {
      // When we have a liability vault, get collaterals from LTV configuration
      candidates = liability.collateralLTVs
        .filter(ltv => ltv.borrowLTV > 0n)
        .map(ltv => registryGetVault(ltv.collateral) as Vault | undefined)
        .filter((vault): vault is Vault => Boolean(vault))
    }
    else {
      // Without liability vault, show borrowable vaults + all escrow vaults
      const borrowable = new Set(
        borrowList.value.map(pair => getAddress(pair.borrow.address)),
      )
      // Get verified EVK vaults that are borrowable and non-escrow
      const standardVaults = getVerifiedEvkVaults()
        .filter(vault => vault.vaultCategory !== 'escrow')
        .filter(vault => borrowable.has(getAddress(vault.address)))
      // Get all escrow vaults (always valid as collateral, already have verified: true)
      const escrowVaults = getEscrowVaults()

      candidates = [...standardVaults, ...escrowVaults]
    }

    const unique = new Map<string, Vault>()
    candidates.forEach((vault) => {
      const address = getAddress(vault.address)
      if (currentAddress && address === currentAddress) {
        return
      }
      if (!unique.has(address)) {
        unique.set(address, vault)
      }
    })

    return [...unique.values()]
  })

  const collateralOptions = ref<CollateralOption[]>([])

  watchEffect(async () => {
    const vaults = collateralVaults.value
    const options = await Promise.all(vaults.map(async (vault) => {
      const balance = getBalance(vault.asset.address as Address)
      const amount = nanoToValue(balance, vault.asset.decimals)
      const product = getProductByVault(vault.address)
      const baseApy = nanoToValue(vault.interestRateInfo.supplyAPY || 0n, 25)
      const opportunity = getOpportunityOfLendVault(vault.address)
      const apy = withIntrinsicSupplyApy(baseApy, vault.asset.symbol) + (opportunity?.apr || 0)

      const optionType = vault.vaultCategory === 'escrow' ? 'escrow' : 'vault'

      return {
        type: optionType,
        amount,
        price: await getAssetUsdValueOrZero(amount, vault, 'off-chain'),
        apy,
        symbol: vault.asset.symbol,
        label: product.name || vault.name,
        vaultAddress: vault.address,
      }
    }))
    collateralOptions.value = options
  })

  return {
    collateralVaults,
    collateralOptions,
  }
}
