import { BaseError, ContractFunctionRevertedError } from 'viem'

const ERROR_MESSAGE_MAP: Record<string, string> = {
  E_SupplyCapExceeded: 'Supply cap reached for this vault.',
  E_BorrowCapExceeded: 'Borrow cap reached for this vault.',
  E_BadSupplyCap: 'Supply cap is invalid.',
  E_BadBorrowCap: 'Borrow cap is invalid.',
  E_AccountLiquidity: 'Account liquidity too low for this action.',
  E_InsufficientCash: 'Not enough liquidity in the vault.',
  E_NotEnoughLiquidity: 'Not enough liquidity in the vault.',
  NotEnoughLiquidity: 'Not enough liquidity in the vault.',
  E_TransferFromFailed: 'Token transfer failed.',
  ERC4626ExceededMaxDeposit: 'Deposit exceeds vault limits.',
  ERC4626ExceededMaxWithdraw: 'Withdraw exceeds vault limits.',
  ERC4626ExceededMaxRedeem: 'Redeem exceeds vault limits.',
  INSUFFICIENT_BALANCE: 'Insufficient balance.',
  INSUFFICIENT_ALLOWANCE: 'Insufficient allowance.',
  TRANSFER_FROM_FAILED: 'Token transfer failed.',
  TRANSFER_FAILED: 'Token transfer failed.',
  SAFE_TRANSFER_FAILED: 'Token transfer failed.',
  SAFE_TRANSFER_FROM_FAILED: 'Token transfer failed.',
}

const ERROR_SIGNATURE_MAP: Record<string, string> = {
  '0x9773bb71': 'E_TransferFromFailed',
}

const parseErrorCodeFromMessage = (message: string) => {
  const match = message.match(/execution reverted: (.+)$/i)
  if (match?.[1]) {
    return match[1].trim()
  }
  return undefined
}

const parseErrorSignatureFromMessage = (message: string) => {
  const match = message.match(/signature:\s*(0x[0-9a-fA-F]{8})/i) || message.match(/(0x[0-9a-fA-F]{8})/)
  return match?.[1]?.toLowerCase()
}

const extractErrorCode = (error: unknown) => {
  if (error instanceof BaseError) {
    const revertError = error.walk((err) => err instanceof ContractFunctionRevertedError)
    if (
      revertError instanceof ContractFunctionRevertedError
      && revertError.data?.errorName
      && revertError.data.errorName !== 'Error'
    ) {
      return revertError.data.errorName
    }
    if (revertError instanceof ContractFunctionRevertedError && revertError.reason) {
      return revertError.reason
    }
    if (error.shortMessage) {
      const signature = parseErrorSignatureFromMessage(error.shortMessage)
      if (signature && ERROR_SIGNATURE_MAP[signature]) {
        return ERROR_SIGNATURE_MAP[signature]
      }
      return parseErrorCodeFromMessage(error.shortMessage) || error.shortMessage
    }
  }

  if (error instanceof Error) {
    const signature = parseErrorSignatureFromMessage(error.message)
    if (signature && ERROR_SIGNATURE_MAP[signature]) {
      return ERROR_SIGNATURE_MAP[signature]
    }
    return parseErrorCodeFromMessage(error.message) || error.message
  }

  return undefined
}

export const getTxErrorCode = (error: unknown) => {
  return extractErrorCode(error)
}

const NON_BLOCKING_SIMULATION_ERRORS = new Set([
  'E_TransferFromFailed',
  'INSUFFICIENT_ALLOWANCE',
  'E_InsufficientAllowance',
  'TRANSFER_FROM_FAILED',
  'TRANSFER_FAILED',
  'SAFE_TRANSFER_FAILED',
  'SAFE_TRANSFER_FROM_FAILED',
  '0x9773bb71',
])

export const isNonBlockingSimulationError = (error: unknown) => {
  const code = extractErrorCode(error)
  return code ? NON_BLOCKING_SIMULATION_ERRORS.has(code) : false
}

export const getTxErrorMessage = (error: unknown) => {
  const code = extractErrorCode(error)
  if (code) {
    return ERROR_MESSAGE_MAP[code] || `Transaction simulation failed: ${code}`
  }
  return 'Transaction simulation failed.'
}
