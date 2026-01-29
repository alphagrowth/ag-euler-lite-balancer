/* eslint-disable @typescript-eslint/no-dynamic-delete */
import axios from 'axios'
import { ethers } from 'ethers'
import {
  type EulerLabelEntity,
  type EulerLabelProduct, eulerLabelProductEmpty,
  type EulerLabelPoint,
  type EulerLabelPointReward,
} from '~/entities/euler/labels'
import type { EarnVault } from '~/entities/vault'
import { labelsRepo } from '~/entities/custom'

const getLabelsUrl = (chainId: number, file: string) =>
  `https://raw.githubusercontent.com/${labelsRepo}/refs/heads/master/${chainId}/${file}`

const isLoading = ref(false)

const products: Record<string, EulerLabelProduct> = shallowReactive({})
const entities: Record<string, EulerLabelEntity> = shallowReactive({})
const points: Record<string, EulerLabelPointReward[]> = shallowReactive({})
const earnVaults: Ref<string[]> = ref([]) // string of earn vault addresses
// Derived from products - all unique vault addresses across all products
const verifiedVaultAddresses: Ref<string[]> = ref([])

const normalizeAddress = (address: string) => {
  try {
    return ethers.getAddress(address)
  }
  catch {
    return address.toLowerCase()
  }
}

const normalizeProducts = (data: Record<string, EulerLabelProduct>): { products: Record<string, EulerLabelProduct>, vaultAddresses: string[] } => {
  const normalized: Record<string, EulerLabelProduct> = {}
  const allVaults = new Set<string>()
  Object.entries(data).forEach(([key, product]) => {
    const normalizedVaults = product.vaults.map(normalizeAddress)
    normalized[key] = {
      ...product,
      vaults: normalizedVaults,
    }
    normalizedVaults.forEach(v => allVaults.add(v))
  })
  return { products: normalized, vaultAddresses: [...allVaults] }
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

export const useEulerLabels = () => {
  const loadLabels = async () => {
    try {
      isLoading.value = true
      const { getCurrentChainConfig, loadEulerConfig } = useEulerAddresses()

      if (!getCurrentChainConfig.value) {
        loadEulerConfig()
      }
      await until(getCurrentChainConfig).toBeTruthy()

      Object.keys(products).forEach(key => delete products[key])
      Object.keys(entities).forEach(key => delete entities[key])
      Object.keys(points).forEach(key => delete points[key])
      earnVaults.value = []
      verifiedVaultAddresses.value = []

      const chainId = getCurrentChainConfig.value!.chainId

      const [productRes, entitiesRes, pointsRes] = await Promise.all([
        axios.get(getLabelsUrl(chainId, 'products.json')),
        axios.get(getLabelsUrl(chainId, 'entities.json')),
        axios.get(getLabelsUrl(chainId, 'points.json')),
      ])

      if (labelsRepo !== 'euler-xyz/euler-labels') {
        const earnRes = await axios.get(getLabelsUrl(chainId, 'earn-vaults.json'))
        earnVaults.value = earnRes.data.map(normalizeAddress)
      }

      const normalizedProducts = normalizeProducts(productRes.data)
      Object.assign(products, normalizedProducts.products)
      verifiedVaultAddresses.value = normalizedProducts.vaultAddresses
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
    verifiedVaultAddresses,
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
  const product = getProductByVault(vaultAddress)
  let entityKeys = product.entity
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
