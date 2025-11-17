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
      swapper: string
      termsOfUseSigner: string
    }
  }
}

const eulerChainsConfig = ref<EulerChainConfig[]>([])
const isLoading = ref(false)
const chainId = ref<number>(1);
const error = ref<string | null>(null)

export const useEulerAddresses = () => {
  const changeCurrentChainId = (_chainId: number) => {
    chainId.value = _chainId
  }

  const loadEulerConfig = async () => {
    if (eulerChainsConfig.value.length > 0) return

    isLoading.value = true
    error.value = null

    try {
      const response = await fetch('https://raw.githubusercontent.com/euler-xyz/euler-interfaces/refs/heads/master/EulerChains.json')
      if (!response.ok) {
        throw new Error(`Failed to fetch Euler config: ${response.statusText}`)
      }

      const data = await response.json()
      eulerChainsConfig.value = data
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

    if (chainId.value) {
      return eulerChainsConfig.value.find(chain => chain.chainId === chainId.value)
    }

    return eulerChainsConfig.value.find(chain => chain.chainId === 1)
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
      swapVerifier: config.addresses.peripheryAddrs.swapVerifier,
      swapper: config.addresses.peripheryAddrs.swapper,
      termsOfUseSigner: config.addresses.peripheryAddrs.termsOfUseSigner,
    }
  })

  const eulerGoldskyUrl = computed(() => {
    // TODO: make chain dependent
    return `https://api.goldsky.com/api/public/project_cm4iagnemt1wp01xn4gh1agft/subgraphs/euler-v2-mainnet/latest/gn`
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
    eulerGoldskyUrl,
    isLoading,
    error,
    isReady: computed(() => eulerChainsConfig.value.length > 0 && !error.value),
  }
}
