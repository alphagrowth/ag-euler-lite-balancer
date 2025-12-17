import { useAccount, useWriteContract } from '@wagmi/vue'
import { ethers } from 'ethers'
import type { Address } from 'viem'

import type { REULLock } from '~/entities/reul'

const address = ref('')

const isLoaded = ref(false)
const isLocksLoading = ref(true)
const locks: Ref<REULLock[]> = ref([])
const reulTokenContractAddress = ref('')
const eulTokenContractAddress = ref('')

const reulWithdrawABI = [
  {
    type: 'function',
    name: 'withdrawToByLockTimestamp',
    inputs: [
      {
        name: 'account',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'lockTimestamp',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'allowRemainderLoss',
        type: 'bool',
        internalType: 'bool',
      },
    ],
    outputs: [
      {
        name: 'success',
        type: 'bool',
        internalType: 'bool',
      },
    ],
    stateMutability: 'nonpayable',
  },
] as const

let interval: NodeJS.Timeout | null = null

const loadReulTokenContractAddresses = async (chainId: number) => {
  try {
    const response = await fetch(`https://raw.githubusercontent.com/euler-xyz/euler-interfaces/refs/heads/master/addresses/${chainId}/TokenAddresses.json`)
    if (!response.ok) {
      throw new Error(`Failed to fetch Euler config: ${response.statusText}`)
    }

    const data = await response.json()
    reulTokenContractAddress.value = data.rEUL
    eulTokenContractAddress.value = data.EUL
  }
  catch (err) {
    console.error('Failed to load Reul token contract addresses:', err)
  }
}

const loadREULLocksInfo = async (isInitialLoading = true) => {
  await until(computed(() => reulTokenContractAddress.value && eulTokenContractAddress.value)).toBeTruthy()
  try {
    if (!address.value) {
      locks.value = []
      return
    }
    if (isInitialLoading) {
      isLocksLoading.value = true
    }

    const { EVM_PROVIDER_URL } = useEulerConfig()
    const provider = ethers.getDefaultProvider(EVM_PROVIDER_URL)
    const contract = new ethers.Contract(reulTokenContractAddress.value, [
      'function getLockedAmounts(address account) view returns (uint256[], uint256[])',
      'function getWithdrawAmountsByLockTimestamp(address account, uint256 lockTimestamp) view returns (uint256, uint256)',
      'function withdrawToByLockTimestamp(address account, uint256 lockTimestamp, bool allowRemainderLoss) external',
    ], provider)

    const [lockTimestamps, amounts] = await contract.getLockedAmounts(address.value)
    const withdrawAmountsData: { unlockableAmount: bigint, amountToBeBurned: bigint }[] = []

    const batchSize = 5

    for (let i = 0; i < lockTimestamps.length; i += batchSize) {
      const batch = lockTimestamps
        .slice(i, i + batchSize)
        .map(async (timestamp: string) => {
          const [unlockableAmount, amountToBeBurned] = await contract.getWithdrawAmountsByLockTimestamp(address.value, timestamp)
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

  watch(wagmiAddress, (val) => {
    if (val) {
      address.value = val
    }
    else {
      address.value = ''
    }
  }, { immediate: true })

  watch(isConnected, () => {
    if (!isLoaded.value) {
      loadREULLocksInfo()
      loadReulTokenContractAddresses(chainId.value || 1)
      isLoaded.value = true
    }

    if (!interval) {
      interval = setInterval(() => {
        loadREULLocksInfo(false)
      }, 10000)
    }
    else {
      if (interval) {
        clearInterval(interval)
        interval = null
      }
    }
  }, { immediate: true })

  const unlockREUL = async (lockTimestamps: bigint[]) => {
    if (!address.value) {
      throw new Error('Wallet not connected')
    }

    const hash = await writeContractAsync({
      address: reulTokenContractAddress.value as Address,
      abi: reulWithdrawABI,
      functionName: 'withdrawToByLockTimestamp',
      args: [address.value as Address, lockTimestamps[0] as bigint, true],
    })

    return hash
  }

  return {
    locks,
    isLocksLoading,
    loadREULLocksInfo,
    unlockREUL,
  }
}
