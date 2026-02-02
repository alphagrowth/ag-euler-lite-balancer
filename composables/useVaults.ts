import { ethers } from 'ethers'
import { useVaultRegistry } from './useVaultRegistry'
import {
  type AnyBorrowVaultPair,
  type EarnVault,
  type EscrowVault,
  type SecuritizeVault,
  fetchEarnVaults,
  fetchVault,
  fetchEarnVault,
  fetchEscrowVault,
  fetchEscrowVaults,
  fetchSecuritizeVault,
  fetchVaults,
  fetchVaultFactories,
  isSecuritizeVault,
  SECURITIZE_FACTORY_ADDRESS,
  type Vault,
} from '~/entities/vault'
import { labelsRepo } from '~/entities/custom'
import { getProductByVault } from '~/composables/useEulerLabels'

const isReady = ref(false)
const isLoading = ref(false)
const isUpdating = ref(false)
const loadedChainId = ref<number | null>(null)

const isEarnLoading = ref(false)
const isEarnUpdating = ref(false)

const isEscrowLoading = ref(false)
const isEscrowUpdating = ref(false)
const isEscrowLoadedOnce = ref(false)

// Borrow pairs computed from registry (EVK + Escrow + Securitize collaterals)
const borrowList = computed((): AnyBorrowVaultPair[] => {
  const { getEvkVaults, getVault: registryGetVault } = useVaultRegistry()
  const pairs: AnyBorrowVaultPair[] = []
  const evkVaults = getEvkVaults()

  evkVaults.forEach((borrowVault) => {
    borrowVault.collateralLTVs.forEach((ltv) => {
      if (ltv.borrowLTV <= 0n) return

      const collateralVault = registryGetVault(ltv.collateral)
      if (!collateralVault) return

      pairs.push({
        borrow: borrowVault,
        collateral: collateralVault,
        borrowLTV: ltv.borrowLTV,
        liquidationLTV: ltv.liquidationLTV,
        initialLiquidationLTV: ltv.initialLiquidationLTV,
        targetTimestamp: ltv.targetTimestamp,
        rampDuration: ltv.rampDuration,
      } as AnyBorrowVaultPair)
    })
  })

  return pairs
})

const resetVaultsState = () => {
  const { clear } = useVaultRegistry()

  isReady.value = false
  isLoading.value = true
  isEarnLoading.value = true
  isEscrowLoadedOnce.value = false
  loadedChainId.value = null
  clear()
}

const updateVaults = async (vaultAddresses?: string[]) => {
  const { set: registrySet } = useVaultRegistry()

  try {
    isUpdating.value = true
    isLoading.value = true

    for await (const result of fetchVaults(vaultAddresses)) {
      result.vaults.forEach((vault) => {
        registrySet(vault.address, vault, 'evk')
      })

      isLoading.value = false

      if (result.isFinished) {
        break
      }
    }
  }
  finally {
    isUpdating.value = false
  }
}
const updateEarnVaults = async () => {
  const { set: registrySet } = useVaultRegistry()

  try {
    isEarnUpdating.value = true
    isEarnLoading.value = true

    for await (const result of fetchEarnVaults()) {
      result.vaults.forEach((vault) => {
        registrySet(vault.address, vault, 'earn')
      })

      isEarnLoading.value = false

      if (result.isFinished) {
        break
      }
    }
  }
  catch (e) {
    // On error, set updating to false here since loadVaults won't complete
    isEarnUpdating.value = false
    throw e
  }
  // Note: isEarnUpdating is set to false in loadVaults() after all vaults are loaded
}

const updateEscrowVaults = async () => {
  const { set: registrySet } = useVaultRegistry()

  try {
    isEscrowUpdating.value = true
    isEscrowLoading.value = true

    for await (const result of fetchEscrowVaults()) {
      result.vaults.forEach((vault) => {
        registrySet(vault.address, vault, 'evk')
      })

      isEscrowLoading.value = false

      if (result.isFinished) {
        break
      }
    }
  }
  catch (e) {
    // On error, set updating to false here since loadVaults won't complete
    isEscrowUpdating.value = false
    throw e
  }
  // Note: isEscrowUpdating is set to false in loadVaults() after all vaults are loaded
}

