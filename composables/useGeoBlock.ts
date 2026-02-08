import { detectCountry } from '~/services/country'
import { getProductByVault, getEarnVaultBlock } from '~/composables/useEulerLabels'

const country = ref<string | null>(null)

export const useGeoBlock = () => {
  const loadCountry = async () => {
    country.value = await detectCountry()
  }

  return { country, loadCountry }
}

const isCountryInList = (codes: string[]): boolean => {
  return codes.some(code => code.toUpperCase() === country.value!.toUpperCase())
}

export const isVaultBlockedByCountry = (vaultAddress: string): boolean => {
  if (!country.value) return false

  const product = getProductByVault(vaultAddress)
  if (product.block?.length && isCountryInList(product.block)) {
    return true
  }

  const earnBlock = getEarnVaultBlock(vaultAddress)
  if (earnBlock?.length && isCountryInList(earnBlock)) {
    return true
  }

  return false
}

export const isAnyVaultBlockedByCountry = (...addresses: string[]): boolean => {
  return addresses.some(addr => isVaultBlockedByCountry(addr))
}
