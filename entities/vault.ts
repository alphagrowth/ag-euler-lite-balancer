import { ethers } from 'ethers'
import {
  // eulerAccountLensABI,
  eulerPerspectiveABI,
  eulerUtilsLensABI,
  eulerVaultLensABI,
} from '~/entities/euler/abis'
// import type { AccountBorrowPosition } from '~/entities/account'

export interface VaultLiabilityPriceInfo {
  amountIn: bigint
  amountOutAsk: bigint
  amountOutBid: bigint
  amountOutMid: bigint
}
export interface VaultCollateralLTV {
  collateral: string
  borrowLTV: bigint
  rampDuration: bigint
  liquidationLTV: bigint
  targetTimestamp: bigint
  initialLiquidationLTV: bigint
}
export interface VaultCollateralPrice {
  amountIn: bigint
  amountOutAsk: bigint
  amountOutBid: bigint
  amountOutMid: bigint
  asset: string
  oracle: string
  queryFailure: false
  queryFailureReason: string
  timestamp: bigint
  unitOfAccount: string
}
export interface VaultAsset {
  name: string
  symbol: string
  address: string
  decimals: bigint
}
export interface VaultInterestRateInfo {
  borrowAPY: bigint
  borrowSPY: bigint
  borrows: bigint
  cash: bigint
  supplyAPY: bigint
}
export interface Vault {
  name: string
  symbol: string
  supply: bigint
  borrow: bigint
  address: string
  decimals: bigint
  maxLiquidationDiscount: bigint
  supplyCap: bigint
  borrowCap: bigint
  interestFee: bigint
  configFlags: bigint
  totalAssets: bigint
  totalCash: bigint
  asset: VaultAsset
  collateralLTVs: VaultCollateralLTV[]
  interestRateInfo: VaultInterestRateInfo
  collateralPrices: VaultCollateralPrice[]
  liabilityPriceInfo: VaultLiabilityPriceInfo
}
export interface BorrowVaultPair {
  borrow: Vault
  collateral: Vault
  borrowLTV: bigint
  liquidationLTV: bigint
  initialLiquidationLTV: bigint
}

export interface VaultIteratorResult {
  vaults: Vault[]
  isFinished: boolean
}

export interface CollateralOption {
  type: string
  amount: number
  price: number
}

