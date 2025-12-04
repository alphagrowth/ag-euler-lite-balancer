/* eslint-disable @typescript-eslint/no-dynamic-delete */
import axios from 'axios'
import {
  type EulerLabelEntity,
  type EulerLabelProduct, eulerLabelProductEmpty,
  type EulerLabelVault,
} from '~/entities/euler/labels'

const isLoading = ref(false)

const vaults: Record<string, EulerLabelVault> = shallowReactive({})
const products: Record<string, EulerLabelProduct> = shallowReactive({})
const entities: Record<string, EulerLabelEntity> = shallowReactive({})

export const useEulerLabels = () => {
  const { getEulerLabelsVaultsUrl, getEulerLabelsProductsUrl, getEulerLabelsEntitiesUrl } = useEulerConfig()

  const loadLabels = async () => {
    try {
      isLoading.value = true
      const { getCurrentChainConfig } = useEulerAddresses()

      await until(getCurrentChainConfig).toBeTruthy()

      Object.keys(vaults).forEach(key => delete vaults[key])
      Object.keys(products).forEach(key => delete products[key])
      Object.keys(entities).forEach(key => delete entities[key])

      const [vaultsRes, productRes, entitiesRes] = await Promise.all([
        axios.get(getEulerLabelsVaultsUrl(getCurrentChainConfig.value!.chainId)),
        axios.get(getEulerLabelsProductsUrl(getCurrentChainConfig.value!.chainId)),
        axios.get(getEulerLabelsEntitiesUrl(getCurrentChainConfig.value!.chainId)),
      ])

      Object.assign(vaults, vaultsRes.data)
      Object.assign(products, productRes.data)
      Object.assign(entities, entitiesRes.data)
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
    loadLabels,
  }
}

const getProductByVault = (vaultAddress: string) => {
  return Object.values(products).find(product => product.vaults.includes(vaultAddress))
    || eulerLabelProductEmpty
}

const getEntitiesByVault = (vaultAddress: string) => {
  const arr: EulerLabelEntity[] = []
  let entityKeys = vaults?.[vaultAddress]?.entity
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

export const useEulerProductOfVault = (vaultAddress: string | Ref<string>) => {
  return toReactive(computed(() => getProductByVault(unref(vaultAddress))))
}

export const useEulerEntitiesOfVault = (vaultAddress: string | Ref<string>) => {
  return toReactive(computed(() => getEntitiesByVault(unref(vaultAddress))))
}
