import { ethers } from 'ethers'
import {
  type BorrowVaultPair,
  type EarnVault,
  type EscrowVault,
  fetchEarnVaults,
  fetchVault,
  fetchEarnVault,
  fetchEscrowVault,
  fetchEscrowVaults,
  fetchVaults,
  getBorrowVaultPairByMapAndAddresses,
  getBorrowVaultsByMap,
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

const isEscrowLoading = ref(false)
const isEscrowUpdating = ref(false)
const escrowMap: Ref<Map<string, EscrowVault>> = shallowRef(new Map())

const list = computed(() => [...map.value.values()])
const earnList = computed(() => [...earnMap.value.values()])
const escrowList = computed(() => [...escrowMap.value.values()])
const borrowList = computed(() => getBorrowVaultsByMap(map.value).filter(pair => pair.borrow.supply > 0n))

const updateVaults = async () => {
  try {
    map.value = new Map()
    isUpdating.value = true
    isLoading.value = true
    const currentMap = new Map(map.value)

    for await (const result of fetchVaults()) {
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

const loadVaults = async () => {
  try {
    isReady.value = false
    map.value = new Map()
    earnMap.value = new Map()
    escrowMap.value = new Map()
    await Promise.all([
      updateEarnVaults(),
      updateVaults(),
      updateEscrowVaults(),
    ])
  }
  finally {
    isReady.value = true
  }
}
const getVault = async (address: string): Promise<Vault> => {
  const { vaults } = useEulerLabels()

  if (Object.keys(vaults).includes(ethers.getAddress(address))) {
    await until(computed(() => map.value.get(ethers.getAddress(address)))).toBeTruthy()
  }
  else {
    return fetchVault(ethers.getAddress(address))
  }

  return map.value.get(ethers.getAddress(address))!
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

const getBorrowVaultPair = async (collateralAddress: string, borrowAddress: string): Promise<BorrowVaultPair> => {
  const collateralAddr = ethers.getAddress(collateralAddress)
  const borrowAddr = ethers.getAddress(borrowAddress)

  // Try to use cached data if available
  if (map.value.has(borrowAddr)) {
    // Check if collateral is in regular map
    if (map.value.has(collateralAddr)) {
      return getBorrowVaultPairByMapAndAddresses(map.value, collateralAddr, borrowAddr)
    }
    // Check if collateral is in escrow map
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

  // Fetch if not in cache
  const borrowVault = await fetchVault(borrowAddr)
  if (!borrowVault) {
    throw '[getBorrowVaultPair]: Borrow vault not found'
  }

  const collateralLTV = borrowVault.collateralLTVs.find(c => c.collateral === collateralAddr)
  if (!collateralLTV) {
    throw '[getBorrowVaultPair]: Collateral not configured for this borrow vault'
  }

  // Check if collateral is an escrow vault
  let collateralVault
  if (escrowMap.value.has(collateralAddr)) {
    collateralVault = await getEscrowVault(collateralAddr)
  }
  else {
    // Try fetching as regular vault first, if it fails, try as escrow vault
    try {
      collateralVault = await fetchVault(collateralAddr)
    }
    catch {
      // Try as escrow vault
      collateralVault = await fetchEscrowVault(collateralAddr)
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

export const useVaults = () => {
  return {
    map,
    list,
    borrowList,
    isReady,
    isLoading,
    isUpdating,
    getVault,
    getEarnVault,
    getEscrowVault,
    loadVaults,
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
  }
}
