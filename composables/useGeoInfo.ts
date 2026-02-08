import { detectCountry } from '~/services/geo'

export const useGeoInfo = () => {
  const country = useState<string | null>('geoCountry', () => null)
  const isLoading = useState<boolean>('geoCountryLoading', () => false)

  if (import.meta.server) {
    const headers = useRequestHeaders(['x-country-code'])
    if (headers['x-country-code']) {
      country.value = headers['x-country-code']
    }
  }

  onMounted(async () => {
    if (country.value) return
    isLoading.value = true
    country.value = await detectCountry()
    isLoading.value = false
  })

  return {
    country,
    isLoading,
  }
}
