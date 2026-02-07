import { ethers } from 'ethers'
import { EVC_ABI, type BatchItem, type BatchItemResult } from '~/abis/evc'

export type MulticallResult<T = unknown> = {
  success: boolean
  result: T | null
  error?: Error
}

/**
 * Execute multiple contract calls in a single RPC request using EVC batchSimulation.
 * This is more reliable than Multicall3 as EVC is guaranteed to exist on all Euler chains.
 *
 * @param evcAddress - EVC contract address
 * @param items - Array of batch items (target, data, value)
 * @param provider - ethers JsonRpcProvider
 * @returns Array of BatchItemResult in same order as items
 */
export const evcBatchCall = async (
  evcAddress: string,
  items: BatchItem[],
  provider: ethers.JsonRpcProvider,
): Promise<BatchItemResult[]> => {
  if (items.length === 0) {
    return []
  }

  const evcContract = new ethers.Contract(evcAddress, EVC_ABI, provider)

  try {
    const [batchResults] = await evcContract.batchSimulation.staticCall(
      items,
      { value: 0n },
    ) as [BatchItemResult[], unknown, unknown]

    return batchResults
  }
  catch (err) {
    console.warn('[evcBatchCall] batchSimulation failed:', err)
    // Return all failures
    return items.map(() => ({
      success: false,
      result: '0x',
    }))
  }
}

/**
 * Build a batch item for a contract call.
 */
export const buildBatchItem = (
  targetContract: string,
  callData: string,
  value: bigint = 0n,
): BatchItem => ({
  targetContract,
  onBehalfOfAccount: ethers.ZeroAddress,
  value,
  data: callData,
})

/**
 * Batch multiple lens calls using EVC batchSimulation.
 * Encodes calls, executes batch, and returns raw results for decoding.
 *
 * @param evcAddress - EVC contract address
 * @param lensAddress - Lens contract address
 * @param lensInterface - ethers Interface for the lens contract
 * @param calls - Array of { functionName, args } to call
 * @param provider - ethers JsonRpcProvider
 * @returns Array of decoded results (or null for failed calls)
 */
export const batchLensCalls = async <T>(
  evcAddress: string,
  lensAddress: string,
  lensInterface: ethers.Interface,
  calls: Array<{ functionName: string; args: unknown[] }>,
  provider: ethers.JsonRpcProvider,
): Promise<Array<{ success: boolean; result: T | null }>> => {
  if (calls.length === 0) {
    return []
  }

  // Build batch items
  const items: BatchItem[] = calls.map((call) => {
    const callData = lensInterface.encodeFunctionData(call.functionName, call.args)
    return buildBatchItem(lensAddress, callData)
  })

  // Execute batch
  const batchResults = await evcBatchCall(evcAddress, items, provider)

  // Decode results
  return batchResults.map((result, index) => {
    if (!result.success) {
      return { success: false, result: null }
    }

    try {
      const decoded = lensInterface.decodeFunctionResult(
        calls[index].functionName,
        result.result,
      )
      return { success: true, result: decoded as T }
    }
    catch (err) {
      console.warn(`[batchLensCalls] Failed to decode result for ${calls[index].functionName}:`, err)
      return { success: false, result: null }
    }
  })
}