export const fetchVault = async (vaultAddress: string): Promise<Vault> => {
  const { EVM_PROVIDER_URL } = useEulerConfig()
  const { eulerLensAddresses } = useEulerAddresses()
  const provider = new ethers.JsonRpcProvider(EVM_PROVIDER_URL)
  const vaultLensContract = new ethers.Contract(
    eulerLensAddresses.value?.vaultLens || '',
    eulerVaultLensABI,
    provider,
  )
  const raw = await vaultLensContract.getVaultInfoFull(vaultAddress)
  const data = raw.toObject({ deep: true })

  return {
    address: data.vault,
    name: data.vaultName,
    supply: data.totalAssets,
    borrow: data.totalBorrowed,
    symbol: data.vaultSymbol,
    decimals: data.vaultDecimals,
    supplyCap: data.supplyCap,
    borrowCap: data.borrowCap,
    totalCash: data.totalCash,
    totalAssets: data.totalAssets,
    interestFee: data.interestFee,
    configFlags: data.configFlags,
    collateralLTVs: raw.collateralLTVInfo.toArray().map((o: { toObject: () => void }) => o.toObject()),
    collateralPrices: raw.collateralPriceInfo.toArray().map((o: { toObject: () => void }) => o.toObject()),
    liabilityPriceInfo: data.liabilityPriceInfo,
    maxLiquidationDiscount: data.maxLiquidationDiscount,
    // interestRateInfo: data.irmInfo.interestRateInfo._, // might be a toObject deep conversion bug
    interestRateInfo: !raw.irmInfo?.interestRateInfo?._
      ? {
          borrowAPY: 0n,
          borrowSPY: 0n,
          borrows: 0n,
          cash: 0n,
          supplyAPY: 0n,
        }
      : data.irmInfo.interestRateInfo._,
    asset: {
      address: data.asset,
      name: data.assetName,
      symbol: data.assetSymbol,
      decimals: data.assetDecimals,
    },
  } as Vault
}
export const fetchVaults = async function* (): AsyncGenerator<VaultIteratorResult, void, unknown> {
  const { EVM_PROVIDER_URL: _EVM_PROVIDER_URL } = useEulerConfig()
  const { eulerLensAddresses, eulerPeripheryAddresses } = useEulerAddresses()
  const provider = new ethers.JsonRpcProvider('https://rpc.ankr.com/eth/349572154c1876f50af09eaa5b19b458c3f5d65e7f95d60bf9e798a495b096ae')

  const governedPerspectiveContract = new ethers.Contract(
    eulerPeripheryAddresses.value?.governedPerspective || '',
    eulerPerspectiveABI,
    provider,
  )
  console.log('eulerPeripheryAddresses', governedPerspectiveContract)
  const vaultLensContract = new ethers.Contract(
    eulerLensAddresses.value?.vaultLens || '',
    eulerVaultLensABI,
    provider,
  )
  const verifiedVaults = await governedPerspectiveContract.verifiedArray() as string[]
  const batchSize = 5

  for (let i = 0; i < verifiedVaults.length; i += batchSize) {
    const batch = verifiedVaults.slice(i, i + batchSize)
    const batchPromises = batch.map(async (vaultAddress) => {
      try {
        const raw = (await vaultLensContract.getVaultInfoFull(vaultAddress))
        const data = raw.toObject({ deep: true })

        if (!data.irmInfo?.interestRateInfo?._) {
          data.irmInfo.interestRateInfo._ = {
            borrowAPY: 0n,
            borrowSPY: 0n,
            borrows: 0n,
            cash: 0n,
            supplyAPY: 0n,
          }
        }

        return {
          address: data.vault,
          name: data.vaultName,
          supply: data.totalAssets,
          borrow: data.totalBorrowed,
          symbol: data.vaultSymbol,
          decimals: data.vaultDecimals,
          supplyCap: data.supplyCap,
          borrowCap: data.borrowCap,
          totalCash: data.totalCash,
          totalAssets: data.totalAssets,
          interestFee: data.interestFee,
          configFlags: data.configFlags,
          collateralLTVs: raw.collateralLTVInfo.toArray().map((o: { toObject: () => void }) => o.toObject()),
          collateralPrices: raw.collateralPriceInfo.toArray().map((o: { toObject: () => void }) => o.toObject()),
          liabilityPriceInfo: data.liabilityPriceInfo,
          maxLiquidationDiscount: data.maxLiquidationDiscount,
          interestRateInfo: data.irmInfo.interestRateInfo._, // might be a toObject deep conversion bug
          asset: {
            address: data.asset,
            name: data.assetName,
            symbol: data.assetSymbol,
            decimals: data.assetDecimals,
          },
        } as Vault
      }
      catch (e) {
        console.error(`Error fetching collaterals for vault ${vaultAddress}:`, e)
        return undefined
      }
    })

    const res = await Promise.all(batchPromises)
    const validVaults = res.filter(o => !!o) as Vault[]
    const isFinished = i + batchSize >= verifiedVaults.length

    yield {
      vaults: validVaults,
      isFinished,
    }
  }
}

