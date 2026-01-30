export const tosSignerReadAbi = [
  'function lastTermsOfUseSignatureTimestamp(address account, bytes32 termsOfUseHash) external view returns (uint256)',
] as const

export const tosSignerWriteAbi = [
  'function signTermsOfUse(string,bytes32) external',
] as const
