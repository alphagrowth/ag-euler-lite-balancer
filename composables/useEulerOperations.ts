import {
  AssetType,
  type EvmProxyMsg,
  type RawAssetBridgingData,
  SenderFactory,
} from '@tonappchain/sdk'
import { ethers } from 'ethers'
import { useTacSdk } from '~/composables/useTacSdk'
import { SaHooksBuilder } from '~/entities/saHooksSDK'
import { getNewSubAccount } from '~/entities/account'
import { previewWithdraw } from '~/entities/vault'

const FINAL_MESSAGE = 'By proceeding to engage with and use Euler, you accept and agree to abide by the Terms of Use: https://www.euler.finance/terms  hash:0x1a7aa1916b6c56272b62be027108c06d9af95eef4dac46acbc80267b3919e07e'
const FINAL_HASH = '0xb0d552b4ebe441d9582f5fc732fd6026b09bec13e7f3c1e21c0ecaa3801df595'
const { EVM_PROVIDER_URL, SIGN_CONTRACT_ADDRESS } = useConfig()

const hasSignature = async (userAddress: string) => {
  const provider = new ethers.JsonRpcProvider(EVM_PROVIDER_URL)
  const abi = [
    'function lastTermsOfUseSignatureTimestamp(address account, bytes32 termsOfUseHash) external view returns (uint256)',
  ]
  const contract = new ethers.Contract(SIGN_CONTRACT_ADDRESS, abi, provider)

  try {
    const lastSignTimestamp = await contract.lastTermsOfUseSignatureTimestamp(userAddress, FINAL_HASH)
    return lastSignTimestamp > 0
  }
  catch (e) {
    console.error('ERROR MESSAGE error', e)
  }
}

