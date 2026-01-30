import { ethers } from 'ethers'
import { useVaultRegistry, type AnyVault, type VaultType } from './useVaultRegistry'
import {
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
const escrowMap: Ref<Map<string, EscrowVault>> = shallowRef(new Map())

const securitizeMap: Ref<Map<string, SecuritizeVault>> = shallowRef(new Map())

const list = computed(() => [...map.value.values()])
const earnList = computed(() => [...earnMap.value.values()])
const escrowList = computed(() => [...escrowMap.value.values()])
const borrowList = computed(() => getBorrowVaultsByMap(map.value))

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
): Promise<BorrowVaultPair> => {
  const collateralAddr = ethers.getAddress(collateralAddress)
  const borrowAddr = ethers.getAddress(borrowAddress)

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

  let collateralVault
  if (escrowMap.value.has(collateralAddr)) {
    collateralVault = await getEscrowVault(collateralAddr)
  }
  else if (securitizeMap.value.has(collateralAddr)) {
    // This is a securitize vault - redirect to securitize borrow page
    throw '[getBorrowVaultPair]: Collateral is a securitize vault, use getSecuritizeBorrowVaultPair instead'
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
          throw '[getBorrowVaultPair]: Collateral is a securitize vault, use getSecuritizeBorrowVaultPair instead'
        }
        // Re-throw original error
        throw '[getBorrowVaultPair]: Failed to fetch collateral vault'
      }
    }
  }

  return {
    borrow: borrowVault,
    collateral: collateralVault,
    borrowLTV: collateralLTV.borrowLTV,
    liquidationLTV: collateralLTV.liquidationLTV,
    initialLiquidationLTV: collateralLTV.initialLiquidationLTV,
  }
}

const getSecuritizeBorrowVaultPair = async (
  collateralAddress: string,
  borrowAddress: string,
): Promise<SecuritizeBorrowVaultPair> => {
  const collateralAddr = ethers.getAddress(collateralAddress)
  const borrowAddr = ethers.getAddress(borrowAddress)

  // Get or fetch the borrow vault (must be EVK)
  let borrowVault = map.value.get(borrowAddr)
  if (!borrowVault) {
    borrowVault = await fetchVault(borrowAddr)
  }
  if (!borrowVault) {
    throw '[getSecuritizeBorrowVaultPair]: Borrow vault not found'
  }

  // Check collateral LTV exists for this securitize vault
  const collateralLTV = borrowVault.collateralLTVs.find(c => c.collateral === collateralAddr)
  if (!collateralLTV) {
    throw '[getSecuritizeBorrowVaultPair]: Securitize collateral not configured for this borrow vault'
  }

  // Get or fetch the securitize collateral vault
  const collateralVault = await getSecuritizeVault(collateralAddr)

  return {
    borrow: borrowVault,
    collateral: collateralVault,
    borrowLTV: collateralLTV.borrowLTV,
    liquidationLTV: collateralLTV.liquidationLTV,
    initialLiquidationLTV: collateralLTV.initialLiquidationLTV,
  }
}

export const useVaults = () => {
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
    loadVaults,
    resetVaultsState,
    updateVault,
    updateEarnVault,
    updateEscrowVault,
    updateVaults,
    updateEarnVaults,
    updateEscrowVaults,
    getBorrowVaultPair,
    getSecuritizeBorrowVaultPair,
    earnMap,
    earnList,
    isEarnLoading,
    isEarnUpdating,
    escrowMap,
    escrowList,
    isEscrowLoading,
    isEscrowUpdating,
    securitizeMap,
    securitizeBorrowList,
  }
}
