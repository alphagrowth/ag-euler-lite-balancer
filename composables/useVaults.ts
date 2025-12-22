import { ethers } from 'ethers'
import {
  type BorrowVaultPair,
  type EarnVault,
  fetchEarnVaults,
  fetchVault,
  fetchEarnVault,
  fetchVaults,
  getBorrowVaultPairByMapAndAddresses,
  getBorrowVaultsByMap,
  type Vault,
  type VaultCollateralLTV,
} from '~/entities/vault'

const isReady = ref(false)
const isLoading = ref(false)
const isUpdating = ref(false)
const map: Ref<Map<string, Vault>> = shallowRef(new Map())

const isEarnLoading = ref(false)
const isEarnUpdating = ref(false)
const earnMap: Ref<Map<string, EarnVault>> = shallowRef(new Map())

const list = computed(() => [...map.value.values()])
const earnList = computed(() => [...earnMap.value.values()])
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
const loadVaults = async () => {
  try {
    isReady.value = false
    map.value = new Map()
    earnMap.value = new Map()
    await Promise.all([
      updateEarnVaults(),
      updateVaults(),
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
  // TODO: support earnVaults.json when ready
  // const { earnVaults } = useEulerLabels()

  await until(computed(() => earnMap.value.get(ethers.getAddress(address)))).toBeTruthy()

  return earnMap.value.get(ethers.getAddress(address)) || fetchEarnVault(address)
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
const getBorrowVaultPair = async (collateralAddress: string, borrowAddress: string): Promise<BorrowVaultPair> => {
  if (map.value.has(borrowAddress)) {
    return getBorrowVaultPairByMapAndAddresses(map.value, collateralAddress, borrowAddress)
  }
  else {
    let obj: BorrowVaultPair | undefined = undefined
    const borrowVault = await fetchVault(borrowAddress)
    if (!borrowVault) {
      throw '[getBorrowVaultPairByMapAndAddresses]: Borrow vault not found'
    }
    let collateralLTV: VaultCollateralLTV
    let collateralLTVAddr: string

    borrowVault.collateralLTVs.forEach((c) => {
      if (c.collateral !== collateralAddress) {
        return
      }
      collateralLTV = c
      collateralLTVAddr = c.collateral
    })

    const cVault = await fetchVault(collateralLTVAddr!)
    obj = {
      borrow: borrowVault,
      collateral: cVault,
      borrowLTV: collateralLTV!.borrowLTV,
      liquidationLTV: collateralLTV!.liquidationLTV,
      initialLiquidationLTV: collateralLTV!.initialLiquidationLTV,
    } as BorrowVaultPair

    if (!obj) {
      throw '[getBorrowVaultPairByMapAndAddresses]: Vault pair not found'
    }

    return obj
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
    loadVaults,
    updateVault,
    updateEarnVault,
    updateVaults,
    getBorrowVaultPair,
    earnMap,
    earnList,
    isEarnLoading,
    isEarnUpdating,
    updateEarnVaults,
  }
}
