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

  const withdraw = async (
    vaultAddress: string,
    assetAddress: string,
    assetsAmount: bigint,
    _symbol: string,
    _subAccount?: string,
    maxSharesAmount?: bigint,
    isMax?: boolean,
  ) => {
    if (!address.value) {
      throw new Error('Wallet not connected')
    }

    const vaultAddr = vaultAddress as Address
    const userAddr = address.value as Address

    const provider = new ethers.JsonRpcProvider(EVM_PROVIDER_URL)
    const vaultContract = new ethers.Contract(vaultAddr, eVaultABI, provider)

    let sharesAmount = isMax ? maxSharesAmount || 0n : await vaultContract.previewWithdraw(assetsAmount)

    if (isMax === false && maxSharesAmount && sharesAmount > maxSharesAmount) {
      sharesAmount = maxSharesAmount
    }

    const vaultAllowance = await checkAllowance(vaultAddr, vaultAddr)

    if (vaultAllowance < sharesAmount) {
      const approveHash = await writeContractAsync({
        address: vaultAddr,
        abi: erc20ABI,
        functionName: 'approve',
        args: [vaultAddr, maxUint256],
      })

      await waitForTransaction(approveHash)
    }

    const withdrawHash = await writeContractAsync({
      address: vaultAddr,
      abi: eVaultABI,
      functionName: 'withdraw',
      args: [assetsAmount, userAddr, userAddr],
    })

    return withdrawHash
  }

  const redeem = async (
    vaultAddress: string,
    assetAddress: string,
    assetsAmount: bigint,
    _symbol: string,
    _subAccount?: string,
    maxSharesAmount?: bigint,
    _isMax?: boolean,
  ) => {
    if (!address.value) {
      throw new Error('Wallet not connected')
    }

    const vaultAddr = vaultAddress as Address
    const userAddr = address.value as Address

    const sharesAmount = maxSharesAmount || 0n

    const vaultAllowance = await checkAllowance(vaultAddr, vaultAddr)

    if (vaultAllowance < sharesAmount) {
      const approveHash = await writeContractAsync({
        address: vaultAddr,
        abi: erc20ABI,
        functionName: 'approve',
        args: [vaultAddr, maxUint256],
      })

      await waitForTransaction(approveHash)
    }

    const redeemHash = await writeContractAsync({
      address: vaultAddr,
      abi: eVaultABI,
      functionName: 'redeem',
      args: [sharesAmount, userAddr, userAddr],
    })

    return redeemHash
  }

  return {
    supply,
    withdraw,
    redeem,
  }
}
