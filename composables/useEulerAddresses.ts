import config from '~/entities/config'
import { availableNetworkIds } from '~/entities/custom'

export type EulerLensAddresses = {
  accountLens: string
  eulerEarnVaultLens: string
  irmLens: string
  oracleLens: string
  utilsLens: string
  vaultLens: string
} | null

interface EulerChainConfig {
  chainId: number
  name: string
  viemName?: string
  safeBaseUrl?: string
  safeAddressPrefix?: string
  status: string
  addresses: {
    lensAddrs: {
      accountLens: string
      eulerEarnVaultLens: string
      irmLens: string
      oracleLens: string
      utilsLens: string
      vaultLens: string
    }
    coreAddrs: {
      balanceTracker: string
      eVaultFactory: string
      eVaultImplementation: string
      eulerEarnFactory: string
      evc: string
      permit2: string
      protocolConfig: string
      sequenceRegistry: string
    }
    peripheryAddrs: {
      adaptiveCurveIRMFactory: string
      capRiskStewardFactory?: string
      edgeFactory: string
      edgeFactoryPerspective: string
      escrowedCollateralPerspective: string
      eulerEarnFactoryPerspective: string
      eulerEarnGovernedPerspective: string
      eulerUngoverned0xPerspective: string
      eulerUngovernedNzxPerspective: string
      evkFactoryPerspective: string
      externalVaultRegistry: string
      feeFlowController: string
      governedPerspective: string
      governorAccessControlEmergencyFactory: string
      irmRegistry: string
      kinkIRMFactory: string
      kinkyIRMFactory?: string
      oracleAdapterRegistry: string
      oracleRouterFactory: string
      swapVerifier: string
      securitizeFactory?: string
      swapper: string
      termsOfUseSigner: string
    }
  }
}

const allowedChainIds = availableNetworkIds.length ? [...availableNetworkIds] : [1]
const eulerChainsConfig = ref<EulerChainConfig[]>([])
const isLoading = ref(false)
const chainId = ref<number>(allowedChainIds[0] || 0)
const error = ref<string | null>(null)

