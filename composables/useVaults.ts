import { ethers } from 'ethers'
import { useVaultRegistry, type AnyVault, type VaultType } from './useVaultRegistry'
import {
  type AnyBorrowVaultPair,
  type BorrowVaultPair,
  type EarnVault,
  type EscrowVault,
  type SecuritizeBorrowVaultPair,
  type SecuritizeVault,
  fetchEarnVaults,
  fetchVault,
  fetchEarnVault,
  fetchEscrowVault,
  fetchEscrowVaults,
  fetchSecuritizeVault,
  fetchVaults,
  fetchVaultFactories,
  getBorrowVaultPairByMapAndAddresses,
  getBorrowVaultsByMap,
  isSecuritizeVault,
  SECURITIZE_FACTORY_ADDRESS,
  type Vault,
} from '~/entities/vault'
import { labelsRepo } from '~/entities/custom'
import { getProductByVault } from '~/composables/useEulerLabels'

const isReady = ref(false)
const isLoading = ref(false)
const isUpdating = ref(false)
const map: Ref<Map<string, Vault>> = shallowRef(new Map())

const isEarnLoading = ref(false)
const isEarnUpdating = ref(false)
const earnMap: Ref<Map<string, EarnVault>> = shallowRef(new Map())
const loadedChainId = ref<number | null>(null)

const isEscrowLoading = ref(false)
const isEscrowUpdating = ref(false)
const isEscrowLoadedOnce = ref(false)
const escrowMap: Ref<Map<string, EscrowVault>> = shallowRef(new Map())

const securitizeMap: Ref<Map<string, SecuritizeVault>> = shallowRef(new Map())

const list = computed(() => [...map.value.values()])
const earnList = computed(() => [...earnMap.value.values()])
const escrowList = computed(() => [...escrowMap.value.values()])
const combinedVaultMap = computed(() => {
  const combined = new Map<string, Vault>(map.value)
  escrowMap.value.forEach((vault, address) => {
    combined.set(address, vault)
  })
  return combined
})
const borrowList = computed(() => getBorrowVaultsByMap(combinedVaultMap.value))