const updateSecuritizeVaults = async (securitizeAddresses: string[]) => {
  const { set: registrySet } = useVaultRegistry()

  if (!securitizeAddresses.length) {
    return
  }

  // Fetch securitize vault details
  const results = await Promise.allSettled(
    securitizeAddresses.map(addr => fetchSecuritizeVault(addr)),
  )

  results.forEach((result) => {
    if (result.status === 'fulfilled') {
      registrySet(result.value.address, result.value, 'securitize')
    }
  })
}

const loadVaults = async () => {
  const { chainId } = useEulerAddresses()
  const { verifiedVaultAddresses } = useEulerLabels()
  const startChainId = chainId.value

  try {
    resetVaultsState()

    // Step 1: Categorize all vault addresses upfront using subgraph (single batch query)
    // This replaces N individual RPC calls with 1 subgraph query
    const factories = await fetchVaultFactories(verifiedVaultAddresses.value)

    // Separate EVK vaults from Securitize vaults based on factory
    const evkAddresses: string[] = []
    const securitizeAddresses: string[] = []

    verifiedVaultAddresses.value.forEach((addr) => {
      const normalizedAddr = addr.toLowerCase()
      const factory = factories.get(normalizedAddr)

      if (factory?.toLowerCase() === SECURITIZE_FACTORY_ADDRESS.toLowerCase()) {
        // Securitize vault - use original case from verifiedVaultAddresses
        securitizeAddresses.push(addr)
      }
      else {
        // EVK vault (or unknown factory - treat as EVK to be safe)
        evkAddresses.push(addr)
      }
    })

    // Step 2: Fetch vaults in parallel with pre-categorized addresses
    // Each update function directly populates the registry
    await Promise.all([
      updateEarnVaults(),
      updateVaults(evkAddresses),
      updateEscrowVaults(),
      updateSecuritizeVaults(securitizeAddresses),
    ])

    // Set loading flags to false AFTER all vaults are loaded
    // This ensures consumers waiting on these flags can safely access the registry
    isEarnUpdating.value = false
    isEscrowUpdating.value = false

    // Set isEscrowLoadedOnce AFTER registry is populated, so that consumers
    // waiting on this flag can safely check the registry
    isEscrowLoadedOnce.value = true
  }
  finally {
    if (chainId.value === startChainId) {
      isReady.value = true
      loadedChainId.value = startChainId
    }
  }
}
const getVault = async (address: string): Promise<Vault> => {
  const { verifiedVaultAddresses } = useEulerLabels()
  const { getType, getVault: registryGetVault, has: registryHas, set: registrySet } = useVaultRegistry()
  const normalizedAddress = ethers.getAddress(address)

  // Check if this is a securitize vault - if so, throw to trigger fallback
  const vaultType = getType(normalizedAddress)
  if (vaultType === 'securitize') {
    throw new Error('[getVault] Address is a securitize vault, use getSecuritizeVault instead')
  }

  // If vault is already in registry as EVK, return it directly
  // This prevents overwriting escrow vaults (which have verified: true) with fetchVault results
  if (vaultType === 'evk') {
    return registryGetVault(normalizedAddress) as Vault
  }

  // If still no type info and address is in verifiedVaultAddresses but not in registry,
  // do an async check to avoid infinite wait on securitize vaults
  if (
    !vaultType
    && verifiedVaultAddresses.value.includes(normalizedAddress)
    && !registryHas(normalizedAddress)
  ) {
    const isSecuritize = await isSecuritizeVault(normalizedAddress)
    if (isSecuritize) {
      throw new Error('[getVault] Address is a securitize vault, use getSecuritizeVault instead')
    }
  }

  if (verifiedVaultAddresses.value.includes(normalizedAddress)) {
    await until(computed(() => registryGetVault(normalizedAddress))).toBeTruthy()
  }
  else {
    const vault = await fetchVault(normalizedAddress)
    registrySet(normalizedAddress, vault, 'evk')
    return vault
  }

  return registryGetVault(normalizedAddress) as Vault
}
const getEarnVault = async (address: string): Promise<EarnVault> => {
  const { getEarnVaults, getVault: registryGetVault, set: registrySet } = useVaultRegistry()
  const normalizedAddress = ethers.getAddress(address)

  // Wait for earn vaults to be loaded
  await until(computed(() => getEarnVaults().length > 0)).toBeTruthy()

  if (labelsRepo !== 'euler-xyz/euler-labels') {
    const { earnVaults } = useEulerLabels()

    if (Object.keys(earnVaults).includes(normalizedAddress)) {
      await until(computed(() => registryGetVault(normalizedAddress))).toBeTruthy()
    }
    else {
      const vault = await fetchEarnVault(normalizedAddress)
      registrySet(normalizedAddress, vault, 'earn')
      return vault
    }
  }

  const existingVault = registryGetVault(normalizedAddress)
  if (existingVault) {
    return existingVault as EarnVault
  }

  const vault = await fetchEarnVault(normalizedAddress)
  registrySet(normalizedAddress, vault, 'earn')
  return vault
}
const updateVault = async (vaultAddress: string): Promise<Vault> => {
  const { set: registrySet } = useVaultRegistry()
  const address = ethers.getAddress(vaultAddress)
  const vault = await fetchVault(address)
  registrySet(address, vault, 'evk')
  return vault
}
const updateEarnVault = async (vaultAddress: string): Promise<EarnVault> => {
  const { set: registrySet } = useVaultRegistry()
  const address = ethers.getAddress(vaultAddress)
  const vault = await fetchEarnVault(address)
  registrySet(address, vault, 'earn')
  return vault
}

