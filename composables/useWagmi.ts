import { useAccount, useDisconnect, useBalance, useSwitchChain, useEnsName } from '@wagmi/vue'
import { useAppKit } from '@reown/appkit/vue'
import { formatUnits, getAddress, isAddress, type Address } from 'viem'
import { truncate } from '~/utils/string-utils'
import { availableNetworkIds } from '~/entities/custom'

let isChangingChain = false
let isRouterReplacing = false
let isInitialRouteSync = true
const isLoaded = ref(false)
const walletName = ref('Wallet')
const routeNetworkId: Ref<number | null> = ref(null)
const allowedChainIds = availableNetworkIds.length ? [...availableNetworkIds] : [1]

let cachedWagmiData: ReturnType<typeof initializeWagmi> | null = null

const parseChainId = (value: unknown): number | null => {
  const normalized = Array.isArray(value) ? value[0] : value
  const parsed = typeof normalized === 'string'
    ? Number.parseInt(normalized, 10)
    : typeof normalized === 'number'
      ? normalized
      : NaN

  return Number.isFinite(parsed) ? parsed : null
}

function initializeWagmi() {
  const { address: wagmiAddress, isConnected: wagmiIsConnected, connector, chain: wagmiChain, status } = useAccount()
  const { disconnect: wagmiDisconnect } = useDisconnect()
  const { switchChain } = useSwitchChain()

  const chainId = computed(() => wagmiChain.value?.id)

  const { data: ensName } = useEnsName({
    address: wagmiAddress,
    chainId: chainId.value,
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

  const route = useRoute()
  const router = useRouter()
  const { changeCurrentChainId, chainId: currentChainId } = useEulerAddresses()
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

  const getMainPathForRoute = (): string | null => {
    const path = route.path

    if (path.startsWith('/earn/') && path !== '/earn') {
      return '/earn'
    }

    if (path.startsWith('/borrow/') && path !== '/borrow') {
      return '/borrow'
    }

    if (path.startsWith('/position/')) {
      return '/portfolio'
    }

    return null
  }

  const redirectToMainIfInternal = async (targetChainId: number) => {
    const mainPath = getMainPathForRoute()

    if (!mainPath) {
      return
    }

    await router.replace({
      path: mainPath,
      query: {
        ...route.query,
        network: targetChainId,
      },
      hash: route.hash,
    })
  }

  const disconnect = async () => {
    await wagmiDisconnect()
  }

  const connect = () => {
    modal()
  }

  const syncRouteNetwork = async (targetChainId: number) => {
    if (routeNetworkId.value === targetChainId || isRouterReplacing) {
      return
    }

    isRouterReplacing = true
    await router.replace({
      query: {
        ...route.query,
        network: targetChainId,
      },
    })
    isRouterReplacing = false
  }

  const changeChain = async (targetChainId: number) => {
    if (!allowedChainIds.includes(targetChainId)) {
      console.warn(`[useWagmi] chainId ${targetChainId} is not allowed`)
      return
    }

    try {
      isChangingChain = true
      localStorage.setItem('chainId', String(targetChainId))
      changeCurrentChainId(targetChainId)
      await syncRouteNetwork(targetChainId)
      if (!isInitialRouteSync) {
        await redirectToMainIfInternal(targetChainId)
      }
      // if (isConnected.value) {
      //   await switchChain({ chainId: targetChainId })
      // }
    }
    catch (error) {
      console.error('Failed to switch chain:', error)
      throw error
    }
    finally {
      isChangingChain = false
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

  watch(computed(() => route.query.network), async (network, oldNetwork) => {
    if (isChangingChain || (!oldNetwork && !isInitialRouteSync)) {
      return
    }

    const parsed = parseChainId(network)
    routeNetworkId.value = parsed && allowedChainIds.includes(parsed) ? parsed : null
    await changeChain(routeNetworkId.value || 1)
    isInitialRouteSync = false
  }, { immediate: true })

  watch(currentChainId, (val) => {
    if (!val) {
      return
    }

    syncRouteNetwork(val)
  }, { immediate: true })

  watch(wagmiChain, (val) => {
    if (!val?.id || isChangingChain) {
      return
    }

    if (!allowedChainIds.includes(val.id)) {
      console.warn(`[useWagmi] chainId ${val.id} is not allowed`)
      return
    }

    changeCurrentChainId(val.id)
    localStorage.setItem('chainId', String(val.id))
    syncRouteNetwork(val.id)
  })

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
