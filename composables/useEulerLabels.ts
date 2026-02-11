/* eslint-disable @typescript-eslint/no-dynamic-delete */
import axios from 'axios'
import { getAddress, type Address } from 'viem'
import {
  type EulerLabelEntity,
  type EulerLabelProduct, eulerLabelProductEmpty,
  type EulerLabelVaultOverride,
  type EulerLabelPoint,
  type EulerLabelPointReward,
} from '~/entities/euler/labels'
import type { EarnVault, Vault } from '~/entities/vault'
import type { OracleAdapterMeta } from '~/entities/oracle'
let _labelsRepo = 'euler-xyz/euler-labels'
let _labelsRepoBranch = 'master'
let _oracleChecksRepo = 'euler-xyz/oracle-checks'
let _isCustomLabelsRepo = false
let _enableEarnPage = true

const initRepos = () => {
  const { labelsRepo, labelsRepoBranch, oracleChecksRepo, isCustomLabelsRepo, enableEarnPage } = useDeployConfig()
  _labelsRepo = labelsRepo
  _labelsRepoBranch = labelsRepoBranch
  _oracleChecksRepo = oracleChecksRepo
  _isCustomLabelsRepo = isCustomLabelsRepo.value
  _enableEarnPage = enableEarnPage
}

const getLabelsUrl = (chainId: number, file: string) =>
  `https://raw.githubusercontent.com/${_labelsRepo}/refs/heads/${_labelsRepoBranch}/${chainId}/${file}`

const getOracleChecksUrl = (chainId: number, file: string) =>
  `https://raw.githubusercontent.com/${_oracleChecksRepo}/refs/heads/master/data/${chainId}/${file}`

const isLoading = ref(false)

// Use a simple object to track loaded state (survives HMR better than ref)
const loadState = { chainId: null as number | null, timestamp: 0 }
const LABELS_CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

const products: Record<string, EulerLabelProduct> = shallowReactive({})
const entities: Record<string, EulerLabelEntity> = shallowReactive({})
const points: Record<string, EulerLabelPointReward[]> = shallowReactive({})
const earnVaults: Ref<string[]> = ref([]) // string of earn vault addresses
const earnVaultBlocks: Record<string, string[]> = shallowReactive({}) // address (lowercase) -> blocked country codes
const featuredEarnVaults: Set<string> = shallowReactive(new Set())
// Derived from products - all unique vault addresses across all products
const verifiedVaultAddresses: Ref<string[]> = ref([])
const oracleAdapters: Record<string, OracleAdapterMeta> = shallowReactive({})

const normalizeAddress = (address: string): Address => {
  try {
    return getAddress(address)
  }
  catch {
    return address.toLowerCase() as Address
  }
}

const extractVaultOverrides = (raw: Record<string, unknown>): Record<string, EulerLabelVaultOverride> => {
  const overrides: Record<string, EulerLabelVaultOverride> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (!key.startsWith('0x') || typeof value !== 'object' || value === null) continue
    const entry = value as Record<string, unknown>
    const override: EulerLabelVaultOverride = {}
    if (typeof entry.description === 'string') override.description = entry.description
    const reason = entry.deprecationReason ?? entry.deprecateReason
    if (typeof reason === 'string') override.deprecationReason = reason
    if (Array.isArray(entry.block)) override.block = entry.block.filter((v): v is string => typeof v === 'string')
    if (Object.keys(override).length > 0) {
      overrides[normalizeAddress(key)] = override
    }
  }
  return overrides
}

