import { ethers } from 'ethers'
import { unref, type Ref, type ComputedRef } from 'vue'
import type { Address } from 'viem'
import { AcknowledgeTermsModal } from '#components'
import { tosSignerReadAbi } from '~/abis/tos'
import { enableTermsOfUseSignature } from '~/entities/custom'
import { useModal } from '~/components/ui/composables/useModal'
import { getTosData } from '~/composables/useTosData'

export const useTermsOfUseGate = () => {
  const modal = useModal()
  const { address } = useWagmi()
  const { eulerPeripheryAddresses, isReady, loadEulerConfig } = useEulerAddresses()
  const { EVM_PROVIDER_URL } = useEulerConfig()

  const hasSigned = useState<boolean | null>('tosHasSigned', () => null)
  const sessionAccepted = useState<boolean>('tosSessionAccepted', () => false)
  const isChecking = ref(false)

  const checkHasSigned = async () => {
    if (!enableTermsOfUseSignature) {
      hasSigned.value = true
      return true
    }
    if (hasSigned.value === true) {
      return true
    }
    if (!address.value) {
      hasSigned.value = false
      return false
    }
    if (!isReady.value) {
      await loadEulerConfig()
    }
    if (!eulerPeripheryAddresses.value?.termsOfUseSigner) {
      hasSigned.value = false
      return false
    }

    try {
      isChecking.value = true
      const { tosMessageHash } = await getTosData()
      const contract = new ethers.Contract(
        eulerPeripheryAddresses.value.termsOfUseSigner,
        tosSignerReadAbi,
        new ethers.JsonRpcProvider(EVM_PROVIDER_URL),
      )
      const lastSignTimestamp = await contract.lastTermsOfUseSignatureTimestamp(
        address.value as Address,
        tosMessageHash,
      )
      const signed = lastSignTimestamp > 0
      hasSigned.value = signed
      return signed
    }
    catch (e) {
      console.warn('[TermsOfUse] failed to check signature', e)
      hasSigned.value = false
      return false
    }
    finally {
      isChecking.value = false
    }
  }

  const resetState = () => {
    hasSigned.value = null
    sessionAccepted.value = false
  }

  watch(address, () => {
    resetState()
  })

  onMounted(() => {
    if (enableTermsOfUseSignature) {
      void checkHasSigned()
    }
  })

  const isTermsRequired = computed(() => {
    return enableTermsOfUseSignature && hasSigned.value === false && !sessionAccepted.value
  })

  const getSubmitLabel = (defaultLabel: string | Ref<string> | ComputedRef<string>) => {
    return computed(() => (isTermsRequired.value ? 'Accept Terms Of Use' : unref(defaultLabel)))
  }

  const getSubmitDisabled = (baseDisabled: boolean | Ref<boolean> | ComputedRef<boolean>) => {
    return computed(() => (isTermsRequired.value ? false : unref(baseDisabled)))
  }

  const openTermsModal = (_onProceed: () => void | Promise<void>) => {
    modal.open(AcknowledgeTermsModal, {
      props: {
        onReject: () => {
          modal.close()
        },
        onAccept: () => {
          sessionAccepted.value = true
          modal.close()
        },
      },
    })
  }

  const guardWithTerms = async (onProceed: () => void | Promise<void>) => {
    if (!enableTermsOfUseSignature) {
      await onProceed()
      return
    }
    if (sessionAccepted.value) {
      await onProceed()
      return
    }
    const signed = await checkHasSigned()
    if (signed) {
      await onProceed()
      return
    }
    openTermsModal(onProceed)
  }

  return {
    isChecking,
    isTermsRequired,
    checkHasSigned,
    getSubmitLabel,
    getSubmitDisabled,
    guardWithTerms,
  }
}
