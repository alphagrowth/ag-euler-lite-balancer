export const reulWithdrawABI = [
  {
    type: 'function',
    name: 'withdrawToByLockTimestamp',
    inputs: [
      {
        name: 'account',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'lockTimestamp',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'allowRemainderLoss',
        type: 'bool',
        internalType: 'bool',
      },
    ],
    outputs: [
      {
        name: 'success',
        type: 'bool',
        internalType: 'bool',
      },
    ],
    stateMutability: 'nonpayable',
  },
] as const

export const reulLockAbi = [
  'function getLockedAmounts(address account) view returns (uint256[], uint256[])',
  'function getWithdrawAmountsByLockTimestamp(address account, uint256 lockTimestamp) view returns (uint256, uint256)',
  'function withdrawToByLockTimestamp(address account, uint256 lockTimestamp, bool allowRemainderLoss) external',
] as const
