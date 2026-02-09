import { getAddress, pad, toHex, type Address } from 'viem'
import { evcGetControllersAbi } from '~/abis/evc'
import axios from 'axios'
import type { EarnVault, SecuritizeVault, Vault } from '~/entities/vault'
import { getPublicClient } from '~/utils/public-client'

export interface AccountVaultLiquidity {
  queryFailure: boolean
  queryFailureReason: string
  account: string
  vault: string
  unitOfAccount: string
  timeToLiquidation: bigint
  liabilityValueBorrowing: bigint
  liabilityValueLiquidation: bigint
  collateralValueBorrowing: bigint
  collateralValueLiquidation: bigint
  collateralValueRaw: bigint
  collaterals: string[]
  collateralValuesBorrowing: bigint[]
  collateralValuesLiquidation: bigint[]
  collateralValuesRaw: bigint[]
}
export interface AccountVault {
  account: string
  asset: string
  assetAllowanceExpirationVaultPermit2: bigint
  assetAllowancePermit2: bigint
  assetAllowanceVault: bigint
  assetAllowanceVaultPermit2: bigint
  assets: bigint
  assetsAccount: bigint
  balanceForwarderEnabled: boolean
  borrowed: bigint
  isCollateral: boolean
  isController: boolean
  liquidityInfo: AccountVaultLiquidity
  vault: string
}
export interface AccountBorrowPosition {
  borrow: Vault
  collateral: Vault | SecuritizeVault
  collaterals?: string[]
  subAccount: string
  health: bigint
  userLTV: bigint
  price: bigint
  supplied: bigint
  borrowed: bigint
  borrowLTV: bigint
  liquidationLTV: bigint
  liabilityValueBorrowing: bigint
  liabilityValueLiquidation: bigint
  timeToLiquidation: bigint
  collateralValueLiquidation: bigint
  liquidityQueryFailure?: boolean
}
export interface AccountDepositPosition {
  vault: Vault | SecuritizeVault | EarnVault
  subAccount: string
  shares: bigint
  assets: bigint
}

export const isPositionEligibleForLiquidation = (position: AccountBorrowPosition | undefined): boolean => {
  if (!position || position.liabilityValueLiquidation === 0n) return false
  if (position.liquidityQueryFailure) return false
  return position.liabilityValueLiquidation > position.collateralValueLiquidation
}

const checkGetController = async (subAccount: string) => {
  const { EVM_PROVIDER_URL } = useEulerConfig()
  const { eulerCoreAddresses } = useEulerAddresses()

  if (!eulerCoreAddresses.value?.evc) {
    console.warn('[checkGetController] EVC address not available')
    return true
  }

  const client = getPublicClient(EVM_PROVIDER_URL)

  try {
    const controllers = await client.readContract({
      address: eulerCoreAddresses.value.evc as Address,
      abi: evcGetControllersAbi,
      functionName: 'getControllers',
      args: [subAccount as Address],
    })
    return (controllers as Address[]).length === 0
  }
  catch (e) {
    console.error('[checkGetController] Error:', e)
    return true
  }
}

/**
 * Derives the subaccount index by XORing the owner address with the subaccount address.
 * The subaccount address is created as: ownerAddress XOR index
 * So: index = ownerAddress XOR subAccountAddress
 */
export const getSubAccountIndex = (ownerAddress: string, subAccountAddress: string): number => {
  const owner = BigInt(getAddress(ownerAddress))
  const subAccount = BigInt(getAddress(subAccountAddress))
  return Number(owner ^ subAccount)
}

export const getNewSubAccount = async (ownerAddress: string) => {
  const { SUBGRAPH_URL } = useEulerConfig()
  const { eulerCoreAddresses, loadEulerConfig } = useEulerAddresses()

  if (!eulerCoreAddresses.value) {
    await loadEulerConfig()
  }

  const address = getAddress(ownerAddress)
  const { data } = await axios.post(SUBGRAPH_URL, {
    query: `query AccountBorrows {
      trackingActiveAccount(id: "${ownerAddress}") {
        borrows
      }
    }`,
    operationName: 'AccountBorrows',
  })
  const entries = data.data?.trackingActiveAccount?.borrows || []
  const subAccounts = entries.map((e: string) => getAddress(e.substring(0, 42)))

  for (let index = 1; index <= 256; index++) {
    const hex = BigInt(address) ^ BigInt(index)
    const subAccountAddress = getAddress(pad(toHex(hex, { size: 20 }), { size: 20 }))

    const isNotInBorrows = !subAccounts.includes(subAccountAddress)
    const hasNoController = await checkGetController(subAccountAddress)

    if (isNotInBorrows && hasNoController) {
      return subAccountAddress
    }
  }

  throw new Error('Free subaccount not found')
}