const normalizeProducts = (data: Record<string, EulerLabelProduct>): { products: Record<string, EulerLabelProduct>, vaultAddresses: string[] } => {
  const normalized: Record<string, EulerLabelProduct> = {}
  const allVaults = new Set<string>()
  Object.entries(data).forEach(([key, product]) => {
    const normalizedVaults = product.vaults.map(normalizeAddress)
    const normalizedDeprecated = (product.deprecatedVaults || []).map(normalizeAddress)
    const fallbackReason = (product as { deprecateReason?: string }).deprecateReason
    const vaultOverrides = extractVaultOverrides(product as unknown as Record<string, unknown>)
    normalized[key] = {
      ...product,
      vaults: normalizedVaults,
      deprecatedVaults: normalizedDeprecated,
      deprecationReason: product.deprecationReason || fallbackReason,
      vaultOverrides,
    }
    normalizedVaults.forEach(v => allVaults.add(v))
    normalizedDeprecated.forEach(v => allVaults.add(v))
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

const loadingAdapters = new Set<string>()

const normalizeOracleAdapters = (data: unknown) => {
  const normalized: Record<string, OracleAdapterMeta> = {}
  const list = Array.isArray(data) ? data : ((data as { adapters?: unknown[] })?.adapters || [])

  list.forEach((item) => {
    if (!item || typeof item !== 'object') return
    const raw = item as Record<string, unknown>
    const oracle = raw.oracle || raw.adapter || raw.address
    if (typeof oracle !== 'string') return

    const base = raw.base || raw.baseAsset || raw.base_asset
    const quote = raw.quote || raw.quoteAsset || raw.quote_asset
    const baseAddress = typeof base === 'string' ? normalizeAddress(base) : undefined
    const quoteAddress = typeof quote === 'string' ? normalizeAddress(quote) : undefined

    const meta: OracleAdapterMeta = {
      oracle: normalizeAddress(oracle),
      base: baseAddress,
      quote: quoteAddress,
      name: typeof raw.name === 'string' ? raw.name : undefined,
      provider: typeof raw.provider === 'string' ? raw.provider : undefined,
      methodology: typeof raw.methodology === 'string' ? raw.methodology : undefined,
      label: typeof raw.label === 'string' ? raw.label : undefined,
      checks: Array.isArray(raw.checks) ? raw.checks.filter((v): v is string => typeof v === 'string') : undefined,
    }

    normalized[meta.oracle.toLowerCase()] = meta
  })

  return normalized
}

const loadOracleAdapter = async (chainId: number, oracleAddress: string): Promise<OracleAdapterMeta | undefined> => {
  const checksummed = getAddress(oracleAddress)
  const key = checksummed.toLowerCase()

  // Already cached
  if (oracleAdapters[key]) {
    return oracleAdapters[key]
  }

  // Already loading
  if (loadingAdapters.has(key)) {
    return undefined
  }

  loadingAdapters.add(key)
  try {
    const url = getOracleChecksUrl(chainId, `adapters/${checksummed}.json`)
    const res = await axios.get(url)
    const meta = normalizeOracleAdapters([res.data])
    Object.assign(oracleAdapters, meta)
    return oracleAdapters[key]
  }
  catch {
    // Adapter file not found - silently ignore
    return undefined
  }
  finally {
    loadingAdapters.delete(key)
  }
}

const loadOracleAdapters = async (chainId: number, addresses?: string[]) => {
  if (!addresses?.length) {
    return // No-op if no specific addresses requested
  }
  await Promise.all(addresses.map(addr => loadOracleAdapter(chainId, addr)))
}

export const useEulerLabels = () => {
  initRepos()

  const loadLabels = async (forceRefresh = false) => {
    try {
      const { getCurrentChainConfig, loadEulerConfig } = useEulerAddresses()

      if (!getCurrentChainConfig.value) {
        loadEulerConfig()
      }
      await until(getCurrentChainConfig).toBeTruthy()

      const chainId = getCurrentChainConfig.value!.chainId
      const now = Date.now()

      // Skip if already loaded for this chain and cache is still valid
      if (!forceRefresh
        && loadState.chainId === chainId
        && Object.keys(products).length > 0
        && (now - loadState.timestamp) < LABELS_CACHE_TTL_MS) {
        return
      }

      isLoading.value = true

      Object.keys(products).forEach(key => delete products[key])
      Object.keys(entities).forEach(key => delete entities[key])
      Object.keys(points).forEach(key => delete points[key])
      Object.keys(oracleAdapters).forEach(key => delete oracleAdapters[key])
      Object.keys(earnVaultBlocks).forEach(key => delete earnVaultBlocks[key])
      featuredEarnVaults.clear()
      earnVaults.value = []
      verifiedVaultAddresses.value = []

      const [productRes, entitiesRes, pointsRes] = await Promise.all([
        axios.get(getLabelsUrl(chainId, 'products.json')),
        axios.get(getLabelsUrl(chainId, 'entities.json')),
        axios.get(getLabelsUrl(chainId, 'points.json')),
      ])

      if (_isCustomLabelsRepo) {
        try {
          const earnRes = await axios.get(getLabelsUrl(chainId, 'earn-vaults.json'))
          const earnEntries = earnRes.data as Array<string | { address: string, block?: string[], featured?: boolean }>
          earnVaults.value = earnEntries.map((entry) => {
            if (typeof entry === 'string') return normalizeAddress(entry)
            const addr = normalizeAddress(entry.address)
            if (entry.block?.length) {
              earnVaultBlocks[addr.toLowerCase()] = entry.block
            }
            if (entry.featured) {
              featuredEarnVaults.add(addr)
            }
            return addr
          })
        }
        catch {
          if (_enableEarnPage) {
            console.warn(`[Labels] earn-vaults.json not found on ${_labelsRepo}@${_labelsRepoBranch}`)
          }
        }
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

      loadState.chainId = chainId
      loadState.timestamp = Date.now()
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
    oracleAdapters,
    earnVaults,
    loadLabels,
    loadOracleAdapter,
    loadOracleAdapters,
  }
}

export const getProductByVault = (vaultAddress: string) => {
  const normalized = normalizeAddress(vaultAddress)
  return Object.values(products).find(product =>
    product.vaults.includes(normalized)
    || product.deprecatedVaults?.includes(normalized),
  )
    || eulerLabelProductEmpty
}

export const getVaultBlock = (vaultAddress: string): string[] | undefined => {
  const product = getProductByVault(vaultAddress)
  const override = product.vaultOverrides?.[normalizeAddress(vaultAddress)]
  return override?.block ?? product.block
}

export const getEarnVaultBlock = (vaultAddress: string): string[] | undefined => {
  const normalized = normalizeAddress(vaultAddress).toLowerCase()
  return earnVaultBlocks[normalized]
}

export const isVaultFeatured = (vaultAddress: string): boolean => {
  const normalized = normalizeAddress(vaultAddress)
  const inFeaturedProduct = Object.values(products).some(product =>
    (product.featured ?? false) && product.vaults.includes(normalized),
  )
  if (inFeaturedProduct) return true
  return featuredEarnVaults.has(normalized)
}

export const isVaultDeprecated = (vaultAddress: string): boolean => {
  const normalized = normalizeAddress(vaultAddress)
  return Object.values(products).some(product =>
    product.deprecatedVaults?.includes(normalized) ?? false,
  )
}

export const getEntitiesByVault = (vault: Vault) => {
  const arr: EulerLabelEntity[] = []
  Object.values(entities).forEach((entity) => {
    if (Object.keys(entity.addresses).includes(vault.governorAdmin)) {
      arr.push(entity)
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

const applyVaultOverrides = (product: EulerLabelProduct, vaultAddress: string): EulerLabelProduct => {
  const override = product.vaultOverrides?.[normalizeAddress(vaultAddress)]
  if (!override) return product
  return {
    ...product,
    ...(override.description !== undefined && { description: override.description }),
    ...(override.deprecationReason !== undefined && { deprecationReason: override.deprecationReason }),
  }
}

export const useEulerProductOfVault = (vaultAddress: string | Ref<string>) => {
  return toReactive(computed(() => {
    const addr = unref(vaultAddress)
    return applyVaultOverrides(getProductByVault(addr), addr)
  }))
}

export const useEulerEntitiesOfVault = (vault: Vault | Ref<Vault>) => {
  return toReactive(computed(() => getEntitiesByVault(unref(vault))))
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
