import { useAccount, useWriteContract } from '@wagmi/vue'
import { ethers } from 'ethers'
import type { Address, Abi } from 'viem'

import { reulLockAbi, reulWithdrawABI } from '~/abis/reul'
import type { REULLock } from '~/entities/reul'
import type { TxPlan } from '~/entities/txPlan'

const isLoaded = ref(false)
const isLocksLoading = ref(true)
const isAddressesLoading = ref(false)
const addressLoadError = ref<string | null>(null)
const locks: Ref<REULLock[]> = ref([])
const reulTokenContractAddress = ref('')
const eulTokenContractAddress = ref('')

let interval: NodeJS.Timeout | null = null

const loadReulTokenContractAddresses = async (chainId: number) => {
  try {
    isAddressesLoading.value = true
    addressLoadError.value = null

    const response = await fetch(`https://raw.githubusercontent.com/euler-xyz/euler-interfaces/refs/heads/master/addresses/${chainId}/TokenAddresses.json`)
    if (!response.ok) {
      throw new Error(`Failed to fetch Euler config: ${response.statusText}`)
    }

    const data = await response.json()
    reulTokenContractAddress.value = data.rEUL
    eulTokenContractAddress.value = data.EUL
  }
  catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error'
    addressLoadError.value = errorMessage
    console.error('Failed to load Reul token contract addresses:', err)
  }
  finally {
    isAddressesLoading.value = false
  }
}

const loadREULLocksInfo = async (userAddress: string, isInitialLoading = true) => {
  await until(computed(() => reulTokenContractAddress.value && eulTokenContractAddress.value)).toBeTruthy()
  try {
    if (!userAddress) {
      locks.value = []
      return
    }
    if (isInitialLoading) {
      isLocksLoading.value = true
    }

    const { EVM_PROVIDER_URL } = useEulerConfig()
    const provider = ethers.getDefaultProvider(EVM_PROVIDER_URL)
    const contract = new ethers.Contract(reulTokenContractAddress.value, reulLockAbi, provider)

    const [lockTimestamps, amounts] = await contract.getLockedAmounts(userAddress)
    const withdrawAmountsData: { unlockableAmount: bigint, amountToBeBurned: bigint }[] = []

    const batchSize = 5

    for (let i = 0; i < lockTimestamps.length; i += batchSize) {
      const batch = lockTimestamps
        .slice(i, i + batchSize)
        .map(async (timestamp: string) => {
          const [unlockableAmount, amountToBeBurned] = await contract.getWithdrawAmountsByLockTimestamp(userAddress, timestamp)
          return {
            unlockableAmount,
            amountToBeBurned,
          }
        })

      withdrawAmountsData.push(...(await Promise.all(batch)))
    }

    locks.value = withdrawAmountsData.map((item, index) => ({
      timestamp: lockTimestamps[index],
      amount: amounts[index],
      unlockableAmount: item.unlockableAmount,
      amountToBeBurned: item.amountToBeBurned,
    }))
  }
  catch (e) {
    console.warn(e)
  }
  finally {
    isLocksLoading.value = false
  }
}
export const useREULLocks = () => {
  const { isConnected, address: wagmiAddress, chainId } = useAccount()
  const { writeContractAsync } = useWriteContract()

  watch([isConnected, chainId], ([connected, currentChainId], [_oldConnected, oldChainId]) => {
    if (oldChainId && currentChainId !== oldChainId) {
      isLoaded.value = false
      locks.value = []
      reulTokenContractAddress.value = ''
      eulTokenContractAddress.value = ''
    }

    if (!isLoaded.value && wagmiAddress.value) {
      loadREULLocksInfo(wagmiAddress.value)
      loadReulTokenContractAddresses(currentChainId || 1)
      isLoaded.value = true
    }

    if (connected && !interval) {
      interval = setInterval(() => {
        if (wagmiAddress.value) {
          loadREULLocksInfo(wagmiAddress.value, false)
        }
      }, 10000)
    }
    else if (!connected && interval) {
      clearInterval(interval)
      interval = null
    }
  }, { immediate: true })

  const unlockREUL = async (lockTimestamps: bigint[]) => {
    if (!wagmiAddress.value) {
      throw new Error('Wallet not connected')
    }

    if (!reulTokenContractAddress.value || reulTokenContractAddress.value === '') {
      throw new Error('REUL contract address not available')
    }

    const hash = await writeContractAsync({
      address: reulTokenContractAddress.value as Address,
      abi: reulWithdrawABI,
      functionName: 'withdrawToByLockTimestamp',
      args: [wagmiAddress.value, lockTimestamps[0] as bigint, true],
    })

    return hash
  }

  const buildUnlockREULPlan = async (lockTimestamps: bigint[]): Promise<TxPlan> => {
    if (!wagmiAddress.value) {
      throw new Error('Wallet not connected')
    }

    if (!reulTokenContractAddress.value || reulTokenContractAddress.value === '') {
      throw new Error('REUL contract address not available')
    }

    return {
      kind: 'reul-unlock',
      steps: [
        {
          type: 'other',
          label: 'Unlock REUL',
          to: reulTokenContractAddress.value as Address,
          abi: reulWithdrawABI as Abi,
          functionName: 'withdrawToByLockTimestamp',
          args: [wagmiAddress.value, lockTimestamps[0] as bigint, true] as const,
          value: 0n,
        },
      ],
    }
  }

  return {
    locks,
    isLocksLoading,
    isAddressesLoading,
    addressLoadError,
    reulTokenContractAddress: computed(() => reulTokenContractAddress.value),
    eulTokenContractAddress: computed(() => eulTokenContractAddress.value),
    loadREULLocksInfo: (address: string, isInitial?: boolean) => loadREULLocksInfo(address, isInitial),
    unlockREUL,
    buildUnlockREULPlan,
  }
}
