import { ethers } from 'ethers'
import axios from 'axios'
import type { Vault } from '~/entities/vault'

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

const checkGetController = async (subAccount: string) => {
  const { EVM_PROVIDER_URL, ETH_VAULT_CONNECTOR } = useConfig()
  const provider = new ethers.JsonRpcProvider(EVM_PROVIDER_URL)
  const contract = new ethers.Contract(ETH_VAULT_CONNECTOR, ['function getControllers(address) external view returns(address[])'], provider)

  return (await contract.getControllers(subAccount)).length > 0 ? false : true
}

export const getNewSubAccount = async (ownerAddress: string) => {
  const { GOLDSKY_API_URL } = useConfig()
  const address = ethers.getAddress(ownerAddress)
  const { data } = await axios.post(GOLDSKY_API_URL, {
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
    if (!subAccounts.includes(subAccountAddress) && await checkGetController(subAccountAddress)) {
      console.log('[getNewSubAccount] found free subaccount: ', subAccountAddress)
      return subAccountAddress
    }
  }

  throw 'Free subaccount not found'
}
