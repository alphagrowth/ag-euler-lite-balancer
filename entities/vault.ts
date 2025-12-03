import { ethers } from 'ethers'
import type { OracleDetailedInfo } from '~/entities/oracle'
import {
  // eulerAccountLensABI,
  eulerEarnVaultLensABI,
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
  oracle: string
  totalAssets: bigint
  totalCash: bigint
  asset: VaultAsset
  collateralLTVs: VaultCollateralLTV[]
  interestRateInfo: VaultInterestRateInfo
  collateralPrices: VaultCollateralPrice[]
  liabilityPriceInfo: VaultLiabilityPriceInfo
  oracleDetailedInfo?: OracleDetailedInfo
  backupAssetOracleInfo?: OracleDetailedInfo
}
export interface BorrowVaultPair {
  borrow: Vault
  collateral: Vault
  borrowLTV: bigint
  liquidationLTV: bigint
  initialLiquidationLTV: bigint
}

export interface VaultIteratorResult<T> {
  vaults: T[]
  isFinished: boolean
}

export interface EarnVaultStrategyInfo {
  strategy: string
  allocatedAssets: bigint
  availableAssets: bigint
  currentAllocationCap: bigint
  pendingAllocationCap: bigint
  pendingAllocationCapValidAt: bigint
  removableAt: bigint
  info: {
    timestamp: bigint
    vault: string
    vaultName: string
    vaultSymbol: string
    vaultDecimals: bigint
    asset: string
    assetName: string
    assetSymbol: string
    assetDecimals: bigint
    totalShares: bigint
    totalAssets: bigint
    isEVault: boolean
  }
}

export interface EarnVault {
  address: string
  name: string
  symbol: string
  decimals: bigint
  totalShares: bigint
  totalAssets: bigint
  lostAssets: bigint
  availableAssets: bigint
  timelock: bigint
  performanceFee: bigint
  feeReceiver: string
  owner: string
  creator: string
  curator: string
  guardian: string
  evc: string
  permit2: string
  pendingTimelock: bigint
  pendingTimelockValidAt: bigint
  pendingGuardian: string
  pendingGuardianValidAt: bigint
  supplyQueue: string[]
  asset: VaultAsset
  strategies: EarnVaultStrategyInfo[]
}

export interface CollateralOption {
  type: string
  amount: number
  price: number
}

