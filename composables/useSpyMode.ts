import { isAddress, getAddress } from 'viem'
import { getPublicClient } from '~/utils/public-client'
import { truncate } from '~/utils/string-utils'
import { logWarn } from '~/utils/errorHandling'

const EVC_GET_ACCOUNT_OWNER_ABI = [
  {
    type: 'function',
    name: 'getAccountOwner',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
] as const

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

/** viem's isAddress validates EIP-55 checksum on mixed-case input — normalize to lowercase first */
const isValidAddress = (value: string): boolean =>
  typeof value === 'string' && isAddress(value.toLowerCase() as `0x${string}`)

const normalizeAddress = (value: string): string =>
  getAddress(value.toLowerCase() as `0x${string}`)

const spyAddress = ref('')
let watchersInitialized = false
let ownerResolved = false
let explicitlyCleared = false

export const useSpyMode = () => {
  const route = useRoute()
  const router = useRouter()

  const isSpyMode = computed(() => Boolean(spyAddress.value))
  const spyShortAddress = computed(() => spyAddress.value ? truncate(spyAddress.value) : '')

  // Try to pick up ?spy= — route.query may not be populated yet, so read from window.location
  if (!spyAddress.value && !explicitlyCleared && import.meta.client) {
    const spy = new URLSearchParams(window.location.search).get('spy')
      || (route.query.spy as string | undefined)
    if (spy && isValidAddress(spy)) {
      spyAddress.value = normalizeAddress(spy)
    }
  }

  if (!watchersInitialized && import.meta.client) {
    watchersInitialized = true

    const { eulerCoreAddresses, chainId } = useEulerAddresses()
    const requestUrl = useRequestURL()

    const resolveOwner = async (address: string): Promise<string> => {
      try {
        const evcAddress = eulerCoreAddresses.value?.evc
        if (!evcAddress || !chainId.value) return address

        const rpcUrl = `${requestUrl.origin}/api/rpc/${chainId.value}`
        const client = getPublicClient(rpcUrl)

        const owner = await client.readContract({
          address: evcAddress as `0x${string}`,
          abi: EVC_GET_ACCOUNT_OWNER_ABI,
          functionName: 'getAccountOwner',
          args: [address as `0x${string}`],
        })

        if (owner && owner !== ZERO_ADDRESS && getAddress(owner) !== getAddress(address)) {
          return getAddress(owner)
        }
      }
      catch (err) {
        logWarn('useSpyMode/resolveOwner', err)
      }
      return address
    }

    const applyResolved = (resolved: string) => {
      if (resolved !== spyAddress.value) {
        spyAddress.value = resolved
        router.replace({
          path: route.path,
          query: { ...route.query, spy: resolved },
          hash: route.hash,
        })
      }
      ownerResolved = true
    }

    // Watch route query to pick up ?spy= on initial load and navigation
    watch(
      () => route.query.spy,
      (spy) => {
        if (spy && typeof spy === 'string' && isValidAddress(spy) && !spyAddress.value && !explicitlyCleared) {
          spyAddress.value = normalizeAddress(spy)
          ownerResolved = false
        }
      },
      { immediate: true },
    )

    // Resolve owner once both spy address AND EVC are available
    watch(
      [() => spyAddress.value, () => eulerCoreAddresses.value?.evc],
      ([addr, evc]) => {
        if (addr && evc && !ownerResolved) {
          resolveOwner(addr).then(applyResolved)
        }
      },
      { immediate: true },
    )
  }

  const setSpyMode = async (address: string) => {
    if (!isValidAddress(address)) return
    explicitlyCleared = false
    spyAddress.value = normalizeAddress(address)
    ownerResolved = false

    await router.replace({
      path: route.path,
      query: { ...route.query, spy: spyAddress.value },
      hash: route.hash,
    })
  }

  const clearSpyMode = async () => {
    explicitlyCleared = true
    spyAddress.value = ''
    ownerResolved = false
    const { spy: _spy, ...rest } = route.query
    await router.replace({
      path: route.path,
      query: rest,
      hash: route.hash,
    })
  }

  return {
    spyAddress: computed(() => spyAddress.value),
    isSpyMode,
    spyShortAddress,
    setSpyMode,
    clearSpyMode,
  }
}