const getEscrowVault = async (address: string): Promise<EscrowVault> => {
  const { getEscrowVaults, getVault: registryGetVault, isEscrowVault: registryIsEscrow, set: registrySet } = useVaultRegistry()
  const normalizedAddress = ethers.getAddress(address)

  // Wait for escrow vaults to be loaded
  await until(computed(() => getEscrowVaults().length > 0)).toBeTruthy()

  if (registryIsEscrow(normalizedAddress)) {
    return registryGetVault(normalizedAddress) as EscrowVault
  }
  else {
    const vault = await fetchEscrowVault(normalizedAddress)
    registrySet(normalizedAddress, vault, 'evk')
    return vault
  }
}

const updateEscrowVault = async (vaultAddress: string): Promise<EscrowVault> => {
  const { set: registrySet } = useVaultRegistry()
  const address = ethers.getAddress(vaultAddress)
  const vault = await fetchEscrowVault(address)
  registrySet(address, vault, 'evk')
  return vault
}

const getSecuritizeVault = async (address: string): Promise<SecuritizeVault> => {
  const normalizedAddress = ethers.getAddress(address)
  const { getVault: registryGetVault, getType, set: registrySet } = useVaultRegistry()

  if (getType(normalizedAddress) === 'securitize') {
    return registryGetVault(normalizedAddress) as SecuritizeVault
  }

  const vault = await fetchSecuritizeVault(normalizedAddress)
  registrySet(normalizedAddress, vault, 'securitize')
  return vault
}

const getBorrowVaultPair = async (
  collateralAddress: string,
  borrowAddress: string,
): Promise<AnyBorrowVaultPair> => {
  const {
    getVault: registryGetVault,
    getType,
    isEscrowVault: registryIsEscrow,
    set: registrySet,
  } = useVaultRegistry()
  const collateralAddr = ethers.getAddress(collateralAddress)
  const borrowAddr = ethers.getAddress(borrowAddress)

  // Wait for escrow vaults to load before checking registry
  if (!isEscrowLoadedOnce.value) {
    await until(isEscrowLoadedOnce).toBe(true)
  }

  const borrowType = getType(borrowAddr)
  if (borrowType === 'evk') {
    const borrowVault = registryGetVault(borrowAddr) as Vault
    const collateralType = getType(collateralAddr)

    if (collateralType === 'evk' || collateralType === 'securitize') {
      const collateralVault = registryGetVault(collateralAddr)!
      const ltv = borrowVault.collateralLTVs.find(c => c.collateral === collateralAddr)

      if (!ltv) {
        const vaultTypeLabel = collateralType === 'securitize' ? 'securitize vault' : (registryIsEscrow(collateralAddr) ? 'escrow vault' : 'vault')
        throw `[getBorrowVaultPair]: Collateral LTV not found for ${vaultTypeLabel}`
      }

      return {
        borrow: borrowVault,
        collateral: collateralVault,
        borrowLTV: ltv.borrowLTV,
        liquidationLTV: ltv.liquidationLTV,
        initialLiquidationLTV: ltv.initialLiquidationLTV,
        targetTimestamp: ltv.targetTimestamp,
        rampDuration: ltv.rampDuration,
      } as AnyBorrowVaultPair
    }
  }

  // Fallback: fetch borrow vault if not in registry
  const borrowVault = await fetchVault(borrowAddr)
  if (!borrowVault) {
    throw '[getBorrowVaultPair]: Borrow vault not found'
  }

  const collateralLTV = borrowVault.collateralLTVs.find(c => c.collateral === collateralAddr)
  if (!collateralLTV) {
    throw '[getBorrowVaultPair]: Collateral not configured for this borrow vault'
  }

  // Check collateral type from registry
  const collateralType = getType(collateralAddr)
  let collateralVault: Vault | EscrowVault | SecuritizeVault | undefined

  if (registryIsEscrow(collateralAddr)) {
    collateralVault = await getEscrowVault(collateralAddr)
  }
  else if (collateralType === 'securitize') {
    collateralVault = registryGetVault(collateralAddr) as SecuritizeVault
  }
  else {
    try {
      collateralVault = await fetchVault(collateralAddr)
    }
    catch {
      // Try escrow vault first
      try {
        collateralVault = await fetchEscrowVault(collateralAddr)
      }
      catch {
        // Check if it's a securitize vault
        const isSecuritize = await isSecuritizeVault(collateralAddr)
        if (isSecuritize) {
          collateralVault = await fetchSecuritizeVault(collateralAddr)
          // Add to registry so balances can be fetched
          registrySet(collateralAddr, collateralVault, 'securitize')
        }
        else {
          throw '[getBorrowVaultPair]: Failed to fetch collateral vault'
        }
      }
    }
  }

  return {
    borrow: borrowVault,
    collateral: collateralVault,
    borrowLTV: collateralLTV.borrowLTV,
    liquidationLTV: collateralLTV.liquidationLTV,
    initialLiquidationLTV: collateralLTV.initialLiquidationLTV,
    targetTimestamp: collateralLTV.targetTimestamp,
    rampDuration: collateralLTV.rampDuration,
  } as AnyBorrowVaultPair
}

