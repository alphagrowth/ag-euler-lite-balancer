import { ethers } from 'ethers'
import {
  type Vault,
  type EarnVault,
  type EscrowVault,
  type SecuritizeVault,
  fetchVault,
  fetchEarnVault,
  fetchEscrowVault,
  fetchSecuritizeVault,
  fetchVaultFactory,
  SECURITIZE_FACTORY_ADDRESS,
} from '~/entities/vault'

// Vault type enum
export type VaultType = 'evk' | 'earn' | 'escrow' | 'securitize'

// Union of all vault types
export type AnyVault = Vault | EarnVault | EscrowVault | SecuritizeVault

// Registry entry containing vault and its type
export interface VaultEntry {
  vault: AnyVault
  type: VaultType
}

// Registry state
const registry: Ref<Map<string, VaultEntry>> = shallowRef(new Map())
const isLoading = ref(false)

// Normalize address for consistent lookups
const normalizeAddress = (address: string): string => {
  return ethers.getAddress(address)
}

// Get vault entry from registry
const get = (address: string): VaultEntry | undefined => {
  return registry.value.get(normalizeAddress(address))
}

// Check if vault exists in registry
const has = (address: string): boolean => {
  return registry.value.has(normalizeAddress(address))
}

// Get just the vault (for backward compatibility)
const getVault = (address: string): AnyVault | undefined => {
  return get(address)?.vault
}

// Get just the type
const getType = (address: string): VaultType | undefined => {
  return get(address)?.type
}

// Register a vault
const set = (address: string, vault: AnyVault, type: VaultType): void => {
  const normalized = normalizeAddress(address)
  registry.value.set(normalized, { vault, type })
  registry.value = new Map(registry.value) // Trigger reactivity
}

// Register multiple vaults
const setMany = (entries: Array<{ address: string, vault: AnyVault, type: VaultType }>): void => {
  entries.forEach(({ address, vault, type }) => {
    registry.value.set(normalizeAddress(address), { vault, type })
  })
  registry.value = new Map(registry.value) // Trigger reactivity
}

// Clear registry (for chain switching)
const clear = (): void => {
  registry.value = new Map()
}

// Get all vaults of a specific type
const getByType = (type: VaultType): AnyVault[] => {
  return [...registry.value.values()]
    .filter(entry => entry.type === type)
    .map(entry => entry.vault)
}

// Get all entries
const getAll = (): VaultEntry[] => {
  return [...registry.value.values()]
}

/**
 * Detect vault type from factory address.
 *
 * Note: This is only called for vaults NOT already in the registry.
 * During loadVaults(), escrow vaults are loaded from escrowedCollateralPerspective
 * and registered as 'escrow'. Therefore, any unknown vault from the EVK factory
 * can be assumed to be 'evk' (not escrow) — if it were escrow, it would already
 * be in the registry.
 */
const detectVaultType = (factoryAddress: string): VaultType => {
  const { eulerCoreAddresses } = useEulerAddresses()

  const normalizedFactory = factoryAddress.toLowerCase()

  // Check Securitize factory (distinct factory)
  if (SECURITIZE_FACTORY_ADDRESS.toLowerCase() === normalizedFactory) {
    return 'securitize'
  }

  // Check Euler Earn factory (distinct factory)
  if (eulerCoreAddresses.value?.eulerEarnFactory?.toLowerCase() === normalizedFactory) {
    return 'earn'
  }

  // EVK factory or unknown factory → 'evk'
  // Note: Escrow vaults use the same EVK factory but are loaded from
  // escrowedCollateralPerspective during loadVaults(). Any unknown vault
  // from EVK factory is therefore a regular EVK vault, not escrow.
  return 'evk'
}

/**
 * Fetch vault using the appropriate fetch function based on type.
 */
const fetchVaultByType = async (address: string, type: VaultType): Promise<AnyVault> => {
  switch (type) {
    case 'earn':
      return await fetchEarnVault(address)
    case 'escrow':
      return await fetchEscrowVault(address)
    case 'securitize':
      return await fetchSecuritizeVault(address)
    case 'evk':
    default:
      return await fetchVault(address)
  }
}

/**
 * Resolve an unknown vault by querying subgraph for its factory,
 * detecting the type, fetching with appropriate lens, and caching in registry.
 */
const resolveUnknown = async (address: string): Promise<VaultEntry> => {
  const normalized = normalizeAddress(address)

  // Query subgraph for factory
  const factory = await fetchVaultFactory(normalized)

  if (!factory) {
    throw new Error(`Could not find factory for vault ${address}`)
  }

  // Detect type from factory
  const type = detectVaultType(factory)

  // Fetch vault with appropriate lens
  const vault = await fetchVaultByType(normalized, type)

  // Cache in registry
  set(normalized, vault, type)

  return { vault, type }
}

/**
 * Get vault from registry or resolve if unknown.
 * Main entry point for position loading in shouldShowAllPositions mode.
 */
const getOrResolve = async (address: string): Promise<VaultEntry | undefined> => {
  // Check registry first
  const existing = get(address)
  if (existing) {
    return existing
  }

  // Try to resolve unknown vault
  try {
    return await resolveUnknown(address)
  }
  catch (e) {
    console.warn(`Failed to resolve vault ${address}:`, e)
    return undefined
  }
}

export const useVaultRegistry = () => {
  return {
    // State
    registry,
    isLoading,

    // Basic operations
    get,
    has,
    getVault,
    getType,
    set,
    setMany,
    clear,

    // Queries
    getByType,
    getAll,

    // Type detection & fetching
    detectVaultType,
    fetchVaultByType,

    // Resolution
    resolveUnknown,
    getOrResolve,
  }
}
