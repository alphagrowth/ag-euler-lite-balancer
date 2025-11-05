import { useAccount, useDisconnect, useBalance, useSwitchChain, useEnsName } from '@wagmi/vue'
import { useAppKit } from '@reown/appkit/vue'
import { formatUnits, getAddress, isAddress, type Address } from 'viem'
import { truncate } from '~/utils/string-utils'

const isLoaded = ref(false)
const walletName = ref('Wallet')

let cachedWagmiData: ReturnType<typeof initializeWagmi> | null = null

function initializeWagmi() {
  const { address: wagmiAddress, isConnected: wagmiIsConnected, connector, chain: wagmiChain, status } = useAccount()
  const { disconnect: wagmiDisconnect } = useDisconnect()
  const { switchChain } = useSwitchChain()
  const { data: ensName } = useEnsName({
    address: wagmiAddress,
    chainId: 1,
  })
  const { data: balanceData, isLoading: isLoadingBalance, refetch: refetchBalance } = useBalance({
    address: wagmiAddress,
  })
  const { open: modal } = useAppKit()

  return {
    wagmiAddress,
    wagmiIsConnected,
    connector,
    wagmiChain,
    status,
    wagmiDisconnect,
    switchChain,
    ensName,
    balanceData,
    isLoadingBalance,
    refetchBalance,
    modal,
  }
}

export const useWagmi = () => {
  if (!cachedWagmiData) {
    cachedWagmiData = initializeWagmi()
  }

  const {
    wagmiAddress,
    wagmiIsConnected,
    connector,
    wagmiChain,
    status,
    wagmiDisconnect,
    switchChain,
    ensName,
    balanceData,
    isLoadingBalance,
    refetchBalance,
    modal,
  } = cachedWagmiData

  const address: ComputedRef<Address | undefined> = computed(() => wagmiAddress.value || undefined)
  const isConnected = computed(() => Boolean(wagmiIsConnected.value))
  const chain = computed(() => wagmiChain.value)
  const chainId = computed(() => wagmiChain.value?.id)

  const checksummedAddress = computed(() => {
    try {
      return address.value && isAddress(address.value) ? getAddress(address.value) : ''
    }
    catch {
      return address.value
    }
  })

  const friendlyAddress = computed(() => checksummedAddress.value)
  const shortAddress = computed(() => address.value ? truncate(address.value) : '')
  const shorterAddress = computed(() => address.value ? truncate(address.value, 3) : '')

  const displayName = computed(() => ensName.value || walletName.value)

  const balance = computed(() => {
    if (!balanceData.value) return 0
    return Number.parseFloat(formatUnits(balanceData.value.value, balanceData.value.decimals))
  })

  const balanceFormatted = computed(() => {
    if (!balanceData.value) return '0'
    return formatUnits(balanceData.value.value, balanceData.value.decimals)
  })

  const disconnect = async () => {
    await wagmiDisconnect()
  }

  const connect = () => {
    modal()
  }

  const changeChain = async (targetChainId: number) => {
    try {
      await switchChain({ chainId: targetChainId })
    }
    catch (error) {
      console.error('Failed to switch chain:', error)
      throw error
    }
  }

  const isConnecting = computed(() => status.value === 'connecting')
  const isReconnecting = computed(() => status.value === 'reconnecting')
  const isDisconnected = computed(() => status.value === 'disconnected')

  watch([isConnected, connector], ([connected, conn]) => {
    if (connected && conn) {
      walletName.value = conn.name || 'Wallet'
    }

    if (connected && !isLoaded.value) {
      isLoaded.value = true
    }
    else {
      setTimeout(() => {
        isLoaded.value = true
      }, 5000)
    }
  }, { immediate: true })

  return {
    isLoaded,
    isConnected,
    isConnecting,
    isReconnecting,
    isDisconnected,
    status,
    address,
    checksummedAddress,
    friendlyAddress,
    shortAddress,
    shorterAddress,
    walletName,
    displayName,
    ensName,
    connector,
    chain,
    chainId,
    balance,
    balanceFormatted,
    isLoadingBalance,
    refetchBalance,
    modal,
    connect,
    disconnect,
    changeChain,
    switchChain,
  }
}
