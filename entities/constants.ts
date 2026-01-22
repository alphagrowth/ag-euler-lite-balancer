import { CUSTOM_ICON_TOKENS } from './customTokens'

export { CUSTOM_ICON_TOKENS }

export const ERROR_MESSAGE_MAP: Record<string, string> = {
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

export const ERROR_SIGNATURE_MAP: Record<string, string> = {
  '0x9773bb71': 'E_TransferFromFailed',
}

export const NON_BLOCKING_SIMULATION_ERRORS = new Set([
  'E_TransferFromFailed',
  'INSUFFICIENT_ALLOWANCE',
  'E_InsufficientAllowance',
  'TRANSFER_FROM_FAILED',
  'TRANSFER_FAILED',
  'SAFE_TRANSFER_FAILED',
  'SAFE_TRANSFER_FROM_FAILED',
  '0x9773bb71',
])

export const TTL_INFINITY = BigInt(
  '0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
)
export const TTL_MORE_THAN_ONE_YEAR = TTL_INFINITY - BigInt(1)
export const TTL_LIQUIDATION = -BigInt(1)
export const TTL_ERROR = -BigInt(2)

export const DEFAULT_PRICE_CACHE_TTL_MS = 15_000
export const SWAP_DEFAULT_DEADLINE_SECONDS = 1800

export const USD_ADDRESS = '0x0000000000000000000000000000000000000348'
export const EUR_ADDRESS = '0x00000000000000000000000000000000000003d2'

export const FINAL_MESSAGE = 'By proceeding to engage with and use Euler, you accept and agree to abide by the Terms of Use: https://www.euler.finance/terms  hash:0x1a7aa1916b6c56272b62be027108c06d9af95eef4dac46acbc80267b3919e07e'
export const FINAL_HASH = '0xb0d552b4ebe441d9582f5fc732fd6026b09bec13e7f3c1e21c0ecaa3801df595'
export const ALLOWANCE_SLOT_CANDIDATES = [0n, 1n, 2n, 3n] as const
export const PERMIT2_SIG_WINDOW = 60n * 60n

export const DEFI_LLAMA_CHAIN_BY_CHAIN_ID: Record<number, string> = {
  1: 'Ethereum',
  56: 'BSC',
  130: 'Unichain',
  146: 'Sonic',
  239: 'TAC',
  1923: 'Swell',
  42161: 'Arbitrum',
  43114: 'Avalanche',
  59144: 'Linea',
  60808: 'BOB',
  80094: 'Berachain',
  8453: 'Base',
  9745: 'Plasma',
} as const

export const INTEREST_RATE_MODEL_TYPE = {
  KINK: 1,
  ADAPTIVE_CURVE: 2,
} as const

export const ORACLE_DETAILED_INFO_COMPONENTS = [
  { name: 'oracle', type: 'address' },
  { name: 'name', type: 'string' },
  { name: 'oracleInfo', type: 'bytes' },
] as const

export const EULER_ROUTER_COMPONENTS = [
  { name: 'governor', type: 'address' },
  { name: 'fallbackOracle', type: 'address' },
  { name: 'fallbackOracleInfo', type: 'tuple', components: ORACLE_DETAILED_INFO_COMPONENTS },
  { name: 'bases', type: 'address[]' },
  { name: 'quotes', type: 'address[]' },
  { name: 'resolvedAssets', type: 'address[][]' },
  { name: 'resolvedOracles', type: 'address[]' },
  { name: 'resolvedOraclesInfo', type: 'tuple[]', components: ORACLE_DETAILED_INFO_COMPONENTS },
] as const

export const CROSS_ADAPTER_COMPONENTS = [
  { name: 'base', type: 'address' },
  { name: 'cross', type: 'address' },
  { name: 'quote', type: 'address' },
  { name: 'oracleBaseCross', type: 'address' },
  { name: 'oracleCrossQuote', type: 'address' },
  { name: 'oracleBaseCrossInfo', type: 'tuple', components: ORACLE_DETAILED_INFO_COMPONENTS },
  { name: 'oracleCrossQuoteInfo', type: 'tuple', components: ORACLE_DETAILED_INFO_COMPONENTS },
] as const

export const PYTH_ORACLE_COMPONENTS = [
  { name: 'pyth', type: 'address' },
  { name: 'base', type: 'address' },
  { name: 'quote', type: 'address' },
  { name: 'feedId', type: 'bytes32' },
  { name: 'maxStaleness', type: 'uint256' },
  { name: 'maxConfWidth', type: 'uint256' },
] as const

export const SECONDS_IN_YEAR = 31_536_000
export const TARGET_TIME_AGO = 3600

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