export const useEulerOperations = () => {
  const { tonConnectUI } = useTonConnect()

  const supply = async (vaultAddress: string, assetAddress: string, amount: bigint, symbol: string, subAccount?: string) => {
    const { EULER_PROXY } = useConfig()
    const { tacSdk } = useTacSdk()
    const { address: eulerAccountAddress } = useEulerAccount()
    const hooks = new SaHooksBuilder()
    const hasSign = await hasSignature(eulerAccountAddress.value)
    const isTON = symbol === 'TON'

    hooks.addContractInterface(vaultAddress, [
      'function deposit(uint256,address) external',
    ])
    hooks.addContractInterface(assetAddress, [
      'function approve(address,uint256) external',
      'function transfer(address,uint256) external',
    ])
    hooks.addContractInterface(SIGN_CONTRACT_ADDRESS, [
      'function signTermsOfUse(string,bytes32) external',
    ])

    if (!eulerAccountAddress.value) {
      throw 'Euler account address is empty. Is it loaded properly?'
    }

    hooks.addPreHookCallFromSA(assetAddress, 'approve', [vaultAddress, amount])
    hooks.addPreHookCallFromSelf(assetAddress, 'transfer', [eulerAccountAddress.value, amount])

    let callData
    if (!hasSign) {
      const batchString = 'tuple(address,address,uint256,bytes)[]'
      const dataForCall = hooks.getDataForCall(vaultAddress, 'deposit', [amount, subAccount || EULER_PROXY])
      const signData = hooks.getDataForCall(SIGN_CONTRACT_ADDRESS, 'signTermsOfUse', [FINAL_MESSAGE, FINAL_HASH])
      const batchItems = [
        [SIGN_CONTRACT_ADDRESS, eulerAccountAddress.value, 0n, signData],
        [vaultAddress, eulerAccountAddress.value, 0n, dataForCall],
      ]
      callData = new ethers.AbiCoder().encode(
        [hooks.tupleString(), hooks.bridgeString(), batchString],
        [hooks.build(), [subAccount ? [] : [vaultAddress]], batchItems],
      )
    }
    else {
      const callString = 'tuple(address,address,uint256,bytes)'
      const dataForCall = hooks.getDataForCall(vaultAddress, 'deposit', [amount, subAccount || EULER_PROXY])
      callData = new ethers.AbiCoder().encode(
        [hooks.tupleString(), hooks.bridgeString(), callString],
        [hooks.build(), [subAccount ? [] : [vaultAddress]], [vaultAddress, eulerAccountAddress.value, 0n, dataForCall]],
      )
    }

    const evmProxyMsg: EvmProxyMsg = {
      evmTargetAddress: EULER_PROXY,
      methodName: !hasSign ? 'batch(bytes,bytes)' : 'call(bytes,bytes)',
      encodedParameters: callData,
    }
    const sender = await SenderFactory.getSender({ tonConnect: tonConnectUI })
    const assets: RawAssetBridgingData[] = [{
      ...(!isTON && { address: await tacSdk.getTVMTokenAddress(assetAddress) }),
      rawAmount: amount,
      type: AssetType.FT,
    }]

    const res = await tacSdk.sendCrossChainTransaction(
      evmProxyMsg,
      sender,
      assets,
    )
    tacSdk.closeConnections()

    const tsResult = res.sendTransactionResult as {
      success: boolean
      error: Record<string, unknown>
    }
    if (!tsResult?.success) {
      throw tsResult?.error?.info || 'Unknown error'
    }

    return res
  }
  const withdraw = async (
    vaultAddress: string,
    assetAddress: string,
    assetsAmount: bigint,
    symbol: string,
    subAccount?: string,
    maxSharesAmount?: bigint,
    isMax?: boolean,
  ) => {
    const { EULER_PROXY } = useConfig()
    const { tacSdk } = useTacSdk()
    const { address: eulerAccountAddress } = useEulerAccount()
    const hooks = new SaHooksBuilder()
    const hasSign = await hasSignature(eulerAccountAddress.value)
    // const isTON = symbol === 'TON'

    hooks.addContractInterface(vaultAddress, [
      'function withdraw(uint256,address,address) external',
      'function approve(address,uint256) external',
      'function transfer(address,uint256) external',
    ])
    hooks.addContractInterface(assetAddress, [
      'function transfer(address,uint256) external',
    ])
    hooks.addContractInterface(SIGN_CONTRACT_ADDRESS, [
      'function signTermsOfUse(string,bytes32) external',
    ])

    if (!eulerAccountAddress.value) {
      throw 'Euler account address is empty. Is it loaded properly?'
    }

    let sharesAmount = isMax
      ? maxSharesAmount || 0n
      : await previewWithdraw(vaultAddress, assetsAmount)

    if (isMax === false && maxSharesAmount && (sharesAmount > maxSharesAmount)) {
      sharesAmount = maxSharesAmount
    }

    if (!subAccount) {
      hooks.addPreHookCallFromSA(vaultAddress, 'approve', [vaultAddress, sharesAmount])
      hooks.addPreHookCallFromSelf(vaultAddress, 'transfer', [eulerAccountAddress.value, sharesAmount])
    }
    else {
      hooks.addPostHookCallFromSA(assetAddress, 'transfer', [EULER_PROXY, assetsAmount])
    }

    let callData
    if (!hasSign) {
      const batchString = 'tuple(address,address,uint256,bytes)[]'
      const dataForCall = hooks.getDataForCall(vaultAddress, 'withdraw', [
        assetsAmount, subAccount ? eulerAccountAddress.value : EULER_PROXY, subAccount || eulerAccountAddress.value,
      ])
      const signData = hooks.getDataForCall(SIGN_CONTRACT_ADDRESS, 'signTermsOfUse', [FINAL_MESSAGE, FINAL_HASH])
      const batchItems = [
        [SIGN_CONTRACT_ADDRESS, eulerAccountAddress.value, 0n, signData],
        [vaultAddress, eulerAccountAddress.value, 0n, dataForCall],
      ]
      callData = new ethers.AbiCoder().encode(
        [hooks.tupleString(), hooks.bridgeString(), batchString],
        [hooks.build(), [subAccount ? [] : [vaultAddress]], batchItems],
      )
    }
    else {
      const callString = 'tuple(address,address,uint256,bytes)'
      const dataForCall = hooks.getDataForCall(vaultAddress, 'withdraw', [
        assetsAmount, subAccount ? eulerAccountAddress.value : EULER_PROXY, subAccount || eulerAccountAddress.value,
      ])
      callData = new ethers.AbiCoder().encode(
        [hooks.tupleString(), hooks.bridgeString(), callString],
        [hooks.build(),
          [[assetAddress]],
          [vaultAddress, subAccount || eulerAccountAddress.value, 0n, dataForCall],
        ],
      )
    }
    const evmProxyMsg: EvmProxyMsg = {
      evmTargetAddress: EULER_PROXY,
      methodName: !hasSign ? 'batch(bytes,bytes)' : 'call(bytes,bytes)',
      encodedParameters: callData,
    }

    const sender = await SenderFactory.getSender({ tonConnect: tonConnectUI })
    const assets: RawAssetBridgingData[] = subAccount
      ? []
      : [{
          // ...(!isTON && { address: await tacSdk.getTVMTokenAddress(vaultAddress) }),
          address: await tacSdk.getTVMTokenAddress(vaultAddress),
          rawAmount: sharesAmount,
          type: AssetType.FT,
        }]
    const res = await tacSdk.sendCrossChainTransaction(
      evmProxyMsg,
      sender,
      assets,
    )
    tacSdk.closeConnections()

    const tsResult = res.sendTransactionResult as {
      success: boolean
      error: Record<string, unknown>
    }
    if (!tsResult?.success) {
      throw tsResult?.error?.info || 'Unknown error'
    }

    return res
  }
  const redeem = async (
    vaultAddress: string,
    assetAddress: string,
    assetsAmount: bigint,
    symbol: string,
    subAccount?: string,
    maxSharesAmount?: bigint,
    isMax?: boolean,
  ) => {
    const { EULER_PROXY } = useConfig()
    const { tacSdk } = useTacSdk()
    const { address: eulerAccountAddress } = useEulerAccount()
    const hooks = new SaHooksBuilder()
    const hasSign = await hasSignature(eulerAccountAddress.value)

    hooks.addContractInterface(vaultAddress, [
      'function redeem(uint256,address,address) external',
      'function approve(address,uint256) external',
      'function transfer(address,uint256) external',
    ])
    hooks.addContractInterface(assetAddress, [
      'function transfer(address,uint256) external',
    ])
    hooks.addContractInterface(SIGN_CONTRACT_ADDRESS, [
      'function signTermsOfUse(string,bytes32) external',
    ])

    if (!eulerAccountAddress.value) {
      throw 'Euler account address is empty. Is it loaded properly?'
    }

    let sharesAmount = isMax
      ? maxSharesAmount || 0n
      : await previewWithdraw(vaultAddress, assetsAmount)

    if (isMax === false && maxSharesAmount && (sharesAmount > maxSharesAmount)) {
      sharesAmount = maxSharesAmount
    }

    if (!subAccount) {
      hooks.addPreHookCallFromSA(vaultAddress, 'approve', [vaultAddress, sharesAmount])
      hooks.addPreHookCallFromSelf(vaultAddress, 'transfer', [eulerAccountAddress.value, sharesAmount])
    }
    else {
      hooks.addPostHookCallFromSA(assetAddress, 'transfer', [EULER_PROXY, sharesAmount])
    }

    let callData
    if (!hasSign) {
      const batchString = 'tuple(address,address,uint256,bytes)[]'
      const dataForCall = hooks.getDataForCall(vaultAddress, 'redeem', [
        sharesAmount, subAccount ? eulerAccountAddress.value : EULER_PROXY, subAccount || eulerAccountAddress.value,
      ])
      const signData = hooks.getDataForCall(SIGN_CONTRACT_ADDRESS, 'signTermsOfUse', [FINAL_MESSAGE, FINAL_HASH])
      const batchItems = [
        [SIGN_CONTRACT_ADDRESS, eulerAccountAddress.value, 0n, signData],
        [vaultAddress, eulerAccountAddress.value, 0n, dataForCall],
      ]
      callData = new ethers.AbiCoder().encode(
        [hooks.tupleString(), hooks.bridgeString(), batchString],
        [hooks.build(), [subAccount ? [] : [vaultAddress]], batchItems],
      )
    }
    else {
      const callString = 'tuple(address,address,uint256,bytes)'
      const dataForCall = hooks.getDataForCall(vaultAddress, 'redeem', [
        sharesAmount, subAccount ? eulerAccountAddress.value : EULER_PROXY, subAccount || eulerAccountAddress.value,
      ])
      callData = new ethers.AbiCoder().encode(
        [hooks.tupleString(), hooks.bridgeString(), callString],
        [hooks.build(),
          [[assetAddress]],
          [vaultAddress, subAccount || eulerAccountAddress.value, 0n, dataForCall],
        ],
      )
    }
    const evmProxyMsg: EvmProxyMsg = {
      evmTargetAddress: EULER_PROXY,
      methodName: !hasSign ? 'batch(bytes,bytes)' : 'call(bytes,bytes)',
      encodedParameters: callData,
    }

    const sender = await SenderFactory.getSender({ tonConnect: tonConnectUI })
    const assets: RawAssetBridgingData[] = subAccount
      ? []
      : [{
          address: await tacSdk.getTVMTokenAddress(vaultAddress),
          rawAmount: sharesAmount,
          type: AssetType.FT,
        }]
    const res = await tacSdk.sendCrossChainTransaction(
      evmProxyMsg,
      sender,
      assets,
    )
    tacSdk.closeConnections()

    const tsResult = res.sendTransactionResult as {
      success: boolean
      error: Record<string, unknown>
    }
    if (!tsResult?.success) {
      throw tsResult?.error?.info || 'Unknown error'
    }

    return res
  }
  const borrow = async (
    vaultAddress: string,
    assetAddress: string,
    amount: bigint,
    borrowVaultAddress: string,
    borrowAssetAddress: string,
    borrowAmount: bigint,
    assetSymbol: string,
    subAcc?: string,
  ) => {
    const { EULER_PROXY, ETH_VAULT_CONNECTOR } = useConfig()
    const { tacSdk } = useTacSdk()
    const { address: eulerAccountAddress } = useEulerAccount()
    const hooks = new SaHooksBuilder()
    const hasSign = await hasSignature(eulerAccountAddress.value)
    const isTON = assetSymbol === 'TON'

    hooks.addContractInterface(vaultAddress, [
      'function transfer(address,uint256) external',
      'function deposit(uint256,address) external',
    ])
    hooks.addContractInterface(borrowAssetAddress, [
      'function transfer(address,uint256) external',
      'function deposit(uint256,address) external',
    ])
    hooks.addContractInterface(borrowVaultAddress, [
      'function borrow(uint256 amount, address receiver) external returns (uint256)',
    ])
    hooks.addContractInterface(ETH_VAULT_CONNECTOR, [
      'function enableCollateral(address account, address vault) external payable',
      'function enableController(address account, address vault) external payable',
    ])
    hooks.addContractInterface(assetAddress, [
      'function approve(address,uint256) external',
      'function transfer(address,uint256) external',
    ])
    hooks.addContractInterface(SIGN_CONTRACT_ADDRESS, [
      'function signTermsOfUse(string,bytes32) external',
    ])

    const subAccount = subAcc || await getNewSubAccount(eulerAccountAddress.value)
    const depositData = hooks.getDataForCall(vaultAddress, 'deposit', [amount, subAccount])
    const borrowData = hooks.getDataForCall(borrowVaultAddress, 'borrow', [borrowAmount, eulerAccountAddress.value])
    const controllerData = hooks.getDataForCall(ETH_VAULT_CONNECTOR, 'enableController', [subAccount, borrowVaultAddress])
    const collateralData = hooks.getDataForCall(ETH_VAULT_CONNECTOR, 'enableCollateral', [subAccount, vaultAddress])
    const signData = hooks.getDataForCall(SIGN_CONTRACT_ADDRESS, 'signTermsOfUse', [FINAL_MESSAGE, FINAL_HASH])

    const batchString = 'tuple(address,address,uint256,bytes)[]'
    const batchItems = [
      [vaultAddress, eulerAccountAddress.value, 0n, depositData],
      [ETH_VAULT_CONNECTOR, ethers.ZeroAddress, 0n, controllerData],
      [ETH_VAULT_CONNECTOR, ethers.ZeroAddress, 0n, collateralData],
      [borrowVaultAddress, subAccount, 0n, borrowData],
    ]
    if (!hasSign) {
      batchItems.unshift([SIGN_CONTRACT_ADDRESS, eulerAccountAddress.value, 0n, signData])
    }

    hooks.addPreHookCallFromSA(assetAddress, 'approve', [vaultAddress, amount])
    hooks.addPreHookCallFromSelf(assetAddress, 'transfer', [eulerAccountAddress.value, amount])
    hooks.addPostHookCallFromSA(borrowAssetAddress, 'transfer', [EULER_PROXY, borrowAmount])

    const callData = new ethers.AbiCoder().encode(
      [hooks.tupleString(), hooks.bridgeString(), batchString],
      [hooks.build(), [[borrowAssetAddress]], batchItems],
    )

    const evmProxyMsg: EvmProxyMsg = {
      evmTargetAddress: EULER_PROXY,
      methodName: 'batch(bytes,bytes)',
      encodedParameters: callData,
    }
    const sender = await SenderFactory.getSender({ tonConnect: tonConnectUI })
    const assets: RawAssetBridgingData[] = [{
      // address: await tacSdk.getTVMTokenAddress(vaultAddress), // use with collateral
      ...(!isTON && { address: await tacSdk.getTVMTokenAddress(assetAddress) }), // use with user's assets
      rawAmount: amount,
      type: AssetType.FT,
    }]

    const res = await tacSdk.sendCrossChainTransaction(
      evmProxyMsg,
      sender,
      subAcc ? undefined : assets,
    )
    tacSdk.closeConnections()

    const tsResult = res?.sendTransactionResult as {
      success: boolean
      error: Record<string, unknown>
    }
    if (!tsResult?.success) {
      throw tsResult?.error?.info || 'Unknown error'
    }

    return res
  }
  const borrowBySaving = async (
    vaultAddress: string,
    assetAddress: string,
    amount: bigint,
    borrowVaultAddress: string,
    borrowAssetAddress: string,
    borrowAmount: bigint,
    assetSymbol: string,
    subAcc?: string,
  ) => {
    const { EULER_PROXY, ETH_VAULT_CONNECTOR } = useConfig()
    const { tacSdk } = useTacSdk()
    const { address: eulerAccountAddress } = useEulerAccount()
    const hooks = new SaHooksBuilder()
    const hasSign = await hasSignature(eulerAccountAddress.value)
    const isTON = assetSymbol === 'TON'

    hooks.addContractInterface(vaultAddress, [
      'function transfer(address,uint256) external',
      'function deposit(uint256,address) external',
    ])
    hooks.addContractInterface(borrowAssetAddress, [
      'function transfer(address,uint256) external',
      'function deposit(uint256,address) external',
    ])
    hooks.addContractInterface(borrowVaultAddress, [
      'function borrow(uint256 amount, address receiver) external returns (uint256)',
    ])
    hooks.addContractInterface(ETH_VAULT_CONNECTOR, [
      'function enableCollateral(address account, address vault) external payable',
      'function enableController(address account, address vault) external payable',
    ])
    hooks.addContractInterface(assetAddress, [
      'function approve(address,uint256) external',
      'function transfer(address,uint256) external',
    ])
    hooks.addContractInterface(SIGN_CONTRACT_ADDRESS, [
      'function signTermsOfUse(string,bytes32) external',
    ])

    const subAccount = subAcc || await getNewSubAccount(eulerAccountAddress.value)
    const borrowData = hooks.getDataForCall(borrowVaultAddress, 'borrow', [borrowAmount, eulerAccountAddress.value])
    const controllerData = hooks.getDataForCall(ETH_VAULT_CONNECTOR, 'enableController', [subAccount, borrowVaultAddress])
    const collateralData = hooks.getDataForCall(ETH_VAULT_CONNECTOR, 'enableCollateral', [subAccount, vaultAddress])
    const signData = hooks.getDataForCall(SIGN_CONTRACT_ADDRESS, 'signTermsOfUse', [FINAL_MESSAGE, FINAL_HASH])

    const batchString = 'tuple(address,address,uint256,bytes)[]'
    const batchItems = [
      [ETH_VAULT_CONNECTOR, ethers.ZeroAddress, 0n, controllerData],
      [ETH_VAULT_CONNECTOR, ethers.ZeroAddress, 0n, collateralData],
      [borrowVaultAddress, subAccount, 0n, borrowData],
    ]
    if (!hasSign) {
      batchItems.unshift([SIGN_CONTRACT_ADDRESS, eulerAccountAddress.value, 0n, signData])
    }

    hooks.addPreHookCallFromSelf(vaultAddress, 'transfer', [subAccount, amount])
    hooks.addPostHookCallFromSA(borrowAssetAddress, 'transfer', [EULER_PROXY, borrowAmount])

    const callData = new ethers.AbiCoder().encode(
      [hooks.tupleString(), hooks.bridgeString(), batchString],
      [hooks.build(), [[borrowAssetAddress]], batchItems],
    )

    const evmProxyMsg: EvmProxyMsg = {
      evmTargetAddress: EULER_PROXY,
      methodName: 'batch(bytes,bytes)',
      encodedParameters: callData,
    }
    const sender = await SenderFactory.getSender({ tonConnect: tonConnectUI })
    const assets: RawAssetBridgingData[] = [{
      // address: await tacSdk.getTVMTokenAddress(vaultAddress), // use with collateral
      ...(!isTON && { address: await tacSdk.getTVMTokenAddress(vaultAddress) }), // use with user's assets
      rawAmount: amount,
      type: AssetType.FT,
    }]

    const res = await tacSdk.sendCrossChainTransaction(
      evmProxyMsg,
      sender,
      subAcc ? undefined : assets,
    )
    tacSdk.closeConnections()

    const tsResult = res?.sendTransactionResult as {
      success: boolean
      error: Record<string, unknown>
    }
    if (!tsResult?.success) {
      throw tsResult?.error?.info || 'Unknown error'
    }

    return res
  }
  const repay = async (
    subAccount: string,
    vaultAddress: string,
    assetAddress: string,
    amount: bigint,
    borrowVaultAddress: string,
    borrowAssetAddress: string,
    borrowAssetSymbol: string,
  ) => {
    const { EULER_PROXY, ETH_VAULT_CONNECTOR } = useConfig()
    const { tacSdk } = useTacSdk()
    const { address: eulerAccountAddress } = useEulerAccount()
    const hooks = new SaHooksBuilder()
    const hasSign = await hasSignature(eulerAccountAddress.value)
    const isTON = borrowAssetSymbol === 'TON'

    hooks.addContractInterface(borrowAssetAddress, [
      'function approve(address,uint256) external',
      'function transfer(address,uint256) external',
    ])
    hooks.addContractInterface(assetAddress, [
      'function transfer(address,uint256) external',
    ])
    hooks.addContractInterface(borrowVaultAddress, [
      'function repay(uint256 amount, address receiver) external returns (uint256)',
    ])
    hooks.addContractInterface(ETH_VAULT_CONNECTOR, [
      'function disableCollateral(address account, address vault) external payable',
      'function disableController(address account) external payable',
    ])
    hooks.addContractInterface(SIGN_CONTRACT_ADDRESS, [
      'function signTermsOfUse(string,bytes32) external',
    ])

    hooks.addPreHookCallFromSA(borrowAssetAddress, 'approve', [borrowVaultAddress, amount])
    hooks.addPreHookCallFromSelf(borrowAssetAddress, 'transfer', [eulerAccountAddress.value, amount])
    const repayData = hooks.getDataForCall(borrowVaultAddress, 'repay', [amount, subAccount])
    const batchString = 'tuple(address,address,uint256,bytes)'

    const batchItems = [borrowVaultAddress, eulerAccountAddress.value, 0n, repayData]
    const callData = new ethers.AbiCoder().encode([hooks.tupleString(), hooks.bridgeString(), batchString], [hooks.build(), [[]], batchItems])

    const evmProxyMsg: EvmProxyMsg = {
      evmTargetAddress: EULER_PROXY,
      methodName: 'call(bytes,bytes)',
      encodedParameters: callData,
    }
    const sender = await SenderFactory.getSender({ tonConnect: tonConnectUI })
    const assets: RawAssetBridgingData[] = [{
      ...(!isTON && { address: await tacSdk.getTVMTokenAddress(borrowAssetAddress) }),
      rawAmount: amount,
      type: AssetType.FT,
    }]
    const res = await tacSdk.sendCrossChainTransaction(
      evmProxyMsg,
      sender,
      assets,
    )
    tacSdk.closeConnections()

    const tsResult = res?.sendTransactionResult as {
      success: boolean
      error: Record<string, unknown>
    }
    if (!tsResult?.success) {
      throw tsResult?.error?.info || 'Unknown error'
    }

    return res
  }
  const fullRepay = async (
    subAccount: string,
    vaultAddress: string,
    assetAddress: string,
    amount: bigint,
    borrowVaultAddress: string,
    borrowAssetAddress: string,
    borrowAssetSymbol: string,
  ) => {
    const { EULER_PROXY, ETH_VAULT_CONNECTOR } = useConfig()
    const { tacSdk } = useTacSdk()
    const { address: eulerAccountAddress } = useEulerAccount()
    const hooks = new SaHooksBuilder()
    const isTON = borrowAssetSymbol === 'TON'

    hooks.addContractInterface(borrowAssetAddress, [
      'function approve(address,uint256) external',
      'function transfer(address,uint256) external',
    ])
    hooks.addContractInterface(assetAddress, [
      'function approve(address,uint256) external',
      'function transfer(address,uint256) external',
    ])
    hooks.addContractInterface(borrowVaultAddress, [
      'function repay(uint256 amount, address receiver) external returns (uint256)',
    ])
    hooks.addContractInterface(vaultAddress, [
      'function redeem(uint256,address,address) external',
      'function deposit(uint256,address) external',
    ])
    hooks.addContractInterface(ETH_VAULT_CONNECTOR, [
      'function disableCollateral(address account, address vault) external payable',
      'function disableController(address account) external payable',
    ])

    hooks.addPreHookCallFromSA(borrowAssetAddress, 'approve', [borrowVaultAddress, ethers.MaxUint256])
    hooks.addPreHookCallFromSA(assetAddress, 'approve', [vaultAddress, ethers.MaxUint256])
    hooks.addPreHookCallFromSelf(borrowAssetAddress, 'transfer', [eulerAccountAddress.value, amount])
    const repayData = hooks.getDataForCall(borrowVaultAddress, 'repay', [ethers.MaxUint256, subAccount])
    const controllerData = hooks.getDataForCall(ETH_VAULT_CONNECTOR, 'disableController', [subAccount])
    const collateralData = hooks.getDataForCall(ETH_VAULT_CONNECTOR, 'disableCollateral', [subAccount, vaultAddress])
    const withdrawData = hooks.getDataForCall(vaultAddress, 'redeem', [ethers.MaxUint256, eulerAccountAddress.value, subAccount])
    const depositData = hooks.getDataForCall(vaultAddress, 'deposit', [ethers.MaxUint256, EULER_PROXY])

    const batchString = 'tuple(address,address,uint256,bytes)[]'

    const batchItems = [
      [borrowVaultAddress, eulerAccountAddress.value, 0n, repayData],
      [ETH_VAULT_CONNECTOR, ethers.ZeroAddress, 0n, controllerData],
      [ETH_VAULT_CONNECTOR, ethers.ZeroAddress, 0n, collateralData],
      [vaultAddress, subAccount, 0n, withdrawData],
      [vaultAddress, eulerAccountAddress.value, 0n, depositData],
    ]

    const callData = new ethers.AbiCoder().encode([hooks.tupleString(), hooks.bridgeString(), batchString], [hooks.build(), [[vaultAddress, borrowAssetAddress]], batchItems])

    const evmProxyMsg: EvmProxyMsg = {
      evmTargetAddress: EULER_PROXY,
      methodName: 'batch(bytes,bytes)',
      encodedParameters: callData,
    }
    const sender = await SenderFactory.getSender({ tonConnect: tonConnectUI })
    const assets: RawAssetBridgingData[] = [{
      ...(!isTON && { address: await tacSdk.getTVMTokenAddress(borrowAssetAddress) }),
      rawAmount: amount,
      type: AssetType.FT,
    }]
    const res = await tacSdk.sendCrossChainTransaction(
      evmProxyMsg,
      sender,
      assets,
    )
    tacSdk.closeConnections()

    const tsResult = res?.sendTransactionResult as {
      success: boolean
      error: Record<string, unknown>
    }
    if (!tsResult?.success) {
      throw tsResult?.error?.info || 'Unknown error'
    }

    return res
  }
  const disableCollateral = async (
    subAccount: string,
    vaultAddress: string,
    assetAddress: string,
    amount: bigint,
    borrowVaultAddress: string,
    borrowAssetAddress: string,
  ) => {
    const { EULER_PROXY, ETH_VAULT_CONNECTOR } = useConfig()
    const { tacSdk } = useTacSdk()
    const { address: eulerAccountAddress } = useEulerAccount()
    const hooks = new SaHooksBuilder()

    hooks.addContractInterface(borrowAssetAddress, [
      'function approve(address,uint256) external',
      'function transfer(address,uint256) external',
    ])
    hooks.addContractInterface(assetAddress, [
      'function approve(address,uint256) external',
      'function transfer(address,uint256) external',
    ])
    hooks.addContractInterface(borrowVaultAddress, [
      'function repay(uint256 amount, address receiver) external returns (uint256)',
    ])
    hooks.addContractInterface(vaultAddress, [
      'function redeem(uint256,address,address) external',
      'function deposit(uint256,address) external',
    ])
    hooks.addContractInterface(ETH_VAULT_CONNECTOR, [
      'function disableCollateral(address account, address vault) external payable',
      'function disableController(address account) external payable',
    ])

    hooks.addPreHookCallFromSA(assetAddress, 'approve', [vaultAddress, ethers.MaxUint256])

    const controllerData = hooks.getDataForCall(ETH_VAULT_CONNECTOR, 'disableController', [subAccount])
    const collateralData = hooks.getDataForCall(ETH_VAULT_CONNECTOR, 'disableCollateral', [subAccount, vaultAddress])
    const withdrawData = hooks.getDataForCall(vaultAddress, 'redeem', [ethers.MaxUint256, eulerAccountAddress.value, subAccount])
    const depositData = hooks.getDataForCall(vaultAddress, 'deposit', [ethers.MaxUint256, EULER_PROXY])

    const batchString = 'tuple(address,address,uint256,bytes)[]'

    const batchItems = [
      [ETH_VAULT_CONNECTOR, ethers.ZeroAddress, 0n, controllerData],
      [ETH_VAULT_CONNECTOR, ethers.ZeroAddress, 0n, collateralData],
      [vaultAddress, subAccount, 0n, withdrawData],
      [vaultAddress, eulerAccountAddress.value, 0n, depositData],
    ]

    const callData = new ethers.AbiCoder().encode([hooks.tupleString(), hooks.bridgeString(), batchString], [hooks.build(), [[vaultAddress, borrowAssetAddress]], batchItems])

    const evmProxyMsg: EvmProxyMsg = {
      evmTargetAddress: EULER_PROXY,
      methodName: 'batch(bytes,bytes)',
      encodedParameters: callData,
    }
    const sender = await SenderFactory.getSender({ tonConnect: tonConnectUI })
    const res = await tacSdk.sendCrossChainTransaction(
      evmProxyMsg,
      sender,
    )
    tacSdk.closeConnections()

    const tsResult = res?.sendTransactionResult as {
      success: boolean
      error: Record<string, unknown>
    }
    if (!tsResult?.success) {
      throw tsResult?.error?.info || 'Unknown error'
    }

    return res
  }

  return {
    supply,
    withdraw,
    redeem,
    borrow,
    borrowBySaving,
    repay,
    fullRepay,
    disableCollateral
  }
}
