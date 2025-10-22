import { useWriteContract } from '@wagmi/vue'
import type { Address, Hash } from 'viem'
import { maxUint256 } from 'viem'
import { ethers } from 'ethers'
import { erc20ABI, eVaultABI } from '~/entities/euler/abis'

export const useEulerOperations = () => {
  const { address } = useWagmi()
  const { writeContractAsync } = useWriteContract()
  const { EVM_PROVIDER_URL } = useEulerConfig()

  const checkAllowance = async (assetAddress: Address, vaultAddress: Address): Promise<bigint> => {
    const provider = new ethers.JsonRpcProvider(EVM_PROVIDER_URL)
    const contract = new ethers.Contract(assetAddress, erc20ABI, provider)

    const allowance = await contract.allowance(address.value, vaultAddress)
    return allowance as bigint
  }

  const waitForTransaction = async (hash: Hash) => {
    const provider = new ethers.JsonRpcProvider(EVM_PROVIDER_URL)
    const receipt = await provider.waitForTransaction(hash)
    return receipt
  }

  const supply = async (vaultAddress: string, assetAddress: string, amount: bigint, _symbol: string) => {
    if (!address.value) {
      throw new Error('Wallet not connected')
    }

    const vaultAddr = vaultAddress as Address
    const assetAddr = assetAddress as Address
    const userAddr = address.value as Address

    const allowance = await checkAllowance(assetAddr, vaultAddr)

    if (allowance < amount) {
      const approveHash = await writeContractAsync({
        address: assetAddr,
        abi: erc20ABI,
        functionName: 'approve',
        args: [vaultAddr, maxUint256],
      })

      await waitForTransaction(approveHash)
    }

    const depositHash = await writeContractAsync({
      address: vaultAddr,
      abi: eVaultABI,
      functionName: 'deposit',
      args: [amount, userAddr],
    })

    return depositHash
  }

  return {
    supply,
  }
}
