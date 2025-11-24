import { useAccount, useConfig } from '@wagmi/vue'
import { estimateGas } from '@wagmi/vue/actions'
import { formatEther, type Address, type Hex } from 'viem'
import { ethers } from 'ethers'
import { useEulerConfig } from '~/composables/useEulerConfig'

export const useEstimateFees = () => {
  const { address } = useAccount()
  const config = useConfig()
  const { EVM_PROVIDER_URL } = useEulerConfig()

  const provider = new ethers.JsonRpcProvider(EVM_PROVIDER_URL)

  /**
     * Оценивает комиссию для произвольной EVM-транзакции
     */
  const estimateFee = async (params: {
    to: Address
    value?: bigint        // в wei
    data?: Hex            // calldata, если вызываешь контракт
    chainId?: number      // можно не указывать, если текущая сеть уже настроена
  }) => {
    if (!address.value) {
      throw new Error('Wallet not connected')
    }

    // 1. Оцениваем gasLimit через wagmi
    const gasLimit = await estimateGas(config, {
      chainId: params.chainId,
      account: address.value as Address,
      to: params.to,
      value: params.value,
      data: params.data,
    })

    // 2. Берём актуальную цену газа с RPC (через ethers)
    const feeData = await provider.getFeeData()
    const gasPrice = feeData.maxFeePerGas ?? feeData.gasPrice
    if (!gasPrice) {
      throw new Error('Failed to fetch gas price')
    }

    // 3. Считаем итоговую комиссию
    const feeWei = gasLimit * gasPrice

    return {
      gasLimit,                 // bigint
      gasPrice,                 // wei за газ
      feeWei,                   // полная комиссия в wei
      feeNative: formatEther(feeWei), // строка в ETH/BASE (в зависимости от сети)
    }
  }

  return {
    estimateFee,
  }
}