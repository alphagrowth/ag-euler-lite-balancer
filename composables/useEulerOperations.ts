import { useWriteContract, useConfig } from '@wagmi/vue'
import type { Address, Hash } from 'viem'
import { maxUint256 } from 'viem'
import { getPublicClient, waitForTransactionReceipt } from '@wagmi/core'
import { erc20ABI, eVaultABI } from '~/entities/euler/abis'
import { SaHooksBuilder } from '~/entities/saHooksSDK'
import { convertSaHooksToEVCCalls, EVC_ABI } from '~/utils/evc-converter'

const TAC_CHAIN_ID = 239

export const useEulerOperations = () => {
  const { address, chainId } = useWagmi()
  const { writeContractAsync } = useWriteContract()
  const config = useConfig()
  const { eulerCoreAddresses } = useEulerAddresses()

  const isTacChain = computed(() => chainId.value === TAC_CHAIN_ID)

  const checkAllowance = async (assetAddress: Address, vaultAddress: Address, userAddress: Address): Promise<bigint> => {
    if (!chainId.value) {
      throw new Error('Chain ID not available')
    }

    const publicClient = getPublicClient(config, { chainId: chainId.value })
    if (!publicClient) {
      throw new Error('Public client not available')
    }

    const allowance = await publicClient.readContract({
      address: assetAddress,
      abi: erc20ABI,
      functionName: 'allowance',
      args: [userAddress, vaultAddress],
    })

    return allowance as bigint
  }

  const waitForTransactionConfirmation = async (hash: Hash) => {
    if (!chainId.value) {
      throw new Error('Chain ID not available')
    }
    const receipt = await waitForTransactionReceipt(config, {
      hash,
      chainId: chainId.value,
    })
    return receipt
  }

  const supplyWithClassicApproval = async (
    vaultAddr: Address,
    assetAddr: Address,
    userAddr: Address,
    amount: bigint,
  ) => {
    const allowance = await checkAllowance(assetAddr, vaultAddr, userAddr)

    if (allowance < amount) {
      const approveHash = await writeContractAsync({
        address: assetAddr,
        abi: erc20ABI,
        functionName: 'approve',
        args: [vaultAddr, maxUint256],
      })

      await waitForTransactionConfirmation(approveHash)
    }

    const depositHash = await writeContractAsync({
      address: vaultAddr,
      abi: eVaultABI,
      functionName: 'deposit',
      args: [amount, userAddr],
    })

    return depositHash
  }

  const supplyWithEVCBatch = async (
    vaultAddr: Address,
    assetAddr: Address,
    userAddr: Address,
    amount: bigint,
  ) => {
    if (!eulerCoreAddresses.value) {
      throw new Error('Euler addresses not available')
    }

    const evcAddress = eulerCoreAddresses.value.evc as Address

    const hooks = new SaHooksBuilder()

    hooks.addContractInterface(assetAddr, [
      'function approve(address,uint256) external',
    ])
    hooks.addContractInterface(vaultAddr, [
      'function deposit(uint256,address) external',
    ])

    hooks.addPreHookCallFromSelf(assetAddr, 'approve', [vaultAddr, amount])
    hooks.setMainCallHookCallFromSelf(vaultAddr, 'deposit', [amount, userAddr])

    const saHooks = hooks.build()
    const evcCalls = convertSaHooksToEVCCalls(saHooks, userAddr, userAddr)

    console.log('[EVC Batch] Sending batch with', evcCalls.length, 'calls')
    console.log('[EVC Batch] Calls:', evcCalls)

    const depositHash = await writeContractAsync({
      address: evcAddress,
      abi: EVC_ABI,
      functionName: 'batch',
      args: [evcCalls as never],
      value: 0n,
    })

    return depositHash
  }

  const supply = async (vaultAddress: string, assetAddress: string, amount: bigint, _symbol: string) => {
    if (!address.value) {
      throw new Error('Wallet not connected')
    }

    const vaultAddr = vaultAddress as Address
    const assetAddr = assetAddress as Address
    const userAddr = address.value as Address

    console.log('[Supply] Chain ID:', chainId.value, 'Is TAC:', isTacChain.value)

    if (isTacChain.value) {
      console.log('[Supply] Using classic approval flow (TAC chain)')
      return supplyWithClassicApproval(vaultAddr, assetAddr, userAddr, amount)
    }
    else {
      console.log('[Supply] Using EVC batch flow')
      return supplyWithEVCBatch(vaultAddr, assetAddr, userAddr, amount)
    }
  }

  return {
    supply,
  }
}
