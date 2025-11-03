import { useWriteContract } from '@wagmi/vue'
import type { Address, Hash } from 'viem'
import { maxUint256 } from 'viem'
import { ethers } from 'ethers'
import { erc20ABI, eVaultABI } from '~/entities/euler/abis'

export const useEulerOperations = () => {
  const { address } = useWagmi()
  const { writeContractAsync } = useWriteContract()
  const { EVM_PROVIDER_URL, ETH_VAULT_CONNECTOR } = useEulerConfig()

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

  const borrow = async (
    collateralVaultAddress: string,
    collateralAssetAddress: string,
    collateralAmount: bigint,
    borrowVaultAddress: string,
    _borrowAssetAddress: string,
    borrowAmount: bigint,
    _collateralSymbol: string,
  ) => {
    if (!address.value) {
      throw new Error('Wallet not connected')
    }

    const collateralVaultAddr = collateralVaultAddress as Address
    const collateralAssetAddr = collateralAssetAddress as Address
    const borrowVaultAddr = borrowVaultAddress as Address
    const userAddr = address.value as Address
    const connectorAddr = ETH_VAULT_CONNECTOR as Address

    const allowance = await checkAllowance(collateralAssetAddr, collateralVaultAddr)

    if (allowance < collateralAmount) {
      const approveHash = await writeContractAsync({
        address: collateralAssetAddr,
        abi: erc20ABI,
        functionName: 'approve',
        args: [collateralVaultAddr, maxUint256],
      })

      await waitForTransaction(approveHash)
    }

    const depositHash = await writeContractAsync({
      address: collateralVaultAddr,
      abi: eVaultABI,
      functionName: 'deposit',
      args: [collateralAmount, userAddr],
    })

    await waitForTransaction(depositHash)

    const vaultAllowance = await checkAllowance(collateralVaultAddr, connectorAddr)

    if (vaultAllowance === 0n) {
      const approveVaultHash = await writeContractAsync({
        address: collateralVaultAddr,
        abi: erc20ABI,
        functionName: 'approve',
        args: [connectorAddr, maxUint256],
      })

      await waitForTransaction(approveVaultHash)
    }

    const enableControllerHash = await writeContractAsync({
      address: connectorAddr,
      abi: [{
        type: 'function',
        name: 'enableController',
        inputs: [
          { name: 'account', type: 'address' },
          { name: 'vault', type: 'address' },
        ],
        outputs: [],
        stateMutability: 'payable',
      }],
      functionName: 'enableController',
      args: [userAddr, borrowVaultAddr],
    })

    await waitForTransaction(enableControllerHash)

    const enableCollateralHash = await writeContractAsync({
      address: connectorAddr,
      abi: [{
        type: 'function',
        name: 'enableCollateral',
        inputs: [
          { name: 'account', type: 'address' },
          { name: 'vault', type: 'address' },
        ],
        outputs: [],
        stateMutability: 'payable',
      }],
      functionName: 'enableCollateral',
      args: [userAddr, collateralVaultAddr],
    })

    await waitForTransaction(enableCollateralHash)

    const borrowHash = await writeContractAsync({
      address: borrowVaultAddr,
      abi: eVaultABI,
      functionName: 'borrow',
      args: [borrowAmount, userAddr],
    })

    return borrowHash
  }

  const borrowBySaving = async (
    collateralVaultAddress: string,
    _collateralAssetAddress: string,
    _collateralAmount: bigint,
    borrowVaultAddress: string,
    _borrowAssetAddress: string,
    borrowAmount: bigint,
    _collateralSymbol: string,
  ) => {
    if (!address.value) {
      throw new Error('Wallet not connected')
    }

    const collateralVaultAddr = collateralVaultAddress as Address
    const borrowVaultAddr = borrowVaultAddress as Address
    const userAddr = address.value as Address
    const connectorAddr = ETH_VAULT_CONNECTOR as Address

    const vaultAllowance = await checkAllowance(collateralVaultAddr, connectorAddr)

    if (vaultAllowance === 0n) {
      const approveVaultHash = await writeContractAsync({
        address: collateralVaultAddr,
        abi: erc20ABI,
        functionName: 'approve',
        args: [connectorAddr, maxUint256],
      })

      await waitForTransaction(approveVaultHash)
    }

    const enableControllerHash = await writeContractAsync({
      address: connectorAddr,
      abi: [{
        type: 'function',
        name: 'enableController',
        inputs: [
          { name: 'account', type: 'address' },
          { name: 'vault', type: 'address' },
        ],
        outputs: [],
        stateMutability: 'payable',
      }],
      functionName: 'enableController',
      args: [userAddr, borrowVaultAddr],
    })

    await waitForTransaction(enableControllerHash)

    const enableCollateralHash = await writeContractAsync({
      address: connectorAddr,
      abi: [{
        type: 'function',
        name: 'enableCollateral',
        inputs: [
          { name: 'account', type: 'address' },
          { name: 'vault', type: 'address' },
        ],
        outputs: [],
        stateMutability: 'payable',
      }],
      functionName: 'enableCollateral',
      args: [userAddr, collateralVaultAddr],
    })

    await waitForTransaction(enableCollateralHash)

    const borrowHash = await writeContractAsync({
      address: borrowVaultAddr,
      abi: eVaultABI,
      functionName: 'borrow',
      args: [borrowAmount, userAddr],
    })

    return borrowHash
  }

  const repay = async (
    borrowVaultAddress: string,
    borrowAssetAddress: string,
    repayAmount: bigint,
    _borrowSymbol: string,
  ) => {
    if (!address.value) {
      throw new Error('Wallet not connected')
    }

    const borrowVaultAddr = borrowVaultAddress as Address
    const borrowAssetAddr = borrowAssetAddress as Address
    const userAddr = address.value as Address

    const allowance = await checkAllowance(borrowAssetAddr, borrowVaultAddr)

    if (allowance < repayAmount) {
      const approveHash = await writeContractAsync({
        address: borrowAssetAddr,
        abi: erc20ABI,
        functionName: 'approve',
        args: [borrowVaultAddr, maxUint256],
      })

      await waitForTransaction(approveHash)
    }

    const repayHash = await writeContractAsync({
      address: borrowVaultAddr,
      abi: eVaultABI,
      functionName: 'repay',
      args: [repayAmount, userAddr],
    })

    return repayHash
  }

  const disableCollateral = async (
    _subAccount: string,
    collateralVaultAddress: string,
    _collateralAssetAddress: string,
    _amount: bigint,
    borrowVaultAddress: string,
    _borrowAssetAddress: string,
  ) => {
    if (!address.value) {
      throw new Error('Wallet not connected')
    }

    const collateralVaultAddr = collateralVaultAddress as Address
    const borrowVaultAddr = borrowVaultAddress as Address
    const userAddr = address.value as Address
    const connectorAddr = ETH_VAULT_CONNECTOR as Address

    const disableControllerHash = await writeContractAsync({
      address: connectorAddr,
      abi: [{
        type: 'function',
        name: 'disableController',
        inputs: [{ name: 'account', type: 'address' }],
        outputs: [],
        stateMutability: 'payable',
      }],
      functionName: 'disableController',
      args: [userAddr],
    })

    await waitForTransaction(disableControllerHash)

    const disableCollateralHash = await writeContractAsync({
      address: connectorAddr,
      abi: [{
        type: 'function',
        name: 'disableCollateral',
        inputs: [
          { name: 'account', type: 'address' },
          { name: 'vault', type: 'address' },
        ],
        outputs: [],
        stateMutability: 'payable',
      }],
      functionName: 'disableCollateral',
      args: [userAddr, collateralVaultAddr],
    })

    return disableCollateralHash
  }

  return {
    supply,
    withdraw,
    redeem,
    borrow,
    borrowBySaving,
    repay,
    disableCollateral,
  }
}
