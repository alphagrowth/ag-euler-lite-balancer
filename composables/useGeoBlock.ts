import { detectCountry } from '~/services/country'
import { getProductByVault, getEarnVaultBlock } from '~/composables/useEulerLabels'
import { SANCTIONED_COUNTRIES, COUNTRY_GROUPS } from '~/entities/constants'

const country = ref<string | null>(null)

export const useGeoBlock = () => {
  const loadCountry = async () => {
    if (!import.meta.client) return
    const detected = await detectCountry()
    if (detected) {
      country.value = detected
    }
  }

  return { country, loadCountry }
}

const isCountryInList = (codes: readonly string[]): boolean => {
  return codes.some(code => code.toUpperCase() === country.value!.toUpperCase())
}

const expandBlockList = (codes: readonly string[]): string[] => {
  return codes.flatMap(code => COUNTRY_GROUPS[code] ?? [code])
}

export const isVaultBlockedByCountry = (vaultAddress: string): boolean => {
  if (!country.value) return false

  // Sanctioned countries are always blocked
  if (isCountryInList(SANCTIONED_COUNTRIES)) return true

  const product = getProductByVault(vaultAddress)
  if (product.block?.length && isCountryInList(expandBlockList(product.block))) return true

  const earnBlock = getEarnVaultBlock(vaultAddress)
  if (earnBlock?.length && isCountryInList(expandBlockList(earnBlock))) return true

  return false
}

export const isAnyVaultBlockedByCountry = (...addresses: string[]): boolean => {
  return addresses.some(addr => isVaultBlockedByCountry(addr))
}
