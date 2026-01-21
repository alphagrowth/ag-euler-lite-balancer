import { ethers } from 'ethers'
import { evcGetControllersAbi } from '~/abis/evc'
import axios from 'axios'
import type { EarnVault, Vault } from '~/entities/vault'

export type AccountVaultLiquidityCollateral = {
  collateral: string
  collateralValue: bigint
}
export interface AccountVaultLiquidity {
  collateralLiquidityBorrowingInfo: AccountVaultLiquidityCollateral[]
  collateralLiquidityLiquidationInfo: AccountVaultLiquidityCollateral[]
  collateralLiquidityRawInfo: AccountVaultLiquidityCollateral[]
  collateralValueBorrowing: bigint
  collateralValueLiquidation: bigint
  collateralValueRaw: bigint
  liabilityValue: bigint
  queryFailure: false
  queryFailureReason: string
  timeToLiquidation: bigint
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
export interface Account {
  accountRewardInfo: unknown[]
  evcAccountInfo: {
    account: string
    addressPrefix: string
    evc: string
    isLockdownMode: boolean
    isPermitDisabledMode: boolean
    lastAccountStatusCheckTimestamp: bigint
    owner: string
    timestamp: bigint
  }
  vaultAccountInfo: AccountVault[]
}
export interface AccountBorrowPosition {
  borrow: Vault
  collateral: Vault
  collaterals?: string[]
  subAccount: string
  health: bigint
  userLTV: bigint
  price: bigint
  supplied: bigint
  borrowed: bigint
  borrowLTV: bigint
  liabilityLTV: bigint
  liquidationLTV: bigint
  liabilityValue: bigint
  timeToLiquidation: bigint
  collateralValueLiquidation: bigint
}
export interface AccountDepositPosition {
  vault: Vault
  shares: bigint
  assets: bigint
}
export interface AccountEarnPosition {
  vault: EarnVault
  shares: bigint
  assets: bigint
}

const checkGetController = async (subAccount: string) => {
  const { EVM_PROVIDER_URL } = useEulerConfig()
  const { eulerCoreAddresses } = useEulerAddresses()

  if (!eulerCoreAddresses.value?.evc) {
    console.warn('[checkGetController] EVC address not available')
    return true
  }

  const provider = new ethers.JsonRpcProvider(EVM_PROVIDER_URL)
  const contract = new ethers.Contract(
    eulerCoreAddresses.value.evc,
    evcGetControllersAbi,
    provider,
  )

  try {
    const controllers = await contract.getControllers(subAccount)
    console.log('[checkGetController]', subAccount, 'has controllers:', controllers)
    return controllers.length === 0 // Return true if NO controllers (account is free)
  }
  catch (e) {
    console.error('[checkGetController] Error:', e)
    return true
  }
}

export const getNewSubAccount = async (ownerAddress: string) => {
  const { SUBGRAPH_URL } = useEulerConfig()
  const { eulerCoreAddresses, loadEulerConfig } = useEulerAddresses()

  if (!eulerCoreAddresses.value) {
    await loadEulerConfig()
  }

  const address = ethers.getAddress(ownerAddress)
  const { data } = await axios.post(SUBGRAPH_URL, {
    query: `query AccountBorrows {
      trackingActiveAccount(id: "${ownerAddress}") {
        borrows
      }
    }`,
    operationName: 'AccountBorrows',
  })
  const entries = data.data?.trackingActiveAccount?.borrows || []
  const subAccounts = entries.map((e: string) => ethers.getAddress(e.substring(0, 42)))

  for (let index = 1; index <= 256; index++) {
    const hex = BigInt(address) ^ BigInt(index)
    const subAccountAddress = ethers.getAddress(ethers.zeroPadValue(ethers.toBeHex(hex, 20), 20))

    const isNotInBorrows = !subAccounts.includes(subAccountAddress)
    const hasNoController = await checkGetController(subAccountAddress)

    if (isNotInBorrows && hasNoController) {
      console.log('[getNewSubAccount] found free subaccount:', subAccountAddress)
      return subAccountAddress
    }
  }

  throw new Error('Free subaccount not found')
}
