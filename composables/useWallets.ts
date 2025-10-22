import axios from 'axios'
import { Address } from '@ton/core'
import { TonClient } from '@ton/ton'

const { isConnected, address, friendlyAddress } = useTonConnect()

const isLoaded = ref(false)
const isLoading = ref(false)
const balances = ref(new Map<string, bigint>())
const convertedAddresses = new Map<string, string>()
const walletState = ref(null)

export const updateBalances = async (isInitialLoading = true) => {
  try {
    if (!isConnected.value) {
      return
    }

    const { TVM_TONCENTER_URL } = useAppConfig()
    if (isInitialLoading) {
      isLoaded.value = false
      isLoading.value = true
    }
    const { isReady, map } = useVaults()
    await until(isReady).toBe(true)

    const { isLoaded: isTacSdkLoaded } = useTacSdk()
    await until(isTacSdkLoaded).toBe(true)

    const { tacSdk } = useTacSdk()

    let tonAssetsAddress: string
    const evmAddresses: string[] = []
    map.value.forEach((vault) => {
      evmAddresses.push(vault.address)
      evmAddresses.push(vault.asset.address)
      if (vault.asset.symbol === 'TON') {
        tonAssetsAddress = vault.asset.address
      }
    })
    const batchSize = 5
    for (let i = 0; i < evmAddresses.length; i += batchSize) {
      const batch = evmAddresses.slice(i, i + batchSize)
      const allSettled = Promise.allSettled
        ? Promise.allSettled.bind(Promise)
        : (proms: Promise<any>[]) =>
            Promise.all(proms.map(p => p
              .then(v => ({ status: 'fulfilled', value: v }))
              .catch(e => ({ status: 'rejected', reason: e }))))

      const results = await allSettled(batch.map(addr => tacSdk.getTVMTokenAddress(addr)))

      batch.forEach((evmAddress, idx) => {
        const res = results[idx]
        const tvm = res.status === 'fulfilled' && res.value ? res.value : 'NONE'
        convertedAddresses.set(evmAddress, tvm)
      })
    }
    const { data } = await axios.get<{ jetton_wallets: Record<string, string>[] }>(`${TVM_TONCENTER_URL}/api/v3/jetton/wallets`, {
      params: {
        jetton_address: Array.from(convertedAddresses.values()).filter(o => o !== 'NONE'),
        owner_address: address.value,
      },
    })
    const wallets = data.jetton_wallets

    const client = new TonClient({
      endpoint: `${TVM_TONCENTER_URL}/api/v2/jsonRPC`,
    })
    const tonBalance = await client.getBalance(Address.parse(friendlyAddress.value))

    convertedAddresses.forEach((value, key) => {
      balances.value.set(key, value === 'NONE'
        ? (key === tonAssetsAddress ? tonBalance : 0n)
        : BigInt(wallets.find(wallet =>
            wallet?.jetton === Address.parse(value).toRawString().toUpperCase(),
          )?.balance || 0n))
    })
  }
  catch (e) {
    console.warn(e)
  }
  finally {
    isLoaded.value = true
    isLoading.value = false
  }
}

const getWalletState = async () => {
  try {
    const { TVM_TONCENTER_URL } = useAppConfig()
    const { data } = await axios.get(`${TVM_TONCENTER_URL}/api/v2/getAddressInformation?address=${address.value}`)
    walletState.value = data?.result?.state || null
  }
  catch (e) {
    console.warn(e)
  }
}

watch(isConnected, (val) => {
  if (val) {
    updateBalances()
    getWalletState()
    return
  }
  balances.value.clear()
}, { immediate: true })

export const useWallets = () => {
  return {
    balances,
    walletState,
    isLoaded,
    isLoading,
    updateBalances,
  }
}
