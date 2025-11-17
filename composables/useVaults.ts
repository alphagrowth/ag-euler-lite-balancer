import { ethers } from 'ethers'
import {
  type BorrowVaultPair, fetchVault,
  fetchVaults, getBorrowVaultPairByMapAndAddresses,
  getBorrowVaultsByMap,
  type Vault,
} from '~/entities/vault'

const { chainId } = useEulerAddresses()
const isReady = ref(false)
const isLoading = ref(false)
const isUpdating = ref(false)
const map: Ref<Map<string, Vault>> = shallowRef(new Map())

const list = computed(() => [...map.value.values()])
const borrowList = computed(() => getBorrowVaultsByMap(map.value).filter(pair => pair.borrow.supply > 0n))

const updateVaults = async () => {
  try {
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
const loadVaults = async () => {
  try {
    await updateVaults()
  }
  finally {
    isReady.value = true
  }
}
const getVault = async (address: string): Promise<Vault> => {
  if (!map.value.get(ethers.getAddress(address))) {
    await until(isReady).toBe(true)
  }
  return map.value.get(ethers.getAddress(address))!
}
const updateVault = async (vaultAddress: string): Promise<Vault> => {
  const address = ethers.getAddress(vaultAddress)
  const vault = await fetchVault(address)
  map.value.set(address, vault)
  return vault
}
const getBorrowVaultPair = async (collateralAddress: string, borrowAddress: string): Promise<BorrowVaultPair> => {
  if (!getBorrowVaultPairByMapAndAddresses(map.value, collateralAddress, borrowAddress)) {
    await until(isReady).toBe(true)
  }
  return getBorrowVaultPairByMapAndAddresses(map.value, collateralAddress, borrowAddress)
}

watch(chainId, (val, oldVal) => {
  updateVaults()
}, { immediate: true })

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
