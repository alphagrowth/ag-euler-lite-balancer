import { useDisconnect } from '@wagmi/vue'
import { useModal } from '~/components/ui/composables/useModal'
import { BlockedAddressModal } from '#components'
import { detectVpn, resetVpnCache } from '~/services/vpn'
import { resetCountryCache } from '~/services/country'
import { screenAddress } from '~/services/trm'

// Track last screened address to avoid duplicate API calls
let lastScreenedAddress: string | null = null

export const useAddressScreen = () => {
  const { public: { walletScreeningUri } } = useRuntimeConfig()
  const modal = useModal()
  const { disconnect } = useDisconnect()
  const router = useRouter()

  const blockedAddress = ref<string | null>(null)
  const isScreening = ref(false)

  const showBlockedModal = (address: string) => {
    blockedAddress.value = address
    modal.open(BlockedAddressModal, {
      props: {
        address,
        onClose: () => {
          modal.close()
          blockedAddress.value = null
          router.push('/')
        },
      },
    })
  }

  const screenConnectedAddress = async (address: string): Promise<boolean> => {
    if (!walletScreeningUri || !address) {
      return false
    }

    if (lastScreenedAddress === address.toLowerCase()) {
      return false
    }

    isScreening.value = true
    try {
      const vpnIsUsed = await detectVpn()
      const isRestricted = await screenAddress(walletScreeningUri, address, vpnIsUsed)

      lastScreenedAddress = address.toLowerCase()

      if (isRestricted) {
        await disconnect()
        showBlockedModal(address)
        return true
      }
      return false
    }
    finally {
      isScreening.value = false
    }
  }

  const resetScreeningCache = () => {
    lastScreenedAddress = null
    resetVpnCache()
    resetCountryCache()
  }

  return {
    isScreening,
    blockedAddress,
    screenConnectedAddress,
    resetScreeningCache,
  }
}