export const useEulerAddresses = () => {
  const { network } = useRuntimeConfig().public
  const baseConfig = config[network as keyof typeof config]
  const { EULER_INTERFACES_CHAINS_URL } = baseConfig

  const changeCurrentChainId = (_chainId: number) => {
    if (!allowedChainIds.includes(_chainId)) {
      console.warn(`[useEulerAddresses] chainId ${_chainId} is not allowed`)
      return
    }
    chainId.value = _chainId
  }

  const loadEulerConfig = async () => {
    if (eulerChainsConfig.value.length > 0) return

    isLoading.value = true
    error.value = null

    try {
      if (!EULER_INTERFACES_CHAINS_URL) {
        throw new Error('Euler chains URL is not configured')
      }
      const response = await fetch(EULER_INTERFACES_CHAINS_URL)
      if (!response.ok) {
        throw new Error(`Failed to fetch Euler config: ${response.statusText}`)
      }

      const data: EulerChainConfig[] = await response.json()
      const filteredData = data.filter(chain => allowedChainIds.includes(chain.chainId))

      if (!filteredData.length) {
        console.warn('[useEulerAddresses] availableNetworkIds did not match any remote chains, using full list')
      }

      eulerChainsConfig.value = filteredData.length ? filteredData : data
    }
    catch (err) {
      error.value = err instanceof Error ? err.message : 'Unknown error'
      console.error('Failed to load Euler addresses:', err)
    }
    finally {
      isLoading.value = false
    }
  }

  const getCurrentChainConfig = computed(() => {
    if (eulerChainsConfig.value.length === 0) return undefined

    const targetChainId = chainId.value || allowedChainIds.find(id => eulerChainsConfig.value.some(chain => chain.chainId === id)) || null

    if (targetChainId) {
      return eulerChainsConfig.value.find(chain => chain.chainId === targetChainId)
    }

    return eulerChainsConfig.value[0]
  })

  const eulerLensAddresses = computed(() => {
    const config = getCurrentChainConfig.value
    if (!config) return null

    return {
      accountLens: config.addresses.lensAddrs.accountLens,
      eulerEarnVaultLens: config.addresses.lensAddrs.eulerEarnVaultLens,
      irmLens: config.addresses.lensAddrs.irmLens,
      oracleLens: config.addresses.lensAddrs.oracleLens,
      utilsLens: config.addresses.lensAddrs.utilsLens,
      vaultLens: config.addresses.lensAddrs.vaultLens,
    }
  })

  const eulerCoreAddresses = computed(() => {
    const config = getCurrentChainConfig.value
    if (!config) return null

    return {
      balanceTracker: config.addresses.coreAddrs.balanceTracker,
      eVaultFactory: config.addresses.coreAddrs.eVaultFactory,
      eVaultImplementation: config.addresses.coreAddrs.eVaultImplementation,
      eulerEarnFactory: config.addresses.coreAddrs.eulerEarnFactory,
      evc: config.addresses.coreAddrs.evc,
      permit2: config.addresses.coreAddrs.permit2,
      protocolConfig: config.addresses.coreAddrs.protocolConfig,
      sequenceRegistry: config.addresses.coreAddrs.sequenceRegistry,
    }
  })

  const eulerPeripheryAddresses = computed(() => {
    const config = getCurrentChainConfig.value
    if (!config) return null

    return {
      adaptiveCurveIRMFactory: config.addresses.peripheryAddrs.adaptiveCurveIRMFactory,
      capRiskStewardFactory: config.addresses.peripheryAddrs.capRiskStewardFactory,
      edgeFactory: config.addresses.peripheryAddrs.edgeFactory,
      edgeFactoryPerspective: config.addresses.peripheryAddrs.edgeFactoryPerspective,
      escrowedCollateralPerspective: config.addresses.peripheryAddrs.escrowedCollateralPerspective,
      eulerEarnFactoryPerspective: config.addresses.peripheryAddrs.eulerEarnFactoryPerspective,
      eulerEarnGovernedPerspective: config.addresses.peripheryAddrs.eulerEarnGovernedPerspective,
      eulerUngoverned0xPerspective: config.addresses.peripheryAddrs.eulerUngoverned0xPerspective,
      eulerUngovernedNzxPerspective: config.addresses.peripheryAddrs.eulerUngovernedNzxPerspective,
      evkFactoryPerspective: config.addresses.peripheryAddrs.evkFactoryPerspective,
      externalVaultRegistry: config.addresses.peripheryAddrs.externalVaultRegistry,
      feeFlowController: config.addresses.peripheryAddrs.feeFlowController,
      governedPerspective: config.addresses.peripheryAddrs.governedPerspective,
      governorAccessControlEmergencyFactory: config.addresses.peripheryAddrs.governorAccessControlEmergencyFactory,
      irmRegistry: config.addresses.peripheryAddrs.irmRegistry,
      kinkIRMFactory: config.addresses.peripheryAddrs.kinkIRMFactory,
      kinkyIRMFactory: config.addresses.peripheryAddrs.kinkyIRMFactory,
      oracleAdapterRegistry: config.addresses.peripheryAddrs.oracleAdapterRegistry,
      oracleRouterFactory: config.addresses.peripheryAddrs.oracleRouterFactory,
      securitizeFactory: config.addresses.peripheryAddrs.securitizeFactory,
      swapVerifier: config.addresses.peripheryAddrs.swapVerifier,
      swapper: config.addresses.peripheryAddrs.swapper,
      termsOfUseSigner: config.addresses.peripheryAddrs.termsOfUseSigner,
    }
  })

  return {
    loadEulerConfig,
    eulerLensAddresses,
    eulerCoreAddresses,
    eulerPeripheryAddresses,
    getCurrentChainConfig,
    eulerChainsConfig,
    chainId,
    changeCurrentChainId,
    isLoading,
    error,
    isReady: computed(() => eulerChainsConfig.value.length > 0 && !error.value),
  }
}
