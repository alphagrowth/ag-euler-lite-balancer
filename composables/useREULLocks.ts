import { SenderFactory, type EvmProxyMsg } from '@tonappchain/sdk'
import { useAccount } from '@wagmi/vue'
import { ethers } from 'ethers'

import type { REULLock } from '~/entities/reul'

const {
  MERKL_PROXY,
  EVM_PROVIDER_URL,
} = useEulerConfig()

const { tonConnectUI } = useTonConnect()

const address = ref('')

const isLoaded = ref(false)
const isLocksLoading = ref(true)
const locks: Ref<REULLock[]> = ref([])
const reulTokenContractAddress = ref('')
const eulTokenContractAddress = ref('')

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
    if (isInitialLoading) {
      isLocksLoading.value = true
    }

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
const unlockREUL = async (lockTimestamps: bigint[]) => {
  const { isLoaded } = useTacSdk()
  await until(isLoaded).toBeTruthy()
  const { tacSdk } = useTacSdk()
  // const oneTimestampFunctionSelector = '0xd47d9de6'
  const manyTimestampsFunctionSelector = '0x4f570258'

  const withdrawToByLockTimestampData = new ethers.AbiCoder().encode(
    ['tuple(uint256[],bool)'],
    [[lockTimestamps, true]],
  )

  const encodedArguments = new ethers.AbiCoder().encode(
    ['tuple(address,bytes4[],bytes[],address[])'],
    [[
      reulTokenContractAddress.value,
      [manyTimestampsFunctionSelector],
      [withdrawToByLockTimestampData],
      [eulTokenContractAddress.value],
    ]],
  )
  const evmProxyMsg: EvmProxyMsg = {
    evmTargetAddress: MERKL_PROXY,
    methodName: 'customFunctionCall(bytes,bytes)',
    encodedParameters: encodedArguments,
  }

  const sender = await SenderFactory.getSender({ tonConnect: tonConnectUI })
  const res = await tacSdk.sendCrossChainTransaction(evmProxyMsg, sender)
  tacSdk.closeConnections()

  const tsResult = res?.sendTransactionResult as {
    success: boolean
    error: Record<string, unknown>
  }
  if (!tsResult?.success) {
    throw tsResult?.error?.info || 'Unknown error'
  }

  return res
}

export const useREULLocks = () => {
  const { isConnected, address: wagmiAddress, chainId } = useAccount()

  watch(wagmiAddress, (val) => {
    if (val) {
      address.value = val
    }
    else {
      address.value = ''
    }
  }, { immediate: true })

  watch(isConnected, (val) => {
    if (!isLoaded.value) {
      loadREULLocksInfo()
      loadReulTokenContractAddresses(chainId.value || 1)
      isLoaded.value = true
    }

    if (val && !interval) {
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

  return {
    locks,
    isLocksLoading,
    loadREULLocksInfo,
    unlockREUL,
  }
}
