import type { Address } from 'viem'

export const permit2Abi = [
  {
    type: 'function',
    name: 'allowance',
    inputs: [
      { name: 'owner', type: 'address', internalType: 'address' },
      { name: 'token', type: 'address', internalType: 'address' },
      { name: 'spender', type: 'address', internalType: 'address' },
    ],
    outputs: [
      { name: 'amount', type: 'uint160', internalType: 'uint160' },
      { name: 'expiration', type: 'uint48', internalType: 'uint48' },
      { name: 'nonce', type: 'uint48', internalType: 'uint48' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'permit',
    inputs: [
      { name: 'owner', type: 'address', internalType: 'address' },
      {
        name: 'permitSingle',
        type: 'tuple',
        internalType: 'struct IAllowanceTransfer.PermitSingle',
        components: [
          {
            name: 'details',
            type: 'tuple',
            internalType: 'struct IAllowanceTransfer.PermitDetails',
            components: [
              { name: 'token', type: 'address', internalType: 'address' },
              { name: 'amount', type: 'uint160', internalType: 'uint160' },
              { name: 'expiration', type: 'uint48', internalType: 'uint48' },
              { name: 'nonce', type: 'uint48', internalType: 'uint48' },
            ],
          },
          { name: 'spender', type: 'address', internalType: 'address' },
          { name: 'sigDeadline', type: 'uint256', internalType: 'uint256' },
        ],
      },
      { name: 'signature', type: 'bytes', internalType: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const

export const PERMIT2_TYPES = {
  PermitDetails: [
    { name: 'token', type: 'address' },
    { name: 'amount', type: 'uint160' },
    { name: 'expiration', type: 'uint48' },
    { name: 'nonce', type: 'uint48' },
  ],
  PermitSingle: [
    { name: 'details', type: 'PermitDetails' },
    { name: 'spender', type: 'address' },
    { name: 'sigDeadline', type: 'uint256' },
  ],
} as const

export const MAX_UINT48 = (1n << 48n) - 1n
export const MAX_UINT160 = (1n << 160n) - 1n

export type Permit2Details = {
  token: Address
  amount: bigint
  expiration: bigint
  nonce: bigint
}

export type Permit2Permit = {
  details: Permit2Details
  spender: Address
  sigDeadline: bigint
}
