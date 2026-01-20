/* eslint-disable @typescript-eslint/no-dynamic-delete */
import axios from 'axios'
import { ethers } from 'ethers'
import {
  type EulerLabelEntity,
  type EulerLabelProduct, eulerLabelProductEmpty,
  type EulerLabelVault,
  type EulerLabelPoint,
  type EulerLabelPointReward,
} from '~/entities/euler/labels'
import type { EarnVault } from '~/entities/vault'
import { labelsRepo } from '~/entities/custom'

const isLoading = ref(false)

const vaults: Record<string, EulerLabelVault> = shallowReactive({})
const products: Record<string, EulerLabelProduct> = shallowReactive({})
const entities: Record<string, EulerLabelEntity> = shallowReactive({})
const points: Record<string, EulerLabelPointReward[]> = shallowReactive({})
const earnVaults: Ref<string[]> = ref([]) // string of earn vault addresses

const eulerLabelVaultEmpty = {
  name: '',
  description: '',
  entity: '',
} as EulerLabelVault

const normalizeAddress = (address: string) => {
  try {
    return ethers.getAddress(address)
  }
  catch {
    return address.toLowerCase()
  }
}

const normalizeVaults = (data: Record<string, EulerLabelVault>) => {
  const normalized: Record<string, EulerLabelVault> = {}
  Object.entries(data).forEach(([address, vault]) => {
    normalized[normalizeAddress(address)] = vault
  })
  return normalized
}

const normalizeProducts = (data: Record<string, EulerLabelProduct>) => {
  const normalized: Record<string, EulerLabelProduct> = {}
  Object.entries(data).forEach(([key, product]) => {
    normalized[key] = {
      ...product,
      vaults: product.vaults.map(normalizeAddress),
    }
  })
  return normalized
}

const normalizeEntities = (data: Record<string, EulerLabelEntity>) => {
  const normalized: Record<string, EulerLabelEntity> = {}
  Object.entries(data).forEach(([key, entity]) => {
    const normalizedAddresses: Record<string, string> = {}
    Object.entries(entity.addresses || {}).forEach(([address, label]) => {
      normalizedAddresses[normalizeAddress(address)] = label
    })
    normalized[key] = {
      ...entity,
      addresses: normalizedAddresses,
    }
  })
  return normalized
}

const getVaultLabelByAddress = (vaultAddress: string) => {
  const normalized = normalizeAddress(vaultAddress)
  return vaults[normalized] || eulerLabelVaultEmpty
}

export const useEulerLabels = () => {
  const {
    getEulerLabelsVaultsUrl,
    getEulerLabelsProductsUrl,
    getEulerLabelsEntitiesUrl,
    getEulerLabelsEarnVaultsUrl,
    getEulerLabelsPointsUrl,
  } = useEulerConfig()

  const loadLabels = async () => {
    try {
      isLoading.value = true
      const { getCurrentChainConfig, loadEulerConfig } = useEulerAddresses()

      if (!getCurrentChainConfig.value) {
        loadEulerConfig()
      }
      await until(getCurrentChainConfig).toBeTruthy()

      Object.keys(vaults).forEach(key => delete vaults[key])
      Object.keys(products).forEach(key => delete products[key])
      Object.keys(entities).forEach(key => delete entities[key])
      Object.keys(points).forEach(key => delete points[key])
      earnVaults.value = []

      const [vaultsRes, productRes, entitiesRes, pointsRes] = await Promise.all([
        axios.get(getEulerLabelsVaultsUrl(getCurrentChainConfig.value!.chainId)),
        axios.get(getEulerLabelsProductsUrl(getCurrentChainConfig.value!.chainId)),
        axios.get(getEulerLabelsEntitiesUrl(getCurrentChainConfig.value!.chainId)),
        axios.get(getEulerLabelsPointsUrl(getCurrentChainConfig.value!.chainId)),
      ])

      if (labelsRepo !== 'euler-xyz/euler-labels') {
        const earnRes = await axios.get(getEulerLabelsEarnVaultsUrl(getCurrentChainConfig.value!.chainId))
        earnVaults.value = earnRes.data.map(normalizeAddress)
      }

      Object.assign(vaults, normalizeVaults(vaultsRes.data))
      Object.assign(products, normalizeProducts(productRes.data))
      Object.assign(entities, normalizeEntities(entitiesRes.data))

      const pointsData = pointsRes.data as EulerLabelPoint[]
      pointsData.forEach((point) => {
        if (!point.collateralVaults || point.isTurtleClub) {
          return
        }

        point.collateralVaults.forEach((vaultAddress) => {
          const normalized = normalizeAddress(vaultAddress)
          if (!points[normalized]) {
            points[normalized] = []
          }
          points[normalized].push({
            name: point.name,
            logo: point.logo,
          })
        })
      })
    }
    catch (e) {
      console.warn(e)
    }
    finally {
      isLoading.value = false
    }
  }

  return {
    isLoading,
    vaults,
    products,
    entities,
    points,
    earnVaults,
    loadLabels,
  }
}

export const getProductByVault = (vaultAddress: string) => {
  const normalized = normalizeAddress(vaultAddress)
  return Object.values(products).find(product => product.vaults.includes(normalized))
    || eulerLabelProductEmpty
}

export const getEntitiesByVault = (vaultAddress: string) => {
  const arr: EulerLabelEntity[] = []
  let entityKeys = getVaultLabelByAddress(vaultAddress)?.entity
  if (!Array.isArray(entityKeys)) {
    entityKeys = [entityKeys]
  }
  entityKeys.forEach((key) => {
    if (entities[key]) {
      arr.push(entities[key])
    }
  })
  return arr
}

export const getEntitiesByEarnVault = (earnVault: EarnVault) => {
  const arr: EulerLabelEntity[] = []
  const ownerAddress = normalizeAddress(earnVault.owner)

  Object.values(entities).forEach((entity) => {
    if (entity.addresses && Object.keys(entity.addresses).includes(ownerAddress)) {
      arr.push(entity)
    }
  })

  return arr
}

export const useEulerProductOfVault = (vaultAddress: string | Ref<string>) => {
  return toReactive(computed(() => getProductByVault(unref(vaultAddress))))
}

export const useEulerVaultLabelOfVault = (vaultAddress: string | Ref<string>) => {
  return toReactive(computed(() => getVaultLabelByAddress(unref(vaultAddress))))
}

export const useEulerEntitiesOfVault = (vaultAddress: string | Ref<string>) => {
  return toReactive(computed(() => getEntitiesByVault(unref(vaultAddress))))
}

export const useEulerEntitiesOfEarnVault = (earnVault: EarnVault | Ref<EarnVault>) => {
  return toReactive(computed(() => getEntitiesByEarnVault(unref(earnVault))))
}

export const getPointsByVault = (vaultAddress: string) => {
  return points[normalizeAddress(vaultAddress)] || []
}

export const useEulerPointsOfVault = (vaultAddress: string | Ref<string>) => {
  return toReactive(computed(() => getPointsByVault(unref(vaultAddress))))
}
