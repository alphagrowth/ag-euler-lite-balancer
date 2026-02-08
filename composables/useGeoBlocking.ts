import { ethers } from 'ethers'
import { useGeoInfo } from '~/composables/useGeoInfo'
import { getProductByVault, useEulerLabels } from '~/composables/useEulerLabels'

const normalizeAddress = (address: string) => {
  try {
    return ethers.getAddress(address)
  }
  catch {
    return address.toLowerCase()
  }
}

const normalizeCountry = (country?: string | null) => {
  if (!country) return null
  const trimmed = country.trim().toLowerCase()
  return trimmed || null
}

export const useGeoBlocking = () => {
  const { country } = useGeoInfo()
  const { earnVaultBlocks } = useEulerLabels()

  const normalizedCountry = computed(() => normalizeCountry(country.value))

  const isVaultBlockedByCountry = (vaultAddress: string): boolean => {
    const currentCountry = normalizedCountry.value
    if (!currentCountry) return false
    const product = getProductByVault(vaultAddress)
    return product.block?.includes(currentCountry) ?? false
  }

  const isBorrowPairBlocked = (collateralAddress: string, borrowAddress: string): boolean => {
    return isVaultBlockedByCountry(collateralAddress) || isVaultBlockedByCountry(borrowAddress)
  }

  const isEarnVaultBlocked = (vaultAddress: string): boolean => {
    const currentCountry = normalizedCountry.value
    if (!currentCountry) return false
    const normalized = normalizeAddress(vaultAddress)
    const blocked = earnVaultBlocks[normalized]
    return blocked ? blocked.includes(currentCountry) : false
  }

  const useIsVaultBlocked = (vaultAddress: string | Ref<string>) => {
    return computed(() => isVaultBlockedByCountry(unref(vaultAddress)))
  }

  const useIsBorrowPairBlocked = (collateral: string | Ref<string>, borrow: string | Ref<string>) => {
    return computed(() => isBorrowPairBlocked(unref(collateral), unref(borrow)))
  }

  const useIsEarnVaultBlocked = (vaultAddress: string | Ref<string>) => {
    return computed(() => isEarnVaultBlocked(unref(vaultAddress)))
  }

  return {
    isVaultBlockedByCountry,
    isBorrowPairBlocked,
    isEarnVaultBlocked,
    useIsVaultBlocked,
    useIsBorrowPairBlocked,
    useIsEarnVaultBlocked,
  }
}