export const useVaults = () => {
  // Check if vault's on-chain governorAdmin matches any of the product's declared entities
  const isVaultGovernorVerified = (vault: Vault): boolean => {
    const { entities } = useEulerLabels()

    // Escrow vaults don't have a risk manager - show "-" not "Unknown"
    if ('type' in vault && (vault as { type: string }).type === 'escrow') {
      return true
    }

    // Unverified vaults (not in products.json) show unknown risk manager
    if (!vault.verified) {
      return false
    }

    const product = getProductByVault(vault.address)
    if (!product.name) {
      // Vault marked verified but not in products.json - shouldn't happen, but treat as unknown
      return false
    }

    const declaredEntityKeys = Array.isArray(product.entity) ? product.entity : [product.entity].filter(Boolean)
    if (declaredEntityKeys.length === 0) {
      // No entities declared in product, nothing to verify against
      return true
    }

    // Check if governorAdmin matches any address in any of the declared entities
    for (const entityKey of declaredEntityKeys) {
      const entity = entities[entityKey]
      if (entity && Object.keys(entity.addresses).includes(vault.governorAdmin)) {
        return true
      }
    }

    return false
  }

  // Check if earn vault's on-chain owner matches any of the product's declared entities
  const isEarnVaultOwnerVerified = (earnVault: EarnVault): boolean => {
    const { entities } = useEulerLabels()

    const product = getProductByVault(earnVault.address)
    if (!product.name) {
      return true
    }

    const declaredEntityKeys = Array.isArray(product.entity) ? product.entity : [product.entity].filter(Boolean)
    if (declaredEntityKeys.length === 0) {
      return true
    }

    const ownerAddress = ethers.getAddress(earnVault.owner)
    for (const entityKey of declaredEntityKeys) {
      const entity = entities[entityKey]
      if (entity && Object.keys(entity.addresses).includes(ownerAddress)) {
        return true
      }
    }

    return false
  }

  return {
    // State
    isReady,
    loadedChainId,
    isLoading,
    isUpdating,
    isEarnLoading,
    isEarnUpdating,
    isEscrowLoading,
    isEscrowUpdating,
    isEscrowLoadedOnce,

    // Loading
    loadVaults,
    resetVaultsState,

    // Async getters (with wait-for-load logic)
    getVault,
    getEarnVault,
    getEscrowVault,
    getSecuritizeVault,
    getBorrowVaultPair,

    // Update single vault
    updateVault,
    updateEarnVault,
    updateEscrowVault,

    // Bulk updates (internal use)
    updateVaults,
    updateEarnVaults,
    updateEscrowVaults,

    // Verification
    isSecuritizeVault,
    isVaultGovernorVerified,
    isEarnVaultOwnerVerified,

    // Business logic computed (kept for complex queries)
    borrowList,
  }
}