export const fetchVault = async (vaultAddress: string): Promise<Vault> => {
  const { EVM_PROVIDER_URL } = useEulerConfig()
  const { eulerLensAddresses } = useEulerAddresses()

  if (!eulerLensAddresses.value?.vaultLens) {
    throw new Error('Euler addresses not loaded yet')
  }

  const provider = new ethers.JsonRpcProvider(EVM_PROVIDER_URL)
  const vaultLensContract = new ethers.Contract(
    eulerLensAddresses.value.vaultLens,
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
    oracle: data.oracle,
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
    oracleDetailedInfo: data.oracleInfo,
    backupAssetOracleInfo: data.backupAssetOracleInfo,
  } as Vault
}
export const fetchVaults = async function* (): AsyncGenerator<VaultIteratorResult<Vault>, void, unknown> {
  const { EVM_PROVIDER_URL: _EVM_PROVIDER_URL } = useEulerConfig()
  const { eulerLensAddresses, eulerPeripheryAddresses, chainId } = useEulerAddresses()
  const startChainId = chainId.value
  await until(computed(() => eulerLensAddresses.value?.vaultLens && eulerPeripheryAddresses.value?.governedPerspective)).toBeTruthy()
  if (!eulerLensAddresses.value?.vaultLens || !eulerPeripheryAddresses.value?.governedPerspective) {
    throw new Error('Euler addresses not loaded yet')
  }

  const provider = new ethers.JsonRpcProvider(_EVM_PROVIDER_URL)
  const governedPerspectiveContract = new ethers.Contract(
    eulerPeripheryAddresses.value.governedPerspective,
    eulerPerspectiveABI,
    provider,
  )

  const vaultLensContract = new ethers.Contract(
    eulerLensAddresses.value.vaultLens,
    eulerVaultLensABI,
    provider,
  )
  const verifiedVaults = await governedPerspectiveContract.verifiedArray() as string[]
  const batchSize = 5

  for (let i = 0; i < verifiedVaults.length; i += batchSize) {
    if (chainId.value !== startChainId) {
      return
    }
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
          oracle: data.oracle,
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
          oracleDetailedInfo: data.oracleInfo,
          backupAssetOracleInfo: data.backupAssetOracleInfo,
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

export const fetchEarnVaults = async function* (): AsyncGenerator<VaultIteratorResult<EarnVault>, void, unknown> {
  const { EVM_PROVIDER_URL: _EVM_PROVIDER_URL } = useEulerConfig()
  const { eulerLensAddresses, eulerPeripheryAddresses, chainId } = useEulerAddresses()
  const startChainId = chainId.value
  await until(computed(() => eulerLensAddresses.value?.eulerEarnVaultLens && eulerPeripheryAddresses.value?.eulerEarnGovernedPerspective)).toBeTruthy()
  if (!eulerLensAddresses.value?.eulerEarnVaultLens || !eulerPeripheryAddresses.value?.eulerEarnGovernedPerspective) {
    throw new Error('Euler Earn addresses not loaded yet')
  }

  const provider = new ethers.JsonRpcProvider(_EVM_PROVIDER_URL)
  const governedPerspectiveContract = new ethers.Contract(
    eulerPeripheryAddresses.value.eulerEarnGovernedPerspective,
    eulerPerspectiveABI,
    provider,
  )

  const earnVaultLensContract = new ethers.Contract(
    eulerLensAddresses.value.eulerEarnVaultLens,
    eulerEarnVaultLensABI,
    provider,
  )
  const verifiedVaults = await governedPerspectiveContract.verifiedArray() as string[]

  const batchSize = 5

  for (let i = 0; i < verifiedVaults.length; i += batchSize) {
    if (chainId.value !== startChainId) {
      return
    }
    const batch = verifiedVaults.slice(i, i + batchSize)
    const batchPromises = batch.map(async (vaultAddress) => {
      try {
        const raw = await earnVaultLensContract.getVaultInfoFull(vaultAddress)
        const data = raw.toObject({ deep: true })

        return {
          address: data.vault,
          name: data.vaultName,
          symbol: data.vaultSymbol,
          decimals: data.vaultDecimals,
          totalShares: data.totalShares,
          totalAssets: data.totalAssets,
          lostAssets: data.lostAssets,
          availableAssets: data.availableAssets,
          timelock: data.timelock,
          performanceFee: data.performanceFee,
          feeReceiver: data.feeReceiver,
          owner: data.owner,
          creator: data.creator,
          curator: data.curator,
          guardian: data.guardian,
          evc: data.evc,
          permit2: data.permit2,
          pendingTimelock: data.pendingTimelock,
          pendingTimelockValidAt: data.pendingTimelockValidAt,
          pendingGuardian: data.pendingGuardian,
          pendingGuardianValidAt: data.pendingGuardianValidAt,
          supplyQueue: data.supplyQueue,
          asset: {
            address: data.asset,
            name: data.assetName,
            symbol: data.assetSymbol,
            decimals: data.assetDecimals,
          },
          strategies: raw.strategies.toArray().map((s: { toObject: (opts?: { deep?: boolean }) => EarnVaultStrategyInfo }) => {
            const strategy = s.toObject({ deep: true })
            return {
              strategy: strategy.strategy,
              allocatedAssets: strategy.allocatedAssets,
              availableAssets: strategy.availableAssets,
              currentAllocationCap: strategy.currentAllocationCap,
              pendingAllocationCap: strategy.pendingAllocationCap,
              pendingAllocationCapValidAt: strategy.pendingAllocationCapValidAt,
              removableAt: strategy.removableAt,
              info: strategy.info,
            }
          }),
        } as EarnVault
      }
      catch (e) {
        console.error(`Error fetching Earn vault ${vaultAddress}:`, e)
        return undefined
      }
    })

    const res = await Promise.all(batchPromises)
    const validVaults = res.filter(o => !!o) as EarnVault[]
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

  if (!eulerLensAddresses.value?.utilsLens) {
    throw new Error('Euler addresses not loaded yet')
  }

  const provider = ethers.getDefaultProvider(EVM_PROVIDER_URL)
  const utilsLensContract = new ethers.Contract(eulerLensAddresses.value.utilsLens, eulerUtilsLensABI, provider)
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
