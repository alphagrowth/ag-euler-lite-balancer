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
  const { getCurrentChainConfig } = useEulerAddresses()

  const loadLabels = async () => {
    try {
      isLoading.value = true
      const [vaultsRes, productRes, entitiesRes] = await Promise.all([
        axios.get(getEulerLabelsVaultsUrl(getCurrentChainConfig.value?.chainId || 1)),
        axios.get(getEulerLabelsProductsUrl(getCurrentChainConfig.value?.chainId || 1)),
        axios.get(getEulerLabelsEntitiesUrl(getCurrentChainConfig.value?.chainId || 1)),
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

  loadLabels()

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
