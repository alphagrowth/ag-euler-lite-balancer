export const vaultBorrowAbi = [
  'function borrow(uint256,address) external',
] as const

export const vaultRepayAbi = [
  'function repay(uint256,address) external',
] as const

export const vaultDepositAbi = [
  'function deposit(uint256,address) external',
] as const

export const vaultWithdrawAbi = [
  'function withdraw(uint256,address,address) external',
] as const

export const vaultRedeemAbi = [
  'function redeem(uint256,address,address) external',
] as const

export const vaultPreviewWithdrawAbi = [
  'function previewWithdraw(uint256) external view returns (uint256)',
] as const

export const vaultConvertToAssetsAbi = [
  'function convertToAssets(uint256) external view returns (uint256)',
] as const

export const vaultConvertToSharesAbi = [
  'function convertToShares(uint256) external view returns (uint256)',
] as const

export const vaultMaxWithdrawAbi = [
  'function maxWithdraw(address) external view returns (uint256)',
] as const

export const vaultTransferFromMaxAbi = [
  'function transferFromMax(address,address) external returns (bool)',
] as const
