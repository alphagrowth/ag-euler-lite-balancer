import type { Address } from 'viem'
import { EVC_ERROR_SIGNATURES } from './evc-error-signatures'

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
  ...EVC_ERROR_SIGNATURES,
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
export const SLIPPAGE_STORAGE_KEY = 'swap-slippage'
export const PERMIT2_PREFERENCE_STORAGE_KEY = 'permit2-enabled'
export const DEFAULT_SLIPPAGE = 0.5
export const MIN_SLIPPAGE = 0
export const MAX_SLIPPAGE = 50

export const USD_ADDRESS: Address = '0x0000000000000000000000000000000000000348'
export const EUR_ADDRESS: Address = '0x00000000000000000000000000000000000003d2'
export const BTC_ADDRESS: Address = '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB'
export const ETH_ADDRESS: Address = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'

export const ALLOWANCE_SLOT_CANDIDATES = [0n, 1n, 2n, 3n] as const
export const PERMIT2_SIG_WINDOW = 60n * 60n

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

export const MERKL_DISTRIBUTOR_ADDRESS = '0x3Ef3D8bA38EBe18DB133cEc108f4D14CE00Dd9Ae'
export const MERKL_API_BASE_URL = 'https://api.merkl.xyz/v4'
export const EULER_INTERFACES_CHAINS_URL = 'https://raw.githubusercontent.com/euler-xyz/euler-interfaces/refs/heads/master/EulerChains.json'
export const DEFILLAMA_YIELDS_URL = 'https://yields.llama.fi/pools'
export const BREVIS_API_URL = 'https://incentra-prd.brevis.network/sdk/v1/eulerCampaigns'
export const BREVIS_MERKLE_PROOF_URL = 'https://incentra-prd.brevis.network/v1/getMerkleProofsBatch'

// Sanctioned countries — always blocked for all products
// Commented-out entries can be enabled when needed
export const SANCTIONED_COUNTRIES: readonly string[] = [
  'AF', // Afghanistan
  'BY', // Belarus
  'CF', // Central African Republic
  'CU', // Cuba
  'KP', // North Korea
  'CD', // DR Congo
  'ET', // Ethiopia
  'IR', // Iran
  'IQ', // Iraq
  'LB', // Lebanon
  'LY', // Libya
  'ML', // Mali
  'MM', // Myanmar
  'NI', // Nicaragua
  'RU', // Russia
  'SO', // Somalia
  'SS', // South Sudan
  'SD', // Sudan
  'SY', // Syria
  // 'UA', // Ukraine (Crimea, Donetsk, Luhansk)
  'VE', // Venezuela
  'YE', // Yemen
  'ZW', // Zimbabwe
]

// EU member states (27 countries)
export const EU_COUNTRIES: readonly string[] = [
  'AT', // Austria
  'BE', // Belgium
  'BG', // Bulgaria
  'HR', // Croatia
  'CY', // Cyprus
  'CZ', // Czechia
  'DK', // Denmark
  'EE', // Estonia
  'FI', // Finland
  'FR', // France
  'DE', // Germany
  'GR', // Greece
  'HU', // Hungary
  'IE', // Ireland
  'IT', // Italy
  'LV', // Latvia
  'LT', // Lithuania
  'LU', // Luxembourg
  'MT', // Malta
  'NL', // Netherlands
  'PL', // Poland
  'PT', // Portugal
  'RO', // Romania
  'SK', // Slovakia
  'SI', // Slovenia
  'ES', // Spain
  'SE', // Sweden
]

// EFTA member states (4 countries)
export const EFTA_COUNTRIES: readonly string[] = [
  'IS', // Iceland
  'LI', // Liechtenstein
  'NO', // Norway
  'CH', // Switzerland
]

// EEA = EU + Iceland, Liechtenstein, Norway (not Switzerland)
export const EEA_COUNTRIES: readonly string[] = [
  ...EU_COUNTRIES,
  'IS', // Iceland
  'LI', // Liechtenstein
  'NO', // Norway
]

// Map of group aliases usable in product/earn-vault `block` arrays
export const COUNTRY_GROUPS: Record<string, readonly string[]> = {
  EU: EU_COUNTRIES,
  EEA: EEA_COUNTRIES,
  EFTA: EFTA_COUNTRIES,
}
