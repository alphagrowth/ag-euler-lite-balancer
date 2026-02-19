import { getAddress } from 'viem'
import { useIntrinsicApy } from '~/composables/useIntrinsicApy'
import { useVaultRegistry } from '~/composables/useVaultRegistry'
import { type CollateralOption, type Vault } from '~/entities/vault'
import { buildCollateralOption, computeBorrowApy } from '~/utils/collateralOptions'
import { createRaceGuard } from '~/utils/race-guard'

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
  const guard = createRaceGuard()

  watchEffect(async () => {
    const vaults = borrowVaults.value
    void rewardsVersion.value
    void intrinsicVersion.value
    const gen = guard.next()
    const options = await Promise.all(vaults.map(async (vault) => {
      const apy = computeBorrowApy(vault, withIntrinsicBorrowApy, getBorrowRewardApy, collateralVault?.value?.address)
      return buildCollateralOption({ vault, type: 'vault', amount: 0, priceAmount: 1, apy, tagContext: 'swap-target' })
    }))
    if (guard.isStale(gen)) return
    borrowOptions.value = options
  })

  return {
    borrowVaults,
    borrowOptions,
  }
}
