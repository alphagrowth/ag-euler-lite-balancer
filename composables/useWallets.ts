import { type Address, createPublicClient, http } from 'viem'
import { useEulerConfig } from '~/composables/useEulerConfig'
import { eulerUtilsLensABI } from '~/entities/euler/abis'

const isLoaded = ref(false)
const isLoading = ref(true)
const balances = ref(new Map<string, bigint>())
const isVaultsUpdated = ref(false)

let interval: NodeJS.Timeout

export const useWallets = () => {
  const { map, earnMap, isReady } = useVaults()
  const { address, isConnected, chain } = useWagmi()
  const { eulerLensAddresses } = useEulerAddresses()

  const updateBalances = async () => {
    try {
      if (!isConnected.value || !address.value || !chain.value) {
        return
      }

      const tokenAddresses: Address[] = []
      map.value.forEach((vault) => {
        tokenAddresses.push(vault.address as Address)
        tokenAddresses.push(vault.asset.address as Address)
      })

      earnMap.value.forEach((vault) => {
        tokenAddresses.push(vault.address as Address)
        tokenAddresses.push(vault.asset.address as Address)
      })

      const { EVM_PROVIDER_URL } = useEulerConfig()
      const client = createPublicClient({
        chain: chain.value,
        transport: http(EVM_PROVIDER_URL),
      })

      const utilsLensAddress = eulerLensAddresses.value?.utilsLens as Address

      const tokenBalancesResult = await client.readContract({
        address: utilsLensAddress,
        abi: eulerUtilsLensABI,
        functionName: 'tokenBalances',
        args: [address.value as Address, tokenAddresses],
      }) as bigint[]

      tokenBalancesResult.forEach((balance: bigint, index: number) => {
        balances.value.set(tokenAddresses[index], balance)
      })
    }
    catch (e) {
      console.warn('Error updating balances:', e)
    }
    finally {
      isLoaded.value = true
      isLoading.value = false
    }
  }

  watch([map, earnMap], () => {
    isVaultsUpdated.value = true
  })

  if (!isReady.value && !interval) {
    interval = setInterval(async () => {
      if (isReady.value) {
        clearInterval(interval)
      }

      if (isVaultsUpdated.value) {
        await updateBalances()
        isVaultsUpdated.value = false
      }
    }, 3000)
  }

  return {
    balances,
    isLoaded,
    isLoading,
    updateBalances,
    getBalance: (tokenAddress: Address) => balances.value.get(tokenAddress) || 0n,
  }
}