export const getBorrowVaultsByMap = (vaultsMap: Map<string, Vault>) => {
  const arr: BorrowVaultPair[] = []
  const list = [...vaultsMap.values()]
  list.forEach((vault) => {
    vault.collateralLTVs.forEach((c) => {
      if (c.borrowLTV <= 0n) {
        return
      }
      const cVault = vaultsMap.get(c.collateral)
      arr.push({
        borrow: vault,
        collateral: cVault!,
        borrowLTV: c.borrowLTV,
        liquidationLTV: c.liquidationLTV,
        initialLiquidationLTV: c.initialLiquidationLTV,
      })
    })
  })
  return arr.filter(o => !!o && o?.collateral)
}
export const getBorrowVaultPairByMapAndAddresses = (vaultsMap: Map<string, Vault>, collateralAddress: string, borrowAddress: string): BorrowVaultPair => {
  let obj: BorrowVaultPair | undefined = undefined
  const borrowVault = vaultsMap.get(borrowAddress)
  if (!borrowVault) {
    throw '[getBorrowVaultPairByMapAndAddresses]: Borrow vault not found'
  }
  borrowVault.collateralLTVs.forEach((c) => {
    if (c.collateral !== collateralAddress) {
      return
    }
    const cVault = vaultsMap.get(c.collateral)!
    obj = {
      borrow: borrowVault,
      collateral: cVault,
      borrowLTV: c.borrowLTV,
      liquidationLTV: c.liquidationLTV,
      initialLiquidationLTV: c.initialLiquidationLTV,
    } as BorrowVaultPair
  })

  if (!obj) {
    throw '[getBorrowVaultPairByMapAndAddresses]: Vault pair not found'
  }

  return obj
}
export const getVaultPrice = (amount: number | bigint, vault: Vault) => {
  const actualAmount = typeof amount === 'bigint' ? nanoToValue(amount, vault.decimals) : amount
  return actualAmount * nanoToValue(vault.liabilityPriceInfo.amountOutMid, 18)
}
export const computeAPYs = (borrowSPY: bigint, cash: bigint, borrows: bigint, interestFee: bigint) => {
  const { EVM_PROVIDER_URL } = useEulerConfig()
  const { eulerLensAddresses } = useEulerAddresses()
  const provider = ethers.getDefaultProvider(EVM_PROVIDER_URL)
  const utilsLensContract = new ethers.Contract(eulerLensAddresses.value?.utilsLens || '', eulerUtilsLensABI, provider)
  return utilsLensContract.computeAPYs(borrowSPY, cash, borrows, interestFee)
}
export const getNetAPY = (supplyUSD: number, supplyAPY: number, borrowUSD: number, borrowAPY: number, supplyRewardAPY?: number | null, borrowRewardAPY?: number | null) => {
  const sum = (supplyUSD * (supplyAPY + (supplyRewardAPY || 0))) - (borrowUSD * (borrowAPY - (borrowRewardAPY || 0)))
  if (sum === 0) {
    return 0
  }
  return sum / (sum < 0 ? borrowUSD : supplyUSD)
}
export const convertSharesToAssets = (vaultAddress: string, sharesAmount: bigint): Promise<bigint> => {
  const { EVM_PROVIDER_URL } = useEulerConfig()
  const provider = new ethers.JsonRpcProvider(EVM_PROVIDER_URL)
  const contract = new ethers.Contract(vaultAddress, [{
    inputs: [
      {
        internalType: 'uint256',
        name: 'shares',
        type: 'uint256',
      },
    ],
    name: 'convertToAssets',
    outputs: [
      {
        internalType: 'uint256',
        name: '',
        type: 'uint256',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  }], provider)
  return contract.convertToAssets(sharesAmount).catch(_ => 0n)
}
export const convertAssetsToShares = (vaultAddress: string, assetsAmount: bigint): Promise<bigint> => {
  const { EVM_PROVIDER_URL } = useEulerConfig()
  const provider = new ethers.JsonRpcProvider(EVM_PROVIDER_URL)
  const contract = new ethers.Contract(vaultAddress, [{
    inputs: [
      {
        internalType: 'uint256',
        name: 'assets',
        type: 'uint256',
      },
    ],
    name: 'convertToShares',
    outputs: [
      {
        internalType: 'uint256',
        name: '',
        type: 'uint256',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  }], provider)
  return contract.convertToShares(assetsAmount).catch(_ => 0n)
}
export const previewWithdraw = (vaultAddress: string, assetsAmount: bigint): Promise<bigint> => {
  const { EVM_PROVIDER_URL } = useEulerConfig()
  const provider = new ethers.JsonRpcProvider(EVM_PROVIDER_URL)
  const contract = new ethers.Contract(vaultAddress, [{
    inputs: [
      {
        internalType: 'uint256',
        name: 'assets',
        type: 'uint256',
      },
    ],
    name: 'previewWithdraw',
    outputs: [
      {
        internalType: 'uint256',
        name: '',
        type: 'uint256',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  }], provider)
  return contract.previewWithdraw(assetsAmount).catch(_ => 0n)
}
export const getMaxWithdraw = (vaultAddress: string, account: string): Promise<bigint> => {
  const { EVM_PROVIDER_URL } = useEulerConfig()
  const provider = new ethers.JsonRpcProvider(EVM_PROVIDER_URL)
  const contract = new ethers.Contract(vaultAddress, [{
    inputs: [
      {
        internalType: 'address',
        name: 'owner',
        type: 'address',
      },
    ],
    name: 'maxWithdraw',
    outputs: [
      {
        internalType: 'uint256',
        name: 'maxAssets',
        type: 'uint256',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  }], provider)
  return contract.maxWithdraw(account)
}
