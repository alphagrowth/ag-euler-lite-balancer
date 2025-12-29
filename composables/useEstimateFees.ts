import { useAccount, useConfig } from '@wagmi/vue'
import { estimateGas } from '@wagmi/vue/actions'
import { formatEther, type Address, encodeFunctionData } from 'viem'
import { ethers } from 'ethers'
import { useEulerConfig } from '~/composables/useEulerConfig'
import type { TxPlan, TxStep } from '~/entities/txPlan'

export const useEstimatePlanFees = () => {
  const { address } = useAccount()
  const config = useConfig()
  const { EVM_PROVIDER_URL } = useEulerConfig()

  const provider = new ethers.JsonRpcProvider(EVM_PROVIDER_URL)

  const getFallbackGasLimit = (step: TxStep) => {
    if (step.type === 'approve' || step.type === 'permit2-approve') {
      return 65000n
    }

    if (step.type === 'evc-batch') {
      const calls = Array.isArray(step.args?.[0]) ? step.args[0].length : 1
      return 200000n + (70000n * BigInt(calls))
    }

    return 200000n
  }

  const estimatePlanFees = async (plan: TxPlan) => {
    if (!address.value) {
      throw new Error('Wallet not connected')
    }

    const feeData = await provider.getFeeData()
    const gasPrice = feeData.maxFeePerGas ?? feeData.gasPrice
    if (!gasPrice) {
      throw new Error('Failed to fetch gas price')
    }

    const results: {
      step: TxStep
      gasLimit: bigint
      feeWei: bigint
      feeNative: string
    }[] = []

    for (const step of plan.steps) {
      const data = encodeFunctionData({
        abi: step.abi,
        functionName: step.functionName as any,
        args: step.args as any,
      })

      let gasLimit: bigint
      try {
        gasLimit = await estimateGas(config, {
          account: address.value as Address,
          to: step.to,
          value: step.value ?? 0n,
          data,
        })
      }
      catch (err) {
        console.warn('[estimatePlanFees] gas estimate failed, using fallback', err)
        gasLimit = getFallbackGasLimit(step)
      }

      const feeWei = gasLimit * gasPrice
      results.push({
        step,
        gasLimit,
        feeWei,
        feeNative: formatEther(feeWei),
      })
    }

    const totalWei = results.reduce((acc, r) => acc + r.feeWei, 0n)
    const totalNative = formatEther(totalWei)

    return {
      steps: results,
      totalWei,
      totalNative,
    }
  }

  return { estimatePlanFees }
}
