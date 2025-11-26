import { useWriteContract } from '@wagmi/vue'
import type { Address, Hash, Hex, Abi } from 'viem'
import { encodeFunctionData } from 'viem'
import { maxUint256 } from 'viem'
import { ethers } from 'ethers'
import { SaHooksBuilder } from '~/entities/saHooksSDK'
import { convertSaHooksToEVCCalls, EVC_ABI } from '~/utils/evc-converter'
import { getNewSubAccount } from '~/entities/account'
import { erc20ABI } from '~/entities/euler/abis'
import type { TxPlan, TxStep } from '~/entities/txPlan'

const FINAL_MESSAGE = 'By proceeding to engage with and use Euler, you accept and agree to abide by the Terms of Use: https://www.euler.finance/terms  hash:0x1a7aa1916b6c56272b62be027108c06d9af95eef4dac46acbc80267b3919e07e'
const FINAL_HASH = '0xb0d552b4ebe441d9582f5fc732fd6026b09bec13e7f3c1e21c0ecaa3801df595'

export const useEulerOperations = () => {
  const { address } = useWagmi()
  const { writeContractAsync } = useWriteContract()
  const { eulerCoreAddresses, eulerPeripheryAddresses } = useEulerAddresses()
  const { EVM_PROVIDER_URL } = useEulerConfig()

  const checkAllowance = async (assetAddress: Address, spenderAddress: Address, userAddress: Address): Promise<bigint> => {
    const provider = new ethers.JsonRpcProvider(EVM_PROVIDER_URL)
    const contract = new ethers.Contract(assetAddress, erc20ABI, provider)

    try {
      const allowance = await contract.allowance(userAddress, spenderAddress)
      return allowance as bigint
    }
    catch (e) {
      console.error('Error checking allowance:', e)
      return 0n
    }
  }

  const hasSignature = async (userAddress: Address) => {
    if (!eulerPeripheryAddresses.value) {
      return false
    }

    const provider = new ethers.JsonRpcProvider(EVM_PROVIDER_URL)
    const abi = [
      'function lastTermsOfUseSignatureTimestamp(address account, bytes32 termsOfUseHash) external view returns (uint256)',
    ]
    const contract = new ethers.Contract(
      eulerPeripheryAddresses.value.termsOfUseSigner,
      abi,
      provider,
    )

    try {
      const lastSignTimestamp = await contract.lastTermsOfUseSignatureTimestamp(userAddress, FINAL_HASH)
      return lastSignTimestamp > 0
    }
    catch (e) {
      console.error('Error checking ToS signature:', e)
      return false
    }
  }

  const executeTxPlan = async (plan: TxPlan) => {
    if (!address.value) {
      throw new Error('Wallet not connected')
    }

    let lastHash: Hex | undefined

    for (const step of plan.steps) {
      const txHash = await writeContractAsync({
        address: step.to,
        abi: step.abi,
        functionName: step.functionName as any,
        args: step.args as any,
        value: step.value ?? 0n,
      })

      lastHash = txHash
      // TODO wait for transaction provider.waitForTransaction(txHash)
    }

    return lastHash
  }

  const buildSupplyPlan = async (
    vaultAddress: string,
    assetAddress: string,
    amount: bigint,
    _symbol: string,
    subAccount?: string,
  ): Promise<TxPlan> => {
    if (!address.value || !eulerCoreAddresses.value || !eulerPeripheryAddresses.value) {
      throw new Error('Wallet not connected or addresses not available')
    }

    const vaultAddr = vaultAddress as Address
    const assetAddr = assetAddress as Address
    const userAddr = address.value as Address
    const evcAddress = eulerCoreAddresses.value.evc as Address
    const tosSignerAddress = eulerPeripheryAddresses.value.termsOfUseSigner as Address
    const depositToAddr = subAccount ? (subAccount as Address) : userAddr

    const hasSigned = await hasSignature(userAddr)
    const allowance = await checkAllowance(assetAddr, vaultAddr, userAddr)

    const steps: TxStep[] = []

    if (allowance < amount) {
      const approveData = encodeFunctionData({
        abi: erc20ABI,
        functionName: 'approve',
        args: [vaultAddr, maxUint256],
      })

      steps.push({
        type: 'approve',
        label: 'Approve asset for vault',
        to: assetAddr,
        abi: erc20ABI as Abi,
        functionName: 'approve',
        args: [vaultAddr, maxUint256] as const,
        value: 0n,
      })
    }

    const hooks = new SaHooksBuilder()

    hooks.addContractInterface(vaultAddr, [
      'function deposit(uint256,address) external',
    ])

    if (!hasSigned) {
      hooks.addContractInterface(tosSignerAddress, [
        'function signTermsOfUse(string,bytes32) external',
      ])
    }

    hooks.setMainCallHookCallFromSelf(vaultAddr, 'deposit', [amount, depositToAddr])

    const saHooks = hooks.build()
    const evcCalls = convertSaHooksToEVCCalls(saHooks, userAddr, depositToAddr)

    if (!hasSigned) {
      const tosCall = {
        targetContract: tosSignerAddress,
        onBehalfOfAccount: userAddr,
        value: 0n,
        data: hooks.getDataForCall(
          tosSignerAddress,
          'signTermsOfUse',
          [FINAL_MESSAGE, FINAL_HASH],
        ) as Hex,
      }
      evcCalls.unshift(tosCall)
    }

    steps.push({
      type: 'evc-batch',
      label: 'Supply via EVC',
      to: evcAddress,
      abi: EVC_ABI,
      functionName: 'batch',
      args: [evcCalls] as const,
      value: 0n,
    })

    return {
      kind: 'supply',
      steps,
    }
  }

  const supply = async (vaultAddress: string, assetAddress: string, amount: bigint, _symbol: string, subAccount?: string) => {
    if (!address.value || !eulerCoreAddresses.value || !eulerPeripheryAddresses.value) {
      throw new Error('Wallet not connected or addresses not available')
    }

    const vaultAddr = vaultAddress as Address
    const assetAddr = assetAddress as Address
    const userAddr = address.value as Address
    const evcAddress = eulerCoreAddresses.value.evc as Address
    const tosSignerAddress = eulerPeripheryAddresses.value.termsOfUseSigner as Address
    const depositToAddr = subAccount ? (subAccount as Address) : userAddr

    const hasSigned = await hasSignature(userAddr)
    const allowance = await checkAllowance(assetAddr, vaultAddr, userAddr)
    const needsApproval = allowance < amount

    if (needsApproval) {
      const approvalHash = await writeContractAsync({
        address: assetAddr,
        abi: erc20ABI,
        functionName: 'approve',
        args: [vaultAddr, maxUint256],
      })

      const provider = new ethers.JsonRpcProvider(EVM_PROVIDER_URL)
      await provider.waitForTransaction(approvalHash)
    }

    const hooks = new SaHooksBuilder()

    hooks.addContractInterface(vaultAddr, [
      'function deposit(uint256,address) external',
    ])

    if (!hasSigned) {
      hooks.addContractInterface(tosSignerAddress, [
        'function signTermsOfUse(string,bytes32) external',
      ])
    }

    hooks.setMainCallHookCallFromSelf(vaultAddr, 'deposit', [amount, depositToAddr])

    const saHooks = hooks.build()
    const evcCalls = convertSaHooksToEVCCalls(saHooks, userAddr, depositToAddr)

    if (!hasSigned) {
      const tosCall = {
        targetContract: tosSignerAddress,
        onBehalfOfAccount: userAddr,
        value: 0n,
        data: hooks.getDataForCall(tosSignerAddress, 'signTermsOfUse', [FINAL_MESSAGE, FINAL_HASH]) as Hash,
      }
      evcCalls.unshift(tosCall)
    }

    if (needsApproval) {
      const approveData = hooks.getDataForCall(assetAddr, 'approve', [vaultAddr, maxUint256]) as Hash
      const approveCall: EVCCall = {
        targetContract: assetAddr,
        onBehalfOfAccount: depositToAddr,
        value: 0n,
        data: approveData,
      }
      evcCalls.unshift(approveCall)
    }

    const depositHash = await writeContractAsync({
      address: evcAddress,
      abi: EVC_ABI,
      functionName: 'batch',
      args: [evcCalls as never],
      value: 0n,
    })

    return depositHash
  }

  const withdraw = async (
    vaultAddress: string,
    _assetAddress: string,
    assetsAmount: bigint,
    _symbol: string,
    subAccount?: string,
    _maxSharesAmount?: bigint,
    _isMax?: boolean,
  ) => {
    if (!address.value || !eulerCoreAddresses.value || !eulerPeripheryAddresses.value) {
      throw new Error('Wallet not connected or addresses not available')
    }

    const vaultAddr = vaultAddress as Address
    const userAddr = address.value as Address
    const evcAddress = eulerCoreAddresses.value.evc as Address
    const tosSignerAddress = eulerPeripheryAddresses.value.termsOfUseSigner as Address
    const withdrawFromAddr = subAccount ? (subAccount as Address) : userAddr

    const hasSigned = await hasSignature(userAddr)

    const hooks = new SaHooksBuilder()

    hooks.addContractInterface(vaultAddr, [
      'function withdraw(uint256,address,address) external',
    ])

    if (!hasSigned) {
      hooks.addContractInterface(tosSignerAddress, [
        'function signTermsOfUse(string,bytes32) external',
      ])
    }

    // When withdrawing from a subaccount, the call must be from SA perspective (on behalf of subaccount)
    if (subAccount) {
      hooks.setMainCallHookCallFromSA(vaultAddr, 'withdraw', [assetsAmount, userAddr, withdrawFromAddr])
    }
    else {
      hooks.setMainCallHookCallFromSelf(vaultAddr, 'withdraw', [assetsAmount, userAddr, withdrawFromAddr])
    }

    const saHooks = hooks.build()
    const evcCalls = convertSaHooksToEVCCalls(saHooks, userAddr, withdrawFromAddr)

    if (!hasSigned) {
      const tosCall = {
        targetContract: tosSignerAddress,
        onBehalfOfAccount: userAddr,
        value: 0n,
        data: hooks.getDataForCall(tosSignerAddress, 'signTermsOfUse', [FINAL_MESSAGE, FINAL_HASH]) as Hash,
      }
      evcCalls.unshift(tosCall)
    }

    const withdrawHash = await writeContractAsync({
      address: evcAddress,
      abi: EVC_ABI,
      functionName: 'batch',
      args: [evcCalls as never],
      value: 0n,
    })

    return withdrawHash
  }

  const redeem = async (
    vaultAddress: string,
    _assetAddress: string,
    assetsAmount: bigint,
    _symbol: string,
    subAccount?: string,
    maxSharesAmount?: bigint,
    isMax?: boolean,
  ) => {
    if (!address.value || !eulerCoreAddresses.value || !eulerPeripheryAddresses.value) {
      throw new Error('Wallet not connected or addresses not available')
    }

    const vaultAddr = vaultAddress as Address
    const userAddr = address.value as Address
    const evcAddress = eulerCoreAddresses.value.evc as Address
    const tosSignerAddress = eulerPeripheryAddresses.value.termsOfUseSigner as Address

    const hasSigned = await hasSignature(userAddr)

    const provider = new ethers.JsonRpcProvider(EVM_PROVIDER_URL)
    const vaultContract = new ethers.Contract(vaultAddr, [
      'function previewWithdraw(uint256) external view returns (uint256)',
    ], provider)

    let sharesAmount = isMax
      ? maxSharesAmount || 0n
      : await vaultContract.previewWithdraw(assetsAmount).catch(() => 0n)

    if (isMax === false && maxSharesAmount && (sharesAmount > maxSharesAmount)) {
      sharesAmount = maxSharesAmount
    }

    const hooks = new SaHooksBuilder()

    hooks.addContractInterface(vaultAddr, [
      'function redeem(uint256,address,address) external',
    ])

    if (!hasSigned) {
      hooks.addContractInterface(tosSignerAddress, [
        'function signTermsOfUse(string,bytes32) external',
      ])
    }

    hooks.setMainCallHookCallFromSelf(vaultAddr, 'redeem', [sharesAmount, userAddr, userAddr])

    const saHooks = hooks.build()
    const evcCalls = convertSaHooksToEVCCalls(saHooks, userAddr, userAddr)

    if (!hasSigned) {
      const tosCall = {
        targetContract: tosSignerAddress,
        onBehalfOfAccount: userAddr,
        value: 0n,
        data: hooks.getDataForCall(tosSignerAddress, 'signTermsOfUse', [FINAL_MESSAGE, FINAL_HASH]) as Hash,
      }
      evcCalls.unshift(tosCall)
    }

    const redeemHash = await writeContractAsync({
      address: evcAddress,
      abi: EVC_ABI,
      functionName: 'batch',
      args: [evcCalls as never],
      value: 0n,
    })

    return redeemHash
  }

  const borrow = async (
    vaultAddress: string,
    assetAddress: string,
    amount: bigint,
    borrowVaultAddress: string,
    _borrowAssetAddress: string,
    borrowAmount: bigint,
    _assetSymbol: string,
    subAccount?: string,
  ) => {
    if (!address.value || !eulerCoreAddresses.value || !eulerPeripheryAddresses.value) {
      throw new Error('Wallet not connected or addresses not available')
    }

    const vaultAddr = vaultAddress as Address
    const assetAddr = assetAddress as Address
    const borrowVaultAddr = borrowVaultAddress as Address
    const userAddr = address.value as Address
    const evcAddress = eulerCoreAddresses.value.evc as Address
    const tosSignerAddress = eulerPeripheryAddresses.value.termsOfUseSigner as Address

    const subAccountAddr = subAccount || await getNewSubAccount(address.value)

    const hasSigned = await hasSignature(userAddr)

    if (amount > 0n) {
      const allowance = await checkAllowance(assetAddr, vaultAddr, userAddr)
      const needsApproval = allowance < amount

      if (needsApproval) {
        const approvalHash = await writeContractAsync({
          address: assetAddr,
          abi: erc20ABI,
          functionName: 'approve',
          args: [vaultAddr, maxUint256],
        })

        const provider = new ethers.JsonRpcProvider(EVM_PROVIDER_URL)
        await provider.waitForTransaction(approvalHash)
      }
    }

    const hooks = new SaHooksBuilder()

    hooks.addContractInterface(vaultAddr, [
      'function deposit(uint256,address) external',
    ])
    hooks.addContractInterface(borrowVaultAddr, [
      'function borrow(uint256,address) external',
    ])
    hooks.addContractInterface(evcAddress, [
      'function enableController(address,address) external',
      'function enableCollateral(address,address) external',
    ])

    if (!hasSigned) {
      hooks.addContractInterface(tosSignerAddress, [
        'function signTermsOfUse(string,bytes32) external',
      ])
    }

    const saHooks = hooks.build()
    const evcCalls = convertSaHooksToEVCCalls(saHooks, userAddr, userAddr)

    if (!hasSigned) {
      const tosCall = {
        targetContract: tosSignerAddress,
        onBehalfOfAccount: userAddr,
        value: 0n,
        data: hooks.getDataForCall(tosSignerAddress, 'signTermsOfUse', [FINAL_MESSAGE, FINAL_HASH]) as Hash,
      }
      evcCalls.unshift(tosCall)
    }

    const depositCall = {
      targetContract: vaultAddr,
      onBehalfOfAccount: userAddr,
      value: 0n,
      data: hooks.getDataForCall(vaultAddr, 'deposit', [amount, subAccountAddr]) as Hash,
    }

    const enableControllerCall = {
      targetContract: evcAddress,
      onBehalfOfAccount: '0x0000000000000000000000000000000000000000' as Address,
      value: 0n,
      data: hooks.getDataForCall(evcAddress, 'enableController', [subAccountAddr, borrowVaultAddr]) as Hash,
    }

    const enableCollateralCall = {
      targetContract: evcAddress,
      onBehalfOfAccount: '0x0000000000000000000000000000000000000000' as Address,
      value: 0n,
      data: hooks.getDataForCall(evcAddress, 'enableCollateral', [subAccountAddr, vaultAddr]) as Hash,
    }

    const borrowCall = {
      targetContract: borrowVaultAddr,
      onBehalfOfAccount: subAccountAddr,
      value: 0n,
      data: hooks.getDataForCall(borrowVaultAddr, 'borrow', [borrowAmount, userAddr]) as Hash,
    }

    evcCalls.push(depositCall as EVCCall, enableControllerCall as EVCCall, enableCollateralCall as EVCCall, borrowCall as EVCCall)

    const borrowHash = await writeContractAsync({
      address: evcAddress,
      abi: EVC_ABI,
      functionName: 'batch',
      args: [evcCalls as never],
      value: 0n,
    })

    return borrowHash
  }

  const borrowBySaving = async (
    vaultAddress: string,
    _assetAddress: string,
    amount: bigint,
    borrowVaultAddress: string,
    _borrowAssetAddress: string,
    borrowAmount: bigint,
    _assetSymbol: string,
    subAccount?: string,
  ) => {
    if (!address.value || !eulerCoreAddresses.value || !eulerPeripheryAddresses.value) {
      throw new Error('Wallet not connected or addresses not available')
    }

    const vaultAddr = vaultAddress as Address
    const borrowVaultAddr = borrowVaultAddress as Address
    const userAddr = address.value as Address
    const evcAddress = eulerCoreAddresses.value.evc as Address
    const tosSignerAddress = eulerPeripheryAddresses.value.termsOfUseSigner as Address

    const subAccountAddr = subAccount || await getNewSubAccount(address.value)

    const hasSigned = await hasSignature(userAddr)

    const hooks = new SaHooksBuilder()

    // Add interface for vault share transfer
    hooks.addContractInterface(vaultAddr, [
      'function transfer(address,uint256) external',
    ])
    hooks.addContractInterface(borrowVaultAddr, [
      'function borrow(uint256,address) external',
    ])
    hooks.addContractInterface(evcAddress, [
      'function enableCollateral(address,address) external',
      'function enableController(address,address) external',
    ])

    if (!hasSigned) {
      hooks.addContractInterface(tosSignerAddress, [
        'function signTermsOfUse(string,bytes32) external',
      ])
    }

    // CRITICAL: Transfer vault shares from main account to subaccount
    // This makes the shares available as collateral for the subaccount
    hooks.addPreHookCallFromSelf(vaultAddr, 'transfer', [subAccountAddr, amount])

    const saHooks = hooks.build()
    const evcCalls = convertSaHooksToEVCCalls(saHooks, userAddr, userAddr)

    if (!hasSigned) {
      const tosCall = {
        targetContract: tosSignerAddress,
        onBehalfOfAccount: userAddr,
        value: 0n,
        data: hooks.getDataForCall(tosSignerAddress, 'signTermsOfUse', [FINAL_MESSAGE, FINAL_HASH]) as Hash,
      }
      evcCalls.unshift(tosCall)
    }

    // Enable the borrow vault as controller
    const enableControllerCall = {
      targetContract: evcAddress,
      onBehalfOfAccount: '0x0000000000000000000000000000000000000000' as Address,
      value: 0n,
      data: hooks.getDataForCall(evcAddress, 'enableController', [subAccountAddr, borrowVaultAddr]) as Hash,
    }

    // Enable the savings vault as collateral
    const enableCollateralCall = {
      targetContract: evcAddress,
      onBehalfOfAccount: '0x0000000000000000000000000000000000000000' as Address,
      value: 0n,
      data: hooks.getDataForCall(evcAddress, 'enableCollateral', [subAccountAddr, vaultAddr]) as Hash,
    }

    // Borrow from the borrow vault
    const borrowCall = {
      targetContract: borrowVaultAddr,
      onBehalfOfAccount: subAccountAddr,
      value: 0n,
      data: hooks.getDataForCall(borrowVaultAddr, 'borrow', [borrowAmount, userAddr]) as Hash,
    }

    evcCalls.push(enableControllerCall as EVCCall, enableCollateralCall as EVCCall, borrowCall as EVCCall)

    const borrowHash = await writeContractAsync({
      address: evcAddress,
      abi: EVC_ABI,
      functionName: 'batch',
      args: [evcCalls as never],
      value: 0n,
    })

    return borrowHash
  }

  const repay = async (borrowVaultAddress: string, borrowAssetAddress: string, amount: bigint, subAccount: string) => {
    if (!address.value || !eulerCoreAddresses.value || !eulerPeripheryAddresses.value) {
      throw new Error('Wallet not connected or addresses not available')
    }

    const borrowVaultAddr = borrowVaultAddress as Address
    const borrowAssetAddr = borrowAssetAddress as Address
    const userAddr = address.value as Address
    const subAccountAddr = subAccount as Address
    const evcAddress = eulerCoreAddresses.value.evc as Address
    const tosSignerAddress = eulerPeripheryAddresses.value.termsOfUseSigner as Address

    const hasSigned = await hasSignature(userAddr)

    const allowance = await checkAllowance(borrowAssetAddr, borrowVaultAddr, userAddr)
    const needsApproval = allowance < amount

    if (needsApproval) {
      const approvalHash = await writeContractAsync({
        address: borrowAssetAddr,
        abi: erc20ABI,
        functionName: 'approve',
        args: [borrowVaultAddr, maxUint256],
      })

      const provider = new ethers.JsonRpcProvider(EVM_PROVIDER_URL)
      await provider.waitForTransaction(approvalHash)
    }

    const hooks = new SaHooksBuilder()

    hooks.addContractInterface(borrowVaultAddr, [
      'function repay(uint256,address) external',
    ])

    if (!hasSigned) {
      hooks.addContractInterface(tosSignerAddress, [
        'function signTermsOfUse(string,bytes32) external',
      ])
    }

    hooks.setMainCallHookCallFromSelf(borrowVaultAddr, 'repay', [amount, subAccountAddr])

    const saHooks = hooks.build()
    const evcCalls = convertSaHooksToEVCCalls(saHooks, userAddr, subAccountAddr)

    if (!hasSigned) {
      const tosCall = {
        targetContract: tosSignerAddress,
        onBehalfOfAccount: userAddr,
        value: 0n,
        data: hooks.getDataForCall(tosSignerAddress, 'signTermsOfUse', [FINAL_MESSAGE, FINAL_HASH]) as Hash,
      }
      evcCalls.unshift(tosCall)
    }

    const repayHash = await writeContractAsync({
      address: evcAddress,
      abi: EVC_ABI,
      functionName: 'batch',
      args: [evcCalls as never],
      value: 0n,
    })

    return repayHash
  }

  const fullRepay = async (
    borrowVaultAddress: string,
    borrowAssetAddress: string,
    amount: bigint,
    subAccount: string,
    vaultAddress: string,
  ) => {
    if (!address.value || !eulerCoreAddresses.value || !eulerPeripheryAddresses.value) {
      throw new Error('Wallet not connected or addresses not available')
    }

    const vaultAddr = vaultAddress as Address
    const borrowVaultAddr = borrowVaultAddress as Address
    const borrowAssetAddr = borrowAssetAddress as Address
    const userAddr = address.value as Address
    const subAccountAddr = subAccount as Address
    const evcAddress = eulerCoreAddresses.value.evc as Address
    const tosSignerAddress = eulerPeripheryAddresses.value.termsOfUseSigner as Address

    const hasSigned = await hasSignature(userAddr)
    const allowance = await checkAllowance(borrowAssetAddr, borrowVaultAddr, userAddr)
    const needsApproval = allowance < amount

    const provider = new ethers.JsonRpcProvider(EVM_PROVIDER_URL)

    if (needsApproval) {
      const approvalHash = await writeContractAsync({
        address: borrowAssetAddr,
        abi: erc20ABI,
        functionName: 'approve',
        args: [borrowVaultAddr, maxUint256],
      })

      await provider.waitForTransaction(approvalHash)
    }

    const vaultContract = new ethers.Contract(vaultAddr, [
      'function balanceOf(address) external view returns (uint256)',
      'function convertToAssets(uint256) external view returns (uint256)',
    ], provider)

    const subAccountShares = await vaultContract.balanceOf(subAccountAddr).catch(() => 0n)
    const subAccountAssets = await vaultContract.convertToAssets(subAccountShares).catch(() => 0n)

    console.log('subAccountShares', subAccountShares)
    console.log('subAccountAssets', subAccountAssets)

    const hooks = new SaHooksBuilder()

    hooks.addContractInterface(borrowVaultAddr, [
      'function repay(uint256,address) external',
      'function disableController() external',
    ])
    hooks.addContractInterface(vaultAddr, [
      'function redeem(uint256,address,address) external',
      'function deposit(uint256,address) external',
    ])
    hooks.addContractInterface(evcAddress, [
      'function disableCollateral(address,address) external',
    ])

    if (!hasSigned) {
      hooks.addContractInterface(tosSignerAddress, [
        'function signTermsOfUse(string,bytes32) external',
      ])
    }

    const evcCalls = []

    if (!hasSigned) {
      const tosCall = {
        targetContract: tosSignerAddress,
        onBehalfOfAccount: userAddr,
        value: 0n,
        data: hooks.getDataForCall(tosSignerAddress, 'signTermsOfUse', [FINAL_MESSAGE, FINAL_HASH]) as Hash,
      }
      evcCalls.push(tosCall)
    }

    const repayCall = {
      targetContract: borrowVaultAddr,
      onBehalfOfAccount: userAddr,
      value: 0n,
      data: hooks.getDataForCall(borrowVaultAddr, 'repay', [maxUint256, subAccountAddr]) as Hash,
    }

    const disableControllerCall = {
      targetContract: borrowVaultAddr,
      onBehalfOfAccount: subAccountAddr,
      value: 0n,
      data: hooks.getDataForCall(borrowVaultAddr, 'disableController', []) as Hash,
    }

    const disableCollateralCall = {
      targetContract: evcAddress,
      onBehalfOfAccount: '0x0000000000000000000000000000000000000000' as Address,
      value: 0n,
      data: hooks.getDataForCall(evcAddress, 'disableCollateral', [subAccountAddr, vaultAddr]) as Hash,
    }

    const redeemCall = {
      targetContract: vaultAddr,
      onBehalfOfAccount: subAccountAddr,
      value: 0n,
      data: hooks.getDataForCall(vaultAddr, 'redeem', [subAccountShares, userAddr, subAccountAddr]) as Hash,
    }

    const depositCall = {
      targetContract: vaultAddr,
      onBehalfOfAccount: userAddr,
      value: 0n,
      data: hooks.getDataForCall(vaultAddr, 'deposit', [subAccountAssets, userAddr]) as Hash,
    }

    evcCalls.push(repayCall, disableControllerCall, disableCollateralCall, redeemCall, depositCall)

    const fullRepayHash = await writeContractAsync({
      address: evcAddress,
      abi: EVC_ABI,
      functionName: 'batch',
      args: [evcCalls as never],
      value: 0n,
    })

    return fullRepayHash
  }

  const disableCollateral = async (
    subAccount: string,
    vaultAddress: string,
    _borrowVaultAddress: string,
  ) => {
    if (!address.value || !eulerCoreAddresses.value || !eulerPeripheryAddresses.value) {
      throw new Error('Wallet not connected or addresses not available')
    }

    const vaultAddr = vaultAddress as Address
    const userAddr = address.value as Address
    const subAccountAddr = subAccount as Address
    const evcAddress = eulerCoreAddresses.value.evc as Address
    const tosSignerAddress = eulerPeripheryAddresses.value.termsOfUseSigner as Address

    const hasSigned = await hasSignature(userAddr)

    const hooks = new SaHooksBuilder()

    hooks.addContractInterface(vaultAddr, [
      'function redeem(uint256,address,address) external',
    ])

    if (!hasSigned) {
      hooks.addContractInterface(tosSignerAddress, [
        'function signTermsOfUse(string,bytes32) external',
      ])
    }

    const redeemCall = {
      targetContract: vaultAddr,
      onBehalfOfAccount: subAccountAddr,
      value: 0n,
      data: hooks.getDataForCall(vaultAddr, 'redeem', [maxUint256, userAddr, subAccountAddr]) as Hash,
    }

    const evcCalls = [redeemCall]

    if (!hasSigned) {
      const tosCall = {
        targetContract: tosSignerAddress,
        onBehalfOfAccount: userAddr,
        value: 0n,
        data: hooks.getDataForCall(tosSignerAddress, 'signTermsOfUse', [FINAL_MESSAGE, FINAL_HASH]) as Hash,
      }
      evcCalls.unshift(tosCall)
    }

    const disableHash = await writeContractAsync({
      address: evcAddress,
      abi: EVC_ABI,
      functionName: 'batch',
      args: [evcCalls as never],
      value: 0n,
    })

    return disableHash
  }

  return {
    supply,
    withdraw,
    redeem,
    repay,
    borrow,
    borrowBySaving,
    fullRepay,
    disableCollateral,
    executeTxPlan,
    buildSupplyPlan
  }
}
