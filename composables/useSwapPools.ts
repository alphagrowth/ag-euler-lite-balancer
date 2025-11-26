import axios from 'axios'
import { ethers } from 'ethers'
import type { Address } from 'viem'

export interface SwapPoolVault {
  accountNav: {
    shares: string
    assets: string
    borrowed: string
  }
  address: Address
  asset: Address
  availableLiquidity: string
  cash: string
  decimals: number
}

export interface SwapPool {
  account: Address
  active: boolean
  apy: string
  blockNumber: string
  blockTimestamp: string
  conc0: string
  conc1: string
  factory: Address
  fee: string
  limit01In: string
  limit01Out: string
  limit10In: string
  limit10Out: string
  owner: Address
  pool: Address
  price: string
  reserves0: string
  reserves1: string
  totalReserves: string
  vault0: SwapPoolVault
  vault1: SwapPoolVault
  volume7d: string
}

const swapPoolsCache = ref<Map<string, SwapPool[]>>(new Map())
const isLoadingPools = ref(false)

export const useSwapPools = () => {
  const { EULER_API_URL } = useEulerConfig()
  const { chainId } = useEulerAddresses()

  const fetchSwapPools = async (accountAddress?: string): Promise<SwapPool[]> => {
    if (!accountAddress || !chainId.value) {
      return []
    }

    const cacheKey = `${chainId.value}-${accountAddress}`

    if (swapPoolsCache.value.has(cacheKey)) {
      return swapPoolsCache.value.get(cacheKey)!
    }

    try {
      isLoadingPools.value = true

      const response = await axios.get<SwapPool[]>(
        `${EULER_API_URL}/v1/swap/pools`,
        {
          params: {
            chainId: chainId.value,
            account: accountAddress,
            timestamp: Date.now(),
          },
        },
      )

      const pools = response.data
      swapPoolsCache.value.set(cacheKey, pools)

      return pools
    }
    catch (error) {
      console.warn('Failed to fetch swap pools:', error)
      return []
    }
    finally {
      isLoadingPools.value = false
    }
  }

  const getOperatorForSubAccount = async (subAccount: Address): Promise<Address | null> => {
    const { address } = useWagmi()

    if (!address.value) {
      return null
    }

    const pools = await fetchSwapPools(address.value)

    const pool = pools.find(
      p => ethers.getAddress(p.account) === ethers.getAddress(subAccount),
    )

    return pool?.pool || null
  }

  const getSwapPoolForSubAccount = async (subAccount: Address): Promise<SwapPool | null> => {
    const { address } = useWagmi()

    if (!address.value) {
      return null
    }

    const pools = await fetchSwapPools(address.value)

    const pool = pools.find(
      p => ethers.getAddress(p.account) === ethers.getAddress(subAccount),
    )

    return pool || null
  }

  return {
    fetchSwapPools,
    getOperatorForSubAccount,
    getSwapPoolForSubAccount,
    isLoadingPools: computed(() => isLoadingPools.value),
  }
}
