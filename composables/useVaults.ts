import { ethers } from 'ethers'
import {
  type BorrowVaultPair, fetchVault,
  fetchVaults, getBorrowVaultPairByMapAndAddresses,
  getBorrowVaultsByMap,
  type Vault,
} from '~/entities/vault'

const isReady = ref(false)
const isLoading = ref(false)
const isUpdating = ref(false)
const map: Ref<Map<string, Vault>> = shallowRef(new Map())

const list = computed(() => [...map.value.values()])
const borrowList = computed(() => getBorrowVaultsByMap(map.value).filter(pair => pair.borrow.supply > 0n))

const updateVaults = async () => {
  try {
    isUpdating.value = true
    const res = await fetchVaults()
    map.value = new Map(res.map(i => [i.address, i]))
  }
  finally {
    isUpdating.value = false
  }
}
const loadVaults = async () => {
  try {
    isReady.value = false
    isLoading.value = true
    await updateVaults()
  }
  finally {
    isReady.value = true
    isLoading.value = false
  }
}
const getVault = async (address: string): Promise<Vault> => {
  await until(isReady).toBe(true)
  return map.value.get(ethers.getAddress(address))!
}
const updateVault = async (vaultAddress: string): Promise<Vault> => {
  const address = ethers.getAddress(vaultAddress)
  const vault = await fetchVault(address)
  map.value.set(address, vault)
  return vault
}
const getBorrowVaultPair = async (collateralAddress: string, borrowAddress: string): Promise<BorrowVaultPair> => {
  await until(isReady).toBe(true)
  return getBorrowVaultPairByMapAndAddresses(map.value, collateralAddress, borrowAddress)
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
    loadVaults,
    updateVault,
    updateVaults,
    getBorrowVaultPair,
  }
}
