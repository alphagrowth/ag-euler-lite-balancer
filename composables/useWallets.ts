import { type Address, createPublicClient, http, getAddress, parseAbi } from 'viem'
import { useVaultRegistry } from '~/composables/useVaultRegistry'
import { eulerUtilsLensABI } from '~/entities/euler/abis'
import { erc20BalanceOfAbi } from '~/abis/erc20'

// Singleton state
const balances = ref(new Map<string, bigint>())
const isLoaded = ref(false)
const isFetching = ref(false)
const lastFetchChainId = ref<number | null>(null)
let fetchPromise: Promise<void> | null = null

export const useWallets = () => {
  const { isReady } = useVaults()
  const { getByType } = useVaultRegistry()
  const { address, isConnected, chain } = useWagmi()
  const { eulerLensAddresses } = useEulerAddresses()
  const { chainId } = useEulerAddresses()
  const { EVM_PROVIDER_URL } = useEulerConfig()

  const updateBalances = async () => {
    // Guard: must be connected
    if (!isConnected.value || !address.value || !chain.value) {
      return
    }

    // Guard: vaults must be ready
    if (!isReady.value) {
      return
    }

    // Guard: need lens address
    const utilsLensAddress = eulerLensAddresses.value?.utilsLens as Address
    if (!utilsLensAddress) {
      return
    }

    // Collect unique underlying asset addresses from ALL vaults (evk, earn, securitize)
    // Note: We only fetch underlying token balances, NOT vault share balances
    // Share balances are fetched separately on individual pages via account lens
    const addresses = new Set<string>()
    const allVaults = [...getByType('evk'), ...getByType('earn'), ...getByType('securitize')]
    allVaults.forEach((vault) => {
      // Only add valid underlying asset addresses (not vault share addresses)
      if (vault.asset?.address && vault.asset.address.startsWith('0x') && vault.asset.address.length === 42) {
        try {
          addresses.add(getAddress(vault.asset.address))
        }
        catch {
          // Skip invalid addresses
        }
      }
    })

    const tokenAddresses = [...addresses] as Address[]
    if (!tokenAddresses.length) {
      isLoaded.value = true
      return
    }

    // Don't start new fetch if one is in progress
    if (isFetching.value) {
      return
    }

    const currentChainId = chainId.value
    isFetching.value = true

    try {
      const client = createPublicClient({
        chain: chain.value,
        transport: http(EVM_PROVIDER_URL),
      })

      // Try batch call first, fall back to individual calls if it fails
      let result: bigint[]
      try {
        result = await client.readContract({
          address: utilsLensAddress,
          abi: eulerUtilsLensABI,
          functionName: 'tokenBalances',
          args: [address.value as Address, tokenAddresses],
        }) as bigint[]
      }
      catch {
        // Fallback: fetch balances individually
        result = await Promise.all(
          tokenAddresses.map(async (tokenAddr) => {
            try {
              const balance = await client.readContract({
                address: tokenAddr,
                abi: parseAbi(erc20BalanceOfAbi),
                functionName: 'balanceOf',
                args: [address.value as Address],
              }) as bigint
              return balance
            }
            catch {
              return 0n
            }
          }),
        )
      }

      // Only update if still on same chain
      if (chainId.value === currentChainId) {
        const newBalances = new Map<string, bigint>()
        result.forEach((balance: bigint, index: number) => {
          newBalances.set(tokenAddresses[index], balance)
        })
        balances.value = newBalances
        lastFetchChainId.value = currentChainId
        isLoaded.value = true
      }
    }
    catch (e) {
      console.warn('Error fetching balances:', e)
      // Mark as loaded to avoid infinite retries
      if (chainId.value === currentChainId && !isLoaded.value) {
        isLoaded.value = true
        lastFetchChainId.value = currentChainId
      }
    }
    finally {
      isFetching.value = false
      fetchPromise = null
    }
  }

  // Check if we need to fetch on each call
  const needsFetch = () => {
    return isConnected.value
      && isReady.value
      && !!address.value
      && !!eulerLensAddresses.value?.utilsLens
      && (lastFetchChainId.value !== chainId.value || !isLoaded.value)
      && !isFetching.value
  }

  // Trigger fetch if needed (deduped via fetchPromise)
  if (needsFetch() && !fetchPromise) {
    fetchPromise = updateBalances()
  }

  // Handle chain changes
  if (lastFetchChainId.value !== null && lastFetchChainId.value !== chainId.value) {
    balances.value = new Map()
    isLoaded.value = false
    lastFetchChainId.value = null
  }

  const getBalance = (tokenAddress: Address): bigint => {
    try {
      const normalized = getAddress(tokenAddress)
      return balances.value.get(normalized) || 0n
    }
    catch {
      return balances.value.get(tokenAddress) || 0n
    }
  }

  /**
   * Fetch a single token balance directly via balanceOf.
   * Use this for supply/deposit pages to avoid triggering the full batch query.
   */
  const fetchSingleBalance = async (tokenAddress: string): Promise<bigint> => {
    if (!isConnected.value || !address.value || !chain.value || !tokenAddress) {
      return 0n
    }
    try {
      const client = createPublicClient({
        chain: chain.value,
        transport: http(EVM_PROVIDER_URL),
      })
      const result = await client.readContract({
        address: getAddress(tokenAddress) as Address,
        abi: parseAbi(erc20BalanceOfAbi),
        functionName: 'balanceOf',
        args: [address.value as Address],
      }) as bigint
      return result
    }
    catch {
      return 0n
    }
  }

  /**
   * Fetch vault share balance via balanceOf on the vault address.
   * Use this for savings/deposit positions where user holds vault shares.
   */
  const fetchVaultShareBalance = async (vaultAddress: string): Promise<bigint> => {
    if (!isConnected.value || !address.value || !chain.value || !vaultAddress) {
      return 0n
    }
    try {
      const client = createPublicClient({
        chain: chain.value,
        transport: http(EVM_PROVIDER_URL),
      })
      const result = await client.readContract({
        address: getAddress(vaultAddress) as Address,
        abi: parseAbi(erc20BalanceOfAbi),
        functionName: 'balanceOf',
        args: [address.value as Address],
      }) as bigint
      return result
    }
    catch {
      return 0n
    }
  }

  // isLoading only true on initial load, not on background refreshes
  const isLoading = computed(() => !isLoaded.value && isFetching.value)

  return {
    balances,
    isLoaded,
    isLoading,
    getBalance,
    updateBalances,
    fetchSingleBalance,
    fetchVaultShareBalance,
  }
}