// Securitize borrow pairs - find EVK vaults that accept securitize vaults as collateral
const securitizeBorrowList = computed((): SecuritizeBorrowVaultPair[] => {
  const pairs: SecuritizeBorrowVaultPair[] = []
  const evkVaults = [...map.value.values()]
  const securitizeVaults = [...securitizeMap.value.values()]

  evkVaults.forEach((borrowVault) => {
    borrowVault.collateralLTVs.forEach((ltv) => {
      if (ltv.borrowLTV <= 0n) return

      const securitizeCollateral = securitizeVaults.find(sv => sv.address === ltv.collateral)
      if (securitizeCollateral) {
        pairs.push({
          borrow: borrowVault,
          collateral: securitizeCollateral,
          borrowLTV: ltv.borrowLTV,
          liquidationLTV: ltv.liquidationLTV,
          initialLiquidationLTV: ltv.initialLiquidationLTV,
          targetTimestamp: ltv.targetTimestamp,
          rampDuration: ltv.rampDuration,
        })
      }
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
  escrowMap.value = new Map()
  map.value = new Map()
  earnMap.value = new Map()
  securitizeMap.value = new Map()
  loadedChainId.value = null
  clear() // Clear registry on reset
}

const updateVaults = async (vaultAddresses?: string[]) => {
  try {
    map.value = new Map()
    isUpdating.value = true
    isLoading.value = true
    const currentMap = new Map(map.value)

    for await (const result of fetchVaults(vaultAddresses)) {
      result.vaults.forEach((vault) => {
        currentMap.set(vault.address, vault)
      })

      map.value = new Map(currentMap)
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
  try {
    earnMap.value = new Map()
    isEarnUpdating.value = true
    isEarnLoading.value = true
    const currentMap = new Map(earnMap.value)

    for await (const result of fetchEarnVaults()) {
      result.vaults.forEach((vault) => {
        currentMap.set(vault.address, vault)
      })

      earnMap.value = new Map(currentMap)
      isEarnLoading.value = false

      if (result.isFinished) {
        break
      }
    }
  }
  finally {
    isEarnUpdating.value = false
  }
}

const updateEscrowVaults = async () => {
  try {
    escrowMap.value = new Map()
    isEscrowUpdating.value = true
    isEscrowLoading.value = true
    const currentMap = new Map(escrowMap.value)

    for await (const result of fetchEscrowVaults()) {
      result.vaults.forEach((vault) => {
        currentMap.set(vault.address, vault)
      })

      escrowMap.value = new Map(currentMap)
      isEscrowLoading.value = false

      if (result.isFinished) {
        break
      }
    }
  }
  finally {
    isEscrowUpdating.value = false
    isEscrowLoadedOnce.value = true
  }
}

const updateSecuritizeVaults = async (securitizeAddresses: string[]) => {
  if (!securitizeAddresses.length) {
    return
  }

  // Fetch securitize vault details
  const results = await Promise.allSettled(
    securitizeAddresses.map(addr => fetchSecuritizeVault(addr)),
  )

  results.forEach((result) => {
    if (result.status === 'fulfilled') {
      securitizeMap.value.set(result.value.address, result.value)
    }
  })

  // Trigger reactivity
  securitizeMap.value = new Map(securitizeMap.value)
}

const loadVaults = async () => {
  const { chainId } = useEulerAddresses()
  const { setMany } = useVaultRegistry()
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
    await Promise.all([
      updateEarnVaults(),
      updateVaults(evkAddresses),
      updateEscrowVaults(),
      updateSecuritizeVaults(securitizeAddresses),
    ])

    // Populate the unified registry with all loaded vaults
    const registryEntries: Array<{ address: string, vault: AnyVault, type: VaultType }> = []

    // Add EVK vaults
    map.value.forEach((vault, address) => {
      registryEntries.push({ address, vault, type: 'evk' })
    })

    // Add Escrow vaults
    escrowMap.value.forEach((vault, address) => {
      registryEntries.push({ address, vault, type: 'escrow' })
    })

    // Add Earn vaults
    earnMap.value.forEach((vault, address) => {
      registryEntries.push({ address, vault, type: 'earn' })
    })

    // Add Securitize vaults
    securitizeMap.value.forEach((vault, address) => {
      registryEntries.push({ address, vault, type: 'securitize' })
    })

    setMany(registryEntries)
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
  const { getType } = useVaultRegistry()
  const normalizedAddress = ethers.getAddress(address)

  // Check if this is a securitize vault - if so, throw to trigger fallback
  const vaultType = getType(normalizedAddress)
  if (vaultType === 'securitize') {
    throw new Error('[getVault] Address is a securitize vault, use getSecuritizeVault instead')
  }

  // If registry isn't populated yet, check securitizeMap directly or use async check
  if (!vaultType && securitizeMap.value.has(normalizedAddress)) {
    throw new Error('[getVault] Address is a securitize vault, use getSecuritizeVault instead')
  }

  // If still no type info and address is in verifiedVaultAddresses but not in map,
  // do an async check to avoid infinite wait on securitize vaults
  if (
    !vaultType
    && verifiedVaultAddresses.value.includes(normalizedAddress)
    && !map.value.has(normalizedAddress)
  ) {
    const isSecuritize = await isSecuritizeVault(normalizedAddress)
    if (isSecuritize) {
      throw new Error('[getVault] Address is a securitize vault, use getSecuritizeVault instead')
    }
  }

  if (verifiedVaultAddresses.value.includes(normalizedAddress)) {
    await until(computed(() => map.value.get(normalizedAddress))).toBeTruthy()
  }
  else {
    return fetchVault(normalizedAddress)
  }

  return map.value.get(normalizedAddress)!
}
const getEarnVault = async (address: string): Promise<EarnVault> => {
  await until(computed(() => earnMap.value.size)).toBeTruthy()

  if (labelsRepo !== 'euler-xyz/euler-labels') {
    const { earnVaults } = useEulerLabels()

    if (Object.keys(earnVaults).includes(ethers.getAddress(address))) {
      await until(computed(() => earnMap.value.get(ethers.getAddress(address)))).toBeTruthy()
    }
    else {
      return fetchEarnVault(ethers.getAddress(address))
    }
  }

  return earnMap.value.get(ethers.getAddress(address)) || fetchEarnVault(ethers.getAddress(address))
}
const updateVault = async (vaultAddress: string): Promise<Vault> => {
  const address = ethers.getAddress(vaultAddress)
  const vault = await fetchVault(address)
  map.value.set(address, vault)
  return vault
}
const updateEarnVault = async (vaultAddress: string): Promise<EarnVault> => {
  const address = ethers.getAddress(vaultAddress)
  const vault = await fetchEarnVault(address)
  earnMap.value.set(address, vault)
  return vault
}

const getEscrowVault = async (address: string): Promise<EscrowVault> => {
  await until(computed(() => escrowMap.value.size)).toBeTruthy()

  if (escrowMap.value.has(ethers.getAddress(address))) {
    return escrowMap.value.get(ethers.getAddress(address))!
  }
  else {
    return fetchEscrowVault(ethers.getAddress(address))
  }
}

const updateEscrowVault = async (vaultAddress: string): Promise<EscrowVault> => {
  const address = ethers.getAddress(vaultAddress)
  const vault = await fetchEscrowVault(address)
  escrowMap.value.set(address, vault)
  return vault
}

const getSecuritizeVault = async (address: string): Promise<SecuritizeVault> => {
  const normalizedAddress = ethers.getAddress(address)

  if (securitizeMap.value.has(normalizedAddress)) {
    return securitizeMap.value.get(normalizedAddress)!
  }

  const vault = await fetchSecuritizeVault(normalizedAddress)
  securitizeMap.value.set(normalizedAddress, vault)
  return vault
}

const getBorrowVaultPair = async (
  collateralAddress: string,
  borrowAddress: string,
): Promise<AnyBorrowVaultPair> => {
  const collateralAddr = ethers.getAddress(collateralAddress)
  const borrowAddr = ethers.getAddress(borrowAddress)

  // Wait for escrow vaults to load before checking escrowMap
  if (!isEscrowLoadedOnce.value) {
    await until(isEscrowLoadedOnce).toBe(true)
  }

  if (map.value.has(borrowAddr)) {
    if (map.value.has(collateralAddr)) {
      return getBorrowVaultPairByMapAndAddresses(map.value, collateralAddr, borrowAddr)
    }
    else if (escrowMap.value.has(collateralAddr)) {
      const borrowVault = map.value.get(borrowAddr)!
      const escrowVault = escrowMap.value.get(collateralAddr)!
      const ltv = borrowVault.collateralLTVs.find(c => c.collateral === collateralAddr)

      if (!ltv) {
        throw '[getBorrowVaultPair]: Collateral LTV not found for escrow vault'
      }

      return {
        borrow: borrowVault,
        collateral: escrowVault,
        borrowLTV: ltv.borrowLTV,
        liquidationLTV: ltv.liquidationLTV,
        initialLiquidationLTV: ltv.initialLiquidationLTV,
        targetTimestamp: ltv.targetTimestamp,
        rampDuration: ltv.rampDuration,
      }
    }
    else if (securitizeMap.value.has(collateralAddr)) {
      const borrowVault = map.value.get(borrowAddr)!
      const securitizeVault = securitizeMap.value.get(collateralAddr)!
      const ltv = borrowVault.collateralLTVs.find(c => c.collateral === collateralAddr)

      if (!ltv) {
        throw '[getBorrowVaultPair]: Collateral LTV not found for securitize vault'
      }

      return {
        borrow: borrowVault,
        collateral: securitizeVault,
        borrowLTV: ltv.borrowLTV,
        liquidationLTV: ltv.liquidationLTV,
        initialLiquidationLTV: ltv.initialLiquidationLTV,
        targetTimestamp: ltv.targetTimestamp,
        rampDuration: ltv.rampDuration,
      }
    }
  }

  const borrowVault = await fetchVault(borrowAddr)
  if (!borrowVault) {
    throw '[getBorrowVaultPair]: Borrow vault not found'
  }

  const collateralLTV = borrowVault.collateralLTVs.find(c => c.collateral === collateralAddr)
  if (!collateralLTV) {
    throw '[getBorrowVaultPair]: Collateral not configured for this borrow vault'
  }

  let collateralVault: Vault | EscrowVault | SecuritizeVault | undefined
  if (escrowMap.value.has(collateralAddr)) {
    collateralVault = await getEscrowVault(collateralAddr)
  }
  else if (securitizeMap.value.has(collateralAddr)) {
    collateralVault = securitizeMap.value.get(collateralAddr)!
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
          // Add to securitizeMap so balances can be fetched
          securitizeMap.value.set(collateralAddr, collateralVault)
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
    map,
    list,
    borrowList,
    isReady,
    loadedChainId,
    isLoading,
    isUpdating,
    getVault,
    getEarnVault,
    getEscrowVault,
    getSecuritizeVault,
    isSecuritizeVault,
    isVaultGovernorVerified,
    isEarnVaultOwnerVerified,
    loadVaults,
    resetVaultsState,
    updateVault,
    updateEarnVault,
    updateEscrowVault,
    updateVaults,
    updateEarnVaults,
    updateEscrowVaults,
    getBorrowVaultPair,
    earnMap,
    earnList,
    isEarnLoading,
    isEarnUpdating,
    escrowMap,
    escrowList,
    isEscrowLoading,
    isEscrowUpdating,
    isEscrowLoadedOnce,
    securitizeMap,
    securitizeBorrowList,
  }
}
