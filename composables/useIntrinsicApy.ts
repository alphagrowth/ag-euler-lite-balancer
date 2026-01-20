import axios from 'axios'
import { enableIntrinsicApy, intrinsicApySources } from '~/entities/custom'

type DefiLlamaPool = {
  symbol?: string
  project?: string
  chain?: string
  apyBase?: number | null
  tvlUsd?: number | null
}

type IntrinsicApySource = {
  symbol: string
  sourceSymbol?: string
  project: string
}

const DEFI_LLAMA_CHAIN_BY_CHAIN_ID: Record<number, string> = {
  1: 'Ethereum',
  56: 'BSC',
  130: 'Unichain',
  146: 'Sonic',
  239: 'TAC',
  1923: 'Swell',
  42161: 'Arbitrum',
  43114: 'Avalanche',
  59144: 'Linea',
  60808: 'BOB',
  80094: 'Berachain',
  8453: 'Base',
  9745: 'Plasma',
}

const intrinsicApyBySymbol: Ref<Record<string, number>> = ref({})
const intrinsicApyPools: Ref<DefiLlamaPool[]> = ref([])
const isLoading = ref(false)
const isLoaded = ref(false)

const normalize = (value?: string) => value?.toLowerCase() || ''

const resolvePreferredChain = (chainId?: number, chainName?: string) => {
  if (chainId !== undefined) {
    const mapped = DEFI_LLAMA_CHAIN_BY_CHAIN_ID[chainId]
    if (mapped) return mapped
  }

  return chainName
}

const pickBestPool = (pools: DefiLlamaPool[], preferredChain?: string) => {
  const sorted = [...pools].sort((a, b) => (b.tvlUsd || 0) - (a.tvlUsd || 0))
  if (!sorted.length) return undefined
  if (!preferredChain) return sorted[0]

  const preferredChainName = normalize(preferredChain)
  if (!preferredChainName) return undefined

  const preferredPools = sorted.filter(pool => normalize(pool.chain) === preferredChainName)
  return preferredPools[0]
}

const resolveIntrinsicApy = (pools: DefiLlamaPool[], source: IntrinsicApySource, preferredChain?: string) => {
  const sourceSymbol = normalize(source.sourceSymbol || source.symbol)
  const project = normalize(source.project)
  const matches = pools.filter(pool =>
    normalize(pool.symbol) === sourceSymbol
    && normalize(pool.project) === project
    && pool.apyBase !== null
    && pool.apyBase !== undefined,
  )

  const best = pickBestPool(matches, preferredChain)
  return best?.apyBase ? Number(best.apyBase) : 0
}

const buildIntrinsicApyMap = (
  pools: DefiLlamaPool[],
  sources: readonly IntrinsicApySource[],
  preferredChain?: string,
) => {
  const entries = sources.map((source) => {
    return [normalize(source.symbol), resolveIntrinsicApy(pools, source, preferredChain)] as const
  })

  return Object.fromEntries(entries)
}

export const useIntrinsicApy = () => {
  const { chainId, getCurrentChainConfig } = useEulerAddresses()
  const preferredChain = computed(() => resolvePreferredChain(chainId.value, getCurrentChainConfig.value?.name))

  const updateIntrinsicApy = () => {
    if (!enableIntrinsicApy) return
    if (!intrinsicApyPools.value.length) return
    intrinsicApyBySymbol.value = buildIntrinsicApyMap(
      intrinsicApyPools.value,
      intrinsicApySources,
      preferredChain.value,
    )
  }

  const loadIntrinsicApy = async () => {
    if (isLoading.value || isLoaded.value) return
    if (!enableIntrinsicApy) {
      intrinsicApyPools.value = []
      intrinsicApyBySymbol.value = {}
      isLoaded.value = true
      return
    }

    try {
      isLoading.value = true

      const res = await axios.get('https://yields.llama.fi/pools')
      const pools = (res.data?.data || []) as DefiLlamaPool[]

      intrinsicApyPools.value = pools
      intrinsicApyBySymbol.value = buildIntrinsicApyMap(
        pools,
        intrinsicApySources,
        preferredChain.value,
      )
      isLoaded.value = true
    }
    catch (err) {
      console.warn('[useIntrinsicApy] failed to load intrinsic APY', err)
      intrinsicApyPools.value = []
      intrinsicApyBySymbol.value = {}
      isLoaded.value = false
    }
    finally {
      isLoading.value = false
    }
  }

  const getIntrinsicApy = (symbol?: string) => {
    if (!enableIntrinsicApy || !symbol) return 0
    return intrinsicApyBySymbol.value[normalize(symbol)] || 0
  }

  const withIntrinsicSupplyApy = (baseApy: number, symbol?: string) => {
    return baseApy + getIntrinsicApy(symbol)
  }

  const withIntrinsicBorrowApy = (baseApy: number, symbol?: string) => {
    return baseApy - getIntrinsicApy(symbol)
  }

  watch(preferredChain, () => {
    if (!enableIntrinsicApy) return
    if (!isLoaded.value) return
    updateIntrinsicApy()
  })

  onMounted(() => {
    loadIntrinsicApy()
  })

  return {
    intrinsicApyBySymbol,
    isLoading: computed(() => isLoading.value),
    isLoaded: computed(() => isLoaded.value),
    loadIntrinsicApy,
    getIntrinsicApy,
    withIntrinsicSupplyApy,
    withIntrinsicBorrowApy,
  }
}
