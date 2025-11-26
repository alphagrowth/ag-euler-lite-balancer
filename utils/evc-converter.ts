import type { Address, Hash } from 'viem'
import { encodeFunctionData } from 'viem'
import type { SaHooks } from '~/entities/saHooksSDK'

export interface EVCCall {
  targetContract: Address
  onBehalfOfAccount: Address
  value: bigint
  data: Hash
}

export const EVC_ABI = [
  {
    inputs: [
      {
        components: [
          { name: 'targetContract', type: 'address' },
          { name: 'onBehalfOfAccount', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'data', type: 'bytes' },
        ],
        name: 'items',
        type: 'tuple[]',
      },
    ],
    name: 'batch',
    outputs: [],
    stateMutability: 'payable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'account', type: 'address' },
      { name: 'operator', type: 'address' },
    ],
    name: 'isAccountOperatorAuthorized',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const

export function convertSaHooksToEVCCalls(
  saHooks: SaHooks,
  userAddress: Address,
  saAddress: Address,
): EVCCall[] {
  const evcCalls: EVCCall[] = []

  for (const preHook of saHooks.preHooks) {
    evcCalls.push({
      targetContract: preHook.contractAddress as Address,
      onBehalfOfAccount: preHook.isFromSAPerspective ? saAddress : userAddress,
      value: preHook.value,
      data: preHook.data as Hash,
    })
  }

  if (saHooks.mainCallHook.contractAddress !== '0x0000000000000000000000000000000000000000') {
    evcCalls.push({
      targetContract: saHooks.mainCallHook.contractAddress as Address,
      onBehalfOfAccount: saHooks.mainCallHook.isFromSAPerspective ? saAddress : userAddress,
      value: saHooks.mainCallHook.value,
      data: saHooks.mainCallHook.data as Hash,
    })
  }

  for (const postHook of saHooks.postHooks) {
    evcCalls.push({
      targetContract: postHook.contractAddress as Address,
      onBehalfOfAccount: postHook.isFromSAPerspective ? saAddress : userAddress,
      value: postHook.value,
      data: postHook.data as Hash,
    })
  }

  return evcCalls
}

export function encodeEVCBatch(calls: EVCCall[]): Hash {
  return encodeFunctionData({
    abi: EVC_ABI,
    functionName: 'batch',
    args: [calls],
  })
}
