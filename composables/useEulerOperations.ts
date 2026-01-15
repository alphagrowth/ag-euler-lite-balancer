import { useSignTypedData, useWriteContract } from '@wagmi/vue'
import type { Address, Hash, Hex, Abi } from 'viem'
import { encodeFunctionData, maxUint256 } from 'viem'
import { ethers } from 'ethers'
import { SaHooksBuilder } from '~/entities/saHooksSDK'
import { convertSaHooksToEVCCalls, EVC_ABI, type EVCCall } from '~/utils/evc-converter'
import { getNewSubAccount } from '~/entities/account'
import { erc20ABI, swapperAbi, swapVerifierAbi } from '~/entities/euler/abis'
import type { TxPlan, TxStep } from '~/entities/txPlan'
import { buildPythUpdateCalls, sumCallValues } from '~/utils/pyth'
import { useVaults } from '~/composables/useVaults'
import { MAX_UINT48, MAX_UINT160, PERMIT2_TYPES, permit2Abi } from '~/entities/permit2'
import { type SwapApiQuote, SwapperMode, SwapVerificationType } from '~/entities/swap'

const FINAL_MESSAGE = 'By proceeding to engage with and use Euler, you accept and agree to abide by the Terms of Use: https://www.euler.finance/terms  hash:0x1a7aa1916b6c56272b62be027108c06d9af95eef4dac46acbc80267b3919e07e'
const FINAL_HASH = '0xb0d552b4ebe441d9582f5fc732fd6026b09bec13e7f3c1e21c0ecaa3801df595'

export const useEulerOperations = () => {
  const { address, chainId } = useWagmi()
  const { writeContractAsync } = useWriteContract()
  const { signTypedDataAsync } = useSignTypedData()
  const { eulerCoreAddresses, eulerPeripheryAddresses } = useEulerAddresses()
  const { EVM_PROVIDER_URL, PYTH_HERMES_URL } = useEulerConfig()
  const { map } = useVaults()

  const rpcProvider = new ethers.JsonRpcProvider(EVM_PROVIDER_URL)
  const resolvePermit2Address = (vaultAddr?: Address): Address | undefined => {
    const fallback = eulerCoreAddresses.value?.permit2 as Address | undefined
    if (!vaultAddr) {
      return fallback && fallback !== ethers.ZeroAddress ? fallback : undefined
    }

    const vault = map.value.get(ethers.getAddress(vaultAddr))
    const vaultPermit2 = vault?.permit2 as Address | undefined
    const resolved = vaultPermit2 && vaultPermit2 !== ethers.ZeroAddress ? vaultPermit2 : fallback

    return resolved && resolved !== ethers.ZeroAddress ? resolved : undefined
  }

  const checkAllowance = async (assetAddress: Address, spenderAddress: Address, userAddress: Address): Promise<bigint> => {
    const contract = new ethers.Contract(assetAddress, erc20ABI, rpcProvider)

    try {
      const allowance = await contract.allowance(userAddress, spenderAddress)
      return allowance as bigint
    }
    catch (e) {
      console.error('Error checking allowance:', e)
      return 0n
    }
  }

  const nowInSeconds = () => BigInt(Math.floor(Date.now() / 1000))
  const PERMIT2_SIG_WINDOW = 60n * 60n * 24n * 180n

  const getPermit2Allowance = async (token: Address, spender: Address, owner: Address, permit2Address?: Address) => {
    const resolvedPermit2 = permit2Address ?? resolvePermit2Address()
    if (!resolvedPermit2) {
      return { amount: 0n, expiration: 0n, nonce: 0n }
    }

    const contract = new ethers.Contract(resolvedPermit2, permit2Abi, rpcProvider)
    try {
      const result = await contract.allowance(owner, token, spender)
      const amount = (result.amount ?? result[0] ?? 0n) as bigint
      const expiration = (result.expiration ?? result[1] ?? 0n) as bigint
      const nonce = (result.nonce ?? result[2] ?? 0n) as bigint

      return { amount, expiration, nonce }
    }
    catch {
      return { amount: 0n, expiration: 0n, nonce: 0n }
    }
  }

  const ensurePermit2TokenApproval = async (token: Address, requiredAmount: bigint, owner: Address, permit2Address: Address) => {
    const allowance = await checkAllowance(token, permit2Address, owner)
    if (allowance >= requiredAmount) {
      return
    }

    const approvalHash = await writeContractAsync({
      address: token,
      abi: erc20ABI,
      functionName: 'approve',
      args: [permit2Address, maxUint256],
    })

    await rpcProvider.waitForTransaction(approvalHash)
  }

  const buildPermit2Call = async (token: Address, spender: Address, requiredAmount: bigint, owner: Address, permit2Address?: Address): Promise<EVCCall | undefined> => {
    const resolvedPermit2 = permit2Address ?? resolvePermit2Address()
    if (!chainId.value || !resolvedPermit2) {
      return undefined
    }

    const allowance = await getPermit2Allowance(token, spender, owner, resolvedPermit2)
    const currentTime = nowInSeconds()

    if (allowance.amount >= requiredAmount && allowance.expiration > currentTime) {
      return undefined
    }

    const permitSingle = {
      details: {
        token,
        amount: MAX_UINT160,
        expiration: MAX_UINT48,
        nonce: allowance.nonce,
      },
      spender,
      sigDeadline: currentTime + PERMIT2_SIG_WINDOW,
    }

    const signature = await signTypedDataAsync({
      domain: {
        name: 'Permit2',
        chainId: chainId.value,
        verifyingContract: resolvedPermit2,
      },
      types: PERMIT2_TYPES,
      primaryType: 'PermitSingle',
      message: permitSingle,
    })

    const data = encodeFunctionData({
      abi: permit2Abi,
      functionName: 'permit',
      args: [owner, permitSingle, signature],
    })

    return {
      targetContract: resolvedPermit2,
      onBehalfOfAccount: owner,
      value: 0n,
      data,
    }
  }

  const preparePythUpdates = async (vaultAddresses: string[], sender: Address) => {
    try {
      const vaults = vaultAddresses.map(addr => map.value.get(ethers.getAddress(addr)))
      return await buildPythUpdateCalls(vaults, EVM_PROVIDER_URL, PYTH_HERMES_URL, sender)
    }
    catch (err) {
      console.warn('[preparePythUpdates] failed', err)
      return { calls: [], totalFee: 0n }
    }
  }

  const hasSignature = async (userAddress: Address) => {
    if (!eulerPeripheryAddresses.value) {
      return false
    }

    const abi = [
      'function lastTermsOfUseSignatureTimestamp(address account, bytes32 termsOfUseHash) external view returns (uint256)',
    ]
    const contract = new ethers.Contract(
      eulerPeripheryAddresses.value.termsOfUseSigner,
      abi,
      rpcProvider,
    )

    try {
      const lastSignTimestamp = await contract.lastTermsOfUseSignatureTimestamp(userAddress, FINAL_HASH)
      return lastSignTimestamp > 0
    }
    catch (e) {
      console.error('Error checking ToS signature:', e)
      return false
    }
  }

  const getSwapWithdrawAmount = (quote: SwapApiQuote) => {
    const amountIn = BigInt(quote.amountIn || 0)
    const amountInMax = BigInt(quote.amountInMax || 0)
    if (amountInMax > 0n) {
      return amountIn < amountInMax ? amountIn : amountInMax
    }
    return amountIn
  }

  const buildSwapVerifierData = ({
    quote,
    swapperMode,
    isRepay,
    targetDebt = 0n,
    currentDebt = 0n,
  }: {
    quote: SwapApiQuote
    swapperMode: SwapperMode
    isRepay: boolean
    targetDebt?: bigint
    currentDebt?: bigint
  }) => {
    let functionName: 'verifyAmountMinAndSkim' | 'verifyDebtMax'
    let amount: bigint

    const adjustForInterest = (debtAmount: bigint) => (debtAmount * 10_001n) / 10_000n

    if (isRepay) {
      functionName = 'verifyDebtMax'
      if (swapperMode === SwapperMode.TARGET_DEBT) {
        amount = targetDebt
      }
      else {
        amount = currentDebt - BigInt(quote.amountOutMin || 0)
        if (amount < 0n) {
          amount = 0n
        }
        amount = adjustForInterest(amount)
      }
    }
    else {
      functionName = 'verifyAmountMinAndSkim'
      amount = BigInt(quote.amountOutMin || 0)
    }

    return encodeFunctionData({
      abi: swapVerifierAbi,
      functionName,
      args: [
        quote.verify.vault,
        quote.verify.account,
        amount,
        BigInt(quote.verify.deadline || 0),
      ],
    })
  }

  const buildSwapEvcCalls = async ({
    quote,
    swapperMode,
    isRepay,
    targetDebt = 0n,
    currentDebt = 0n,
  }: {
    quote: SwapApiQuote
    swapperMode: SwapperMode
    isRepay: boolean
    targetDebt?: bigint
    currentDebt?: bigint
  }) => {
    if (!address.value || !eulerCoreAddresses.value || !eulerPeripheryAddresses.value) {
      throw new Error('Wallet not connected or addresses not available')
    }

    const userAddr = address.value as Address
    const evcAddress = eulerCoreAddresses.value.evc as Address
    const tosSignerAddress = eulerPeripheryAddresses.value.termsOfUseSigner as Address
    const hasSigned = await hasSignature(userAddr)

    if (isRepay && quote.verify.type !== SwapVerificationType.DebtMax) {
      throw new Error('Swap verifier type mismatch')
    }
    if (!isRepay && quote.verify.type !== SwapVerificationType.SkimMin) {
      throw new Error('Swap verifier type mismatch')
    }

    const withdrawAmount = getSwapWithdrawAmount(quote)
    if (withdrawAmount <= 0n) {
      throw new Error('Swap amount is zero')
    }

    const verifierData = buildSwapVerifierData({
      quote,
      swapperMode,
      isRepay,
      targetDebt,
      currentDebt,
    })

    if (verifierData.toLowerCase() !== quote.verify.verifierData.toLowerCase()) {
      console.warn('[swap] SwapVerifier data mismatch')
      throw new Error('SwapVerifier data mismatch')
    }

    const hooks = new SaHooksBuilder()
    hooks.addContractInterface(quote.vaultIn, [
      'function withdraw(uint256,address,address) external',
    ])

    if (!hasSigned) {
      hooks.addContractInterface(tosSignerAddress, [
        'function signTermsOfUse(string,bytes32) external',
      ])
    }

    const evcCalls: EVCCall[] = []

    if (!hasSigned) {
      evcCalls.push({
        targetContract: tosSignerAddress,
        onBehalfOfAccount: userAddr,
        value: 0n,
        data: hooks.getDataForCall(tosSignerAddress, 'signTermsOfUse', [FINAL_MESSAGE, FINAL_HASH]) as Hash,
      })
    }

    evcCalls.push({
      targetContract: quote.vaultIn,
      onBehalfOfAccount: quote.accountIn,
      value: 0n,
      data: hooks.getDataForCall(
        quote.vaultIn,
        'withdraw',
        [withdrawAmount, quote.swap.swapperAddress, quote.accountIn],
      ) as Hash,
    })

    evcCalls.push({
      targetContract: quote.swap.swapperAddress,
      onBehalfOfAccount: quote.accountIn,
      value: 0n,
      data: encodeFunctionData({
        abi: swapperAbi,
        functionName: 'multicall',
        args: [quote.swap.multicallItems.map(item => item.data)],
      }),
    })

    evcCalls.push({
      targetContract: quote.verify.verifierAddress,
      onBehalfOfAccount: quote.verify.account,
      value: 0n,
      data: verifierData,
    })

    const totalValue = sumCallValues(evcCalls)

    return { evcCalls, evcAddress, totalValue }
  }

  const executeTxPlan = async (plan: TxPlan) => {
    if (!address.value) {
      throw new Error('Wallet not connected')
    }

    let lastHash: Hex | undefined

    for (const step of plan.steps) {
      const txHash = await writeContractAsync({
        address: step.to,
        abi: step.abi,
        functionName: step.functionName as any,
        args: step.args as any,
        value: step.value ?? 0n,
      })

      lastHash = txHash
      // TODO wait for transaction provider.waitForTransaction(txHash)
    }

    return lastHash
  }

  const buildSupplyPlan = async (
    vaultAddress: string,
    assetAddress: string,
    amount: bigint,
    _symbol: string,
    subAccount?: string,
    options: { includePermit2Call?: boolean } = {},
  ): Promise<TxPlan> => {
    if (!address.value || !eulerCoreAddresses.value || !eulerPeripheryAddresses.value) {
      throw new Error('Wallet not connected or addresses not available')
    }

    const vaultAddr = vaultAddress as Address
    const assetAddr = assetAddress as Address
    const userAddr = address.value as Address
    const evcAddress = eulerCoreAddresses.value.evc as Address
    const tosSignerAddress = eulerPeripheryAddresses.value.termsOfUseSigner as Address
    const depositToAddr = subAccount ? (subAccount as Address) : userAddr

    const hasSigned = await hasSignature(userAddr)
    const allowance = await checkAllowance(assetAddr, vaultAddr, userAddr)
    const permit2Address = resolvePermit2Address(vaultAddr)
    const includePermit2Call = options.includePermit2Call ?? true
    const canUsePermit2 = includePermit2Call && !!chainId.value && !!permit2Address

    const steps: TxStep[] = []

    let permitCall: EVCCall | undefined
    const usesPermit2 = canUsePermit2 && allowance < amount

    if (usesPermit2 && permit2Address) {
      const permit2Allowance = await checkAllowance(assetAddr, permit2Address, userAddr)
      const needsPermit2Approval = permit2Allowance < amount
      if (needsPermit2Approval) {
        steps.push({
          type: 'permit2-approve',
          label: 'Approve token for Permit2',
          to: assetAddr,
          abi: erc20ABI as Abi,
          functionName: 'approve',
          args: [permit2Address, maxUint256] as const,
          value: 0n,
        })
      }

      if (!needsPermit2Approval) {
        permitCall = await buildPermit2Call(assetAddr, vaultAddr, amount, userAddr, permit2Address)
      }
    }
    else if (allowance < amount) {
      steps.push({
        type: 'approve',
        label: 'Approve asset for vault',
        to: assetAddr,
        abi: erc20ABI as Abi,
        functionName: 'approve',
        args: [vaultAddr, maxUint256] as const,
        value: 0n,
      })
    }

    const hooks = new SaHooksBuilder()

    hooks.addContractInterface(assetAddr, [
      'function approve(address,uint256) external',
    ])
    hooks.addContractInterface(vaultAddr, [
      'function deposit(uint256,address) external',
    ])

    if (!hasSigned) {
      hooks.addContractInterface(tosSignerAddress, [
        'function signTermsOfUse(string,bytes32) external',
      ])
    }

    hooks.setMainCallHookCallFromSelf(vaultAddr, 'deposit', [amount, depositToAddr])

    const saHooks = hooks.build()
    const evcCalls = convertSaHooksToEVCCalls(saHooks, userAddr, depositToAddr)

    if (!hasSigned) {
      const tosCall = {
        targetContract: tosSignerAddress,
        onBehalfOfAccount: userAddr,
        value: 0n,
        data: hooks.getDataForCall(
          tosSignerAddress,
          'signTermsOfUse',
          [FINAL_MESSAGE, FINAL_HASH],
        ) as Hex,
      }
      evcCalls.unshift(tosCall)
    }

    if (permitCall) {
      evcCalls.unshift(permitCall)
    }

    steps.push({
      type: 'evc-batch',
      label: usesPermit2 ? 'Permit2 supply via EVC' : 'Supply via EVC',
      to: evcAddress,
      abi: EVC_ABI,
      functionName: 'batch',
      args: [evcCalls] as const,
      value: 0n,
    })

    return {
      kind: 'supply',
      steps,
    }
  }

  const buildWithdrawPlan = async (
    vaultAddress: string,
    assetsAmount: bigint,
    subAccount?: string,
  ): Promise<TxPlan> => {
    if (!address.value || !eulerCoreAddresses.value || !eulerPeripheryAddresses.value) {
      throw new Error('Wallet not connected or addresses not available')
    }

    const vaultAddr = vaultAddress as Address
    const userAddr = address.value as Address
    const evcAddress = eulerCoreAddresses.value.evc as Address
    const tosSignerAddress = eulerPeripheryAddresses.value.termsOfUseSigner as Address
    const withdrawFromAddr = subAccount ? (subAccount as Address) : userAddr

    const hasSigned = await hasSignature(userAddr)

    const hooks = new SaHooksBuilder()

    hooks.addContractInterface(vaultAddr, [
      'function withdraw(uint256,address,address) external',
    ])

    if (!hasSigned) {
      hooks.addContractInterface(tosSignerAddress, [
        'function signTermsOfUse(string,bytes32) external',
      ])
    }

    if (subAccount) {
      hooks.setMainCallHookCallFromSA(vaultAddr, 'withdraw', [assetsAmount, userAddr, withdrawFromAddr])
    }
    else {
      hooks.setMainCallHookCallFromSelf(vaultAddr, 'withdraw', [assetsAmount, userAddr, withdrawFromAddr])
    }

    const saHooks = hooks.build()
    const evcCalls = convertSaHooksToEVCCalls(saHooks, userAddr, withdrawFromAddr)

    if (!hasSigned) {
      const tosCall = {
        targetContract: tosSignerAddress,
        onBehalfOfAccount: userAddr,
        value: 0n,
        data: hooks.getDataForCall(tosSignerAddress, 'signTermsOfUse', [FINAL_MESSAGE, FINAL_HASH]) as Hash,
      }
      evcCalls.unshift(tosCall)
    }

    return {
      kind: 'withdraw',
      steps: [
        {
          type: 'evc-batch',
          label: 'Withdraw via EVC',
          to: evcAddress,
          abi: EVC_ABI,
          functionName: 'batch',
          args: [evcCalls] as const,
          value: 0n,
        },
      ],
    }
  }

  const buildRedeemPlan = async (
    vaultAddress: string,
    assetsAmount: bigint,
    maxSharesAmount?: bigint,
    isMax?: boolean,
  ): Promise<TxPlan> => {
    if (!address.value || !eulerCoreAddresses.value || !eulerPeripheryAddresses.value) {
      throw new Error('Wallet not connected or addresses not available')
    }

    const vaultAddr = vaultAddress as Address
    const userAddr = address.value as Address
    const evcAddress = eulerCoreAddresses.value.evc as Address
    const tosSignerAddress = eulerPeripheryAddresses.value.termsOfUseSigner as Address

    const hasSigned = await hasSignature(userAddr)

    const vaultContract = new ethers.Contract(vaultAddr, [
      'function previewWithdraw(uint256) external view returns (uint256)',
    ], rpcProvider)

    let sharesAmount = isMax
      ? maxSharesAmount || 0n
      : await vaultContract.previewWithdraw(assetsAmount).catch(() => 0n)

    if (isMax === false && maxSharesAmount && (sharesAmount > maxSharesAmount)) {
      sharesAmount = maxSharesAmount
    }

    const hooks = new SaHooksBuilder()

    hooks.addContractInterface(vaultAddr, [
      'function redeem(uint256,address,address) external',
    ])

    if (!hasSigned) {
      hooks.addContractInterface(tosSignerAddress, [
        'function signTermsOfUse(string,bytes32) external',
      ])
    }

    hooks.setMainCallHookCallFromSelf(vaultAddr, 'redeem', [sharesAmount, userAddr, userAddr])

    const saHooks = hooks.build()
    const evcCalls = convertSaHooksToEVCCalls(saHooks, userAddr, userAddr)

    if (!hasSigned) {
      const tosCall = {
        targetContract: tosSignerAddress,
        onBehalfOfAccount: userAddr,
        value: 0n,
        data: hooks.getDataForCall(tosSignerAddress, 'signTermsOfUse', [FINAL_MESSAGE, FINAL_HASH]) as Hash,
      }
      evcCalls.unshift(tosCall)
    }

    return {
      kind: 'withdraw',
      steps: [
        {
          type: 'evc-batch',
          label: 'Withdraw via EVC',
          to: evcAddress,
          abi: EVC_ABI,
          functionName: 'batch',
          args: [evcCalls] as const,
          value: 0n,
        },
      ],
    }
  }

  const buildBorrowPlan = async (
    vaultAddress: string,
    assetAddress: string,
    amount: bigint,
    borrowVaultAddress: string,
    borrowAmount: bigint,
    subAccount?: string,
    options: { includePermit2Call?: boolean } = {},
  ): Promise<TxPlan> => {
    if (!address.value || !eulerCoreAddresses.value || !eulerPeripheryAddresses.value) {
      throw new Error('Wallet not connected or addresses not available')
    }

    const vaultAddr = vaultAddress as Address
    const assetAddr = assetAddress as Address
    const borrowVaultAddr = borrowVaultAddress as Address
    const userAddr = address.value as Address
    const evcAddress = eulerCoreAddresses.value.evc as Address
    const tosSignerAddress = eulerPeripheryAddresses.value.termsOfUseSigner as Address
    const permit2Address = resolvePermit2Address(vaultAddr)

    const subAccountAddr = subAccount || await getNewSubAccount(address.value)

    const hasSigned = await hasSignature(userAddr)
    const requirePermit2 = true

    const steps: TxStep[] = []

    let permitCall: EVCCall | undefined
    let usesPermit2 = false

    if (amount > 0n) {
      const allowance = await checkAllowance(assetAddr, vaultAddr, userAddr)
      const includePermit2Call = options.includePermit2Call ?? true
      const canUsePermit2 = includePermit2Call && !!chainId.value && !!permit2Address
      usesPermit2 = canUsePermit2 && allowance < amount

      if (usesPermit2 && permit2Address) {
        const permit2Allowance = await checkAllowance(assetAddr, permit2Address, userAddr)
        const needsPermit2Approval = permit2Allowance < amount
        if (needsPermit2Approval) {
          steps.push({
            type: 'permit2-approve',
            label: 'Approve token for Permit2',
            to: assetAddr,
            abi: erc20ABI as Abi,
            functionName: 'approve',
            args: [permit2Address, maxUint256] as const,
            value: 0n,
          })
        }

        if (!needsPermit2Approval) {
          permitCall = await buildPermit2Call(assetAddr, vaultAddr, amount, userAddr, permit2Address)
        }
      }
      else if (allowance < amount) {
        if (requirePermit2) {
          throw new Error('Permit2 required for borrow')
        }
        steps.push({
          type: 'approve',
          label: 'Approve asset for vault',
          to: assetAddr,
          abi: erc20ABI as Abi,
          functionName: 'approve',
          args: [vaultAddr, maxUint256] as const,
          value: 0n,
        })
      }
    }

    const hooks = new SaHooksBuilder()

    hooks.addContractInterface(vaultAddr, [
      'function deposit(uint256,address) external',
    ])
    hooks.addContractInterface(borrowVaultAddr, [
      'function borrow(uint256,address) external',
    ])
    hooks.addContractInterface(evcAddress, [
      'function enableController(address,address) external',
      'function enableCollateral(address,address) external',
    ])

    if (!hasSigned) {
      hooks.addContractInterface(tosSignerAddress, [
        'function signTermsOfUse(string,bytes32) external',
      ])
    }

    const saHooks = hooks.build()
    const evcCalls = convertSaHooksToEVCCalls(saHooks, userAddr, userAddr)

    if (!hasSigned) {
      const tosCall = {
        targetContract: tosSignerAddress,
        onBehalfOfAccount: userAddr,
        value: 0n,
        data: hooks.getDataForCall(tosSignerAddress, 'signTermsOfUse', [FINAL_MESSAGE, FINAL_HASH]) as Hash,
      }
      evcCalls.unshift(tosCall)
    }

    if (permitCall) {
      evcCalls.unshift(permitCall)
    }

    const depositCall = {
      targetContract: vaultAddr,
      onBehalfOfAccount: userAddr,
      value: 0n,
      data: hooks.getDataForCall(vaultAddr, 'deposit', [amount, subAccountAddr]) as Hash,
    }

    const enableControllerCall = {
      targetContract: evcAddress,
      onBehalfOfAccount: '0x0000000000000000000000000000000000000000' as Address,
      value: 0n,
      data: hooks.getDataForCall(evcAddress, 'enableController', [subAccountAddr, borrowVaultAddr]) as Hash,
    }

    const enableCollateralCall = {
      targetContract: evcAddress,
      onBehalfOfAccount: '0x0000000000000000000000000000000000000000' as Address,
      value: 0n,
      data: hooks.getDataForCall(evcAddress, 'enableCollateral', [subAccountAddr, vaultAddr]) as Hash,
    }

    const borrowCall = {
      targetContract: borrowVaultAddr,
      onBehalfOfAccount: subAccountAddr,
      value: 0n,
      data: hooks.getDataForCall(borrowVaultAddr, 'borrow', [borrowAmount, userAddr]) as Hash,
    }

    evcCalls.push(depositCall as EVCCall, enableControllerCall as EVCCall, enableCollateralCall as EVCCall, borrowCall as EVCCall)

    const { calls: pythCalls } = await preparePythUpdates([vaultAddr, borrowVaultAddr], userAddr)
    if (pythCalls.length) {
      evcCalls.unshift(...pythCalls as EVCCall[])
    }

    const totalValue = sumCallValues(evcCalls)

    steps.push({
      type: 'evc-batch',
      label: usesPermit2 ? 'Permit2 borrow via EVC' : 'Borrow via EVC',
      to: evcAddress,
      abi: EVC_ABI,
      functionName: 'batch',
      args: [evcCalls as never],
      value: totalValue,
    })

    return {
      kind: 'borrow',
      steps,
    }
  }

  const buildBorrowBySavingPlan = async (
    vaultAddress: string,
    amount: bigint,
    borrowVaultAddress: string,
    borrowAmount: bigint,
    subAccount?: string,
  ): Promise<TxPlan> => {
    if (!address.value || !eulerCoreAddresses.value || !eulerPeripheryAddresses.value) {
      throw new Error('Wallet not connected or addresses not available')
    }

    const vaultAddr = vaultAddress as Address
    const borrowVaultAddr = borrowVaultAddress as Address
    const userAddr = address.value as Address
    const evcAddress = eulerCoreAddresses.value.evc as Address
    const tosSignerAddress = eulerPeripheryAddresses.value.termsOfUseSigner as Address

    const subAccountAddr = subAccount || await getNewSubAccount(address.value)

    const hasSigned = await hasSignature(userAddr)

    const hooks = new SaHooksBuilder()

    hooks.addContractInterface(vaultAddr, [
      'function transfer(address,uint256) external',
    ])
    hooks.addContractInterface(borrowVaultAddr, [
      'function borrow(uint256,address) external',
    ])
    hooks.addContractInterface(evcAddress, [
      'function enableCollateral(address,address) external',
      'function enableController(address,address) external',
    ])

    if (!hasSigned) {
      hooks.addContractInterface(tosSignerAddress, [
        'function signTermsOfUse(string,bytes32) external',
      ])
    }

    hooks.addPreHookCallFromSelf(vaultAddr, 'transfer', [subAccountAddr, amount])

    const saHooks = hooks.build()
    const evcCalls = convertSaHooksToEVCCalls(saHooks, userAddr, userAddr)

    if (!hasSigned) {
      const tosCall = {
        targetContract: tosSignerAddress,
        onBehalfOfAccount: userAddr,
        value: 0n,
        data: hooks.getDataForCall(tosSignerAddress, 'signTermsOfUse', [FINAL_MESSAGE, FINAL_HASH]) as Hash,
      }
      evcCalls.unshift(tosCall)
    }

    const enableControllerCall = {
      targetContract: evcAddress,
      onBehalfOfAccount: '0x0000000000000000000000000000000000000000' as Address,
      value: 0n,
      data: hooks.getDataForCall(evcAddress, 'enableController', [subAccountAddr, borrowVaultAddr]) as Hash,
    }

    const enableCollateralCall = {
      targetContract: evcAddress,
      onBehalfOfAccount: '0x0000000000000000000000000000000000000000' as Address,
      value: 0n,
      data: hooks.getDataForCall(evcAddress, 'enableCollateral', [subAccountAddr, vaultAddr]) as Hash,
    }

    const borrowCall = {
      targetContract: borrowVaultAddr,
      onBehalfOfAccount: subAccountAddr,
      value: 0n,
      data: hooks.getDataForCall(borrowVaultAddr, 'borrow', [borrowAmount, userAddr]) as Hash,
    }

    evcCalls.push(enableControllerCall as EVCCall, enableCollateralCall as EVCCall, borrowCall as EVCCall)

    const { calls: pythCalls } = await preparePythUpdates([vaultAddr, borrowVaultAddr], userAddr)
    if (pythCalls.length) {
      evcCalls.unshift(...pythCalls as EVCCall[])
    }

    const totalValue = sumCallValues(evcCalls)

    return {
      kind: 'borrow',
      steps: [
        {
          type: 'evc-batch',
          label: 'Borrow via EVC',
          to: evcAddress,
          abi: EVC_ABI,
          functionName: 'batch',
          args: [evcCalls as never],
          value: totalValue,
        },
      ],
    }
  }

  const buildRepayPlan = async (
    borrowVaultAddress: string,
    borrowAssetAddress: string,
    amount: bigint,
    subAccount: string,
  ): Promise<TxPlan> => {
    if (!address.value || !eulerCoreAddresses.value || !eulerPeripheryAddresses.value) {
      throw new Error('Wallet not connected or addresses not available')
    }

    const borrowVaultAddr = borrowVaultAddress as Address
    const borrowAssetAddr = borrowAssetAddress as Address
    const userAddr = address.value as Address
    const subAccountAddr = subAccount as Address
    const evcAddress = eulerCoreAddresses.value.evc as Address
    const tosSignerAddress = eulerPeripheryAddresses.value.termsOfUseSigner as Address
    const permit2Address = resolvePermit2Address(borrowVaultAddr)

    const hasSigned = await hasSignature(userAddr)

    const steps: TxStep[] = []
    const allowance = await checkAllowance(borrowAssetAddr, borrowVaultAddr, userAddr)
    const canUsePermit2 = !!chainId.value && !!permit2Address
    let permitCall: EVCCall | undefined
    const usesPermit2 = canUsePermit2 && allowance < amount

    if (usesPermit2 && permit2Address) {
      const permit2Allowance = await checkAllowance(borrowAssetAddr, permit2Address, userAddr)
      const needsPermit2Approval = permit2Allowance < amount
      if (needsPermit2Approval) {
        steps.push({
          type: 'permit2-approve',
          label: 'Approve token for Permit2',
          to: borrowAssetAddr,
          abi: erc20ABI as Abi,
          functionName: 'approve',
          args: [permit2Address, maxUint256] as const,
          value: 0n,
        })
      }

      if (!needsPermit2Approval) {
        permitCall = await buildPermit2Call(borrowAssetAddr, borrowVaultAddr, amount, userAddr, permit2Address)
      }
    }
    else if (allowance < amount) {
      steps.push({
        type: 'approve',
        label: 'Approve asset for vault',
        to: borrowAssetAddr,
        abi: erc20ABI as Abi,
        functionName: 'approve',
        args: [borrowVaultAddr, maxUint256] as const,
        value: 0n,
      })
    }

    const hooks = new SaHooksBuilder()

    hooks.addContractInterface(borrowVaultAddr, [
      'function repay(uint256,address) external',
    ])

    if (!hasSigned) {
      hooks.addContractInterface(tosSignerAddress, [
        'function signTermsOfUse(string,bytes32) external',
      ])
    }

    hooks.setMainCallHookCallFromSelf(borrowVaultAddr, 'repay', [amount, subAccountAddr])

    const saHooks = hooks.build()
    const evcCalls = convertSaHooksToEVCCalls(saHooks, userAddr, subAccountAddr)

    if (!hasSigned) {
      const tosCall = {
        targetContract: tosSignerAddress,
        onBehalfOfAccount: userAddr,
        value: 0n,
        data: hooks.getDataForCall(tosSignerAddress, 'signTermsOfUse', [FINAL_MESSAGE, FINAL_HASH]) as Hash,
      }
      evcCalls.unshift(tosCall)
    }

    if (permitCall) {
      evcCalls.unshift(permitCall)
    }

    steps.push({
      type: 'evc-batch',
      label: usesPermit2 ? 'Permit2 repay via EVC' : 'Repay via EVC',
      to: evcAddress,
      abi: EVC_ABI,
      functionName: 'batch',
      args: [evcCalls as never],
      value: 0n,
    })

    return {
      kind: 'repay',
      steps,
    }
  }

  const buildFullRepayPlan = async (
    borrowVaultAddress: string,
    borrowAssetAddress: string,
    amount: bigint,
    subAccount: string,
    vaultAddress: string,
  ): Promise<TxPlan> => {
    if (!address.value || !eulerCoreAddresses.value || !eulerPeripheryAddresses.value) {
      throw new Error('Wallet not connected or addresses not available')
    }

    const vaultAddr = vaultAddress as Address
    const borrowVaultAddr = borrowVaultAddress as Address
    const borrowAssetAddr = borrowAssetAddress as Address
    const userAddr = address.value as Address
    const subAccountAddr = subAccount as Address
    const evcAddress = eulerCoreAddresses.value.evc as Address
    const tosSignerAddress = eulerPeripheryAddresses.value.termsOfUseSigner as Address
    const permit2Address = resolvePermit2Address(borrowVaultAddr)

    const hasSigned = await hasSignature(userAddr)
    const allowance = await checkAllowance(borrowAssetAddr, borrowVaultAddr, userAddr)
    const canUsePermit2 = !!chainId.value && !!permit2Address
    let permitCall: EVCCall | undefined
    const usesPermit2 = canUsePermit2 && allowance < amount

    const steps: TxStep[] = []
    if (usesPermit2 && permit2Address) {
      const permit2Allowance = await checkAllowance(borrowAssetAddr, permit2Address, userAddr)
      const needsPermit2Approval = permit2Allowance < amount
      if (needsPermit2Approval) {
        steps.push({
          type: 'permit2-approve',
          label: 'Approve token for Permit2',
          to: borrowAssetAddr,
          abi: erc20ABI as Abi,
          functionName: 'approve',
          args: [permit2Address, maxUint256] as const,
          value: 0n,
        })
      }

      if (!needsPermit2Approval) {
        permitCall = await buildPermit2Call(borrowAssetAddr, borrowVaultAddr, amount, userAddr, permit2Address)
      }
    }
    else if (allowance < amount) {
      steps.push({
        type: 'approve',
        label: 'Approve asset for vault',
        to: borrowAssetAddr,
        abi: erc20ABI as Abi,
        functionName: 'approve',
        args: [borrowVaultAddr, maxUint256] as const,
        value: 0n,
      })
    }

    const vaultContract = new ethers.Contract(vaultAddr, [
      'function balanceOf(address) external view returns (uint256)',
      'function convertToAssets(uint256) external view returns (uint256)',
    ], rpcProvider)

    const subAccountShares = await vaultContract.balanceOf(subAccountAddr).catch(() => 0n)
    const subAccountAssets = await vaultContract.convertToAssets(subAccountShares).catch(() => 0n)

    const hooks = new SaHooksBuilder()

    hooks.addContractInterface(borrowVaultAddr, [
      'function repay(uint256,address) external',
      'function disableController() external',
    ])
    hooks.addContractInterface(vaultAddr, [
      'function redeem(uint256,address,address) external',
      'function deposit(uint256,address) external',
    ])
    hooks.addContractInterface(evcAddress, [
      'function disableCollateral(address,address) external',
    ])

    if (!hasSigned) {
      hooks.addContractInterface(tosSignerAddress, [
        'function signTermsOfUse(string,bytes32) external',
      ])
    }

    const evcCalls = []

    if (!hasSigned) {
      const tosCall = {
        targetContract: tosSignerAddress,
        onBehalfOfAccount: userAddr,
        value: 0n,
        data: hooks.getDataForCall(tosSignerAddress, 'signTermsOfUse', [FINAL_MESSAGE, FINAL_HASH]) as Hash,
      }
      evcCalls.push(tosCall)
    }

    if (permitCall) {
      evcCalls.push(permitCall)
    }

    const repayCall = {
      targetContract: borrowVaultAddr,
      onBehalfOfAccount: userAddr,
      value: 0n,
      data: hooks.getDataForCall(borrowVaultAddr, 'repay', [maxUint256, subAccountAddr]) as Hash,
    }

    const disableControllerCall = {
      targetContract: borrowVaultAddr,
      onBehalfOfAccount: subAccountAddr,
      value: 0n,
      data: hooks.getDataForCall(borrowVaultAddr, 'disableController', []) as Hash,
    }

    const disableCollateralCall = {
      targetContract: evcAddress,
      onBehalfOfAccount: '0x0000000000000000000000000000000000000000' as Address,
      value: 0n,
      data: hooks.getDataForCall(evcAddress, 'disableCollateral', [subAccountAddr, vaultAddr]) as Hash,
    }

    const redeemCall = {
      targetContract: vaultAddr,
      onBehalfOfAccount: subAccountAddr,
      value: 0n,
      data: hooks.getDataForCall(vaultAddr, 'redeem', [subAccountShares, userAddr, subAccountAddr]) as Hash,
    }

    const depositCall = {
      targetContract: vaultAddr,
      onBehalfOfAccount: userAddr,
      value: 0n,
      data: hooks.getDataForCall(vaultAddr, 'deposit', [subAccountAssets, userAddr]) as Hash,
    }

    evcCalls.push(repayCall, disableControllerCall, disableCollateralCall, redeemCall, depositCall)

    steps.push({
      type: 'evc-batch',
      label: usesPermit2 ? 'Permit2 full repay via EVC' : 'Repay via EVC',
      to: evcAddress,
      abi: EVC_ABI,
      functionName: 'batch',
      args: [evcCalls as never],
      value: 0n,
    })

    return {
      kind: 'full-repay',
      steps,
    }
  }

  const buildSwapPlan = async ({
    quote,
    swapperMode = SwapperMode.EXACT_IN,
    isRepay = false,
    targetDebt = 0n,
    currentDebt = 0n,
  }: {
    quote: SwapApiQuote
    swapperMode?: SwapperMode
    isRepay?: boolean
    targetDebt?: bigint
    currentDebt?: bigint
  }): Promise<TxPlan> => {
    const { evcCalls, evcAddress, totalValue } = await buildSwapEvcCalls({
      quote,
      swapperMode,
      isRepay,
      targetDebt,
      currentDebt,
    })

    return {
      kind: 'swap',
      steps: [
        {
          type: 'evc-batch',
          label: 'Swap via EVC',
          to: evcAddress,
          abi: EVC_ABI,
          functionName: 'batch',
          args: [evcCalls as never],
          value: totalValue,
        },
      ],
    }
  }

  const buildDisableCollateralPlan = async (
    subAccount: string,
    vaultAddress: string,
  ): Promise<TxPlan> => {
    if (!address.value || !eulerCoreAddresses.value || !eulerPeripheryAddresses.value) {
      throw new Error('Wallet not connected or addresses not available')
    }

    const vaultAddr = vaultAddress as Address
    const userAddr = address.value as Address
    const subAccountAddr = subAccount as Address
    const evcAddress = eulerCoreAddresses.value.evc as Address
    const tosSignerAddress = eulerPeripheryAddresses.value.termsOfUseSigner as Address

    const hasSigned = await hasSignature(userAddr)

    const hooks = new SaHooksBuilder()

    hooks.addContractInterface(vaultAddr, [
      'function redeem(uint256,address,address) external',
    ])

    if (!hasSigned) {
      hooks.addContractInterface(tosSignerAddress, [
        'function signTermsOfUse(string,bytes32) external',
      ])
    }

    const redeemCall = {
      targetContract: vaultAddr,
      onBehalfOfAccount: subAccountAddr,
      value: 0n,
      data: hooks.getDataForCall(vaultAddr, 'redeem', [maxUint256, userAddr, subAccountAddr]) as Hash,
    }

    const evcCalls = [redeemCall]

    if (!hasSigned) {
      const tosCall = {
        targetContract: tosSignerAddress,
        onBehalfOfAccount: userAddr,
        value: 0n,
        data: hooks.getDataForCall(tosSignerAddress, 'signTermsOfUse', [FINAL_MESSAGE, FINAL_HASH]) as Hash,
      }
      evcCalls.unshift(tosCall)
    }

    return {
      kind: 'disable-collateral',
      steps: [
        {
          type: 'evc-batch',
          label: 'Disable collateral via EVC',
          to: evcAddress,
          abi: EVC_ABI,
          functionName: 'batch',
          args: [evcCalls as never],
          value: 0n,
        },
      ],
    }
  }

  const swap = async ({
    quote,
    swapperMode = SwapperMode.EXACT_IN,
    isRepay = false,
    targetDebt = 0n,
    currentDebt = 0n,
  }: {
    quote: SwapApiQuote
    swapperMode?: SwapperMode
    isRepay?: boolean
    targetDebt?: bigint
    currentDebt?: bigint
  }) => {
    const { evcCalls, evcAddress, totalValue } = await buildSwapEvcCalls({
      quote,
      swapperMode,
      isRepay,
      targetDebt,
      currentDebt,
    })

    const swapHash = await writeContractAsync({
      address: evcAddress,
      abi: EVC_ABI,
      functionName: 'batch',
      args: [evcCalls as never],
      value: totalValue,
    })

    return swapHash
  }

  const supply = async (vaultAddress: string, assetAddress: string, amount: bigint, _symbol: string, subAccount?: string) => {
    if (!address.value || !eulerCoreAddresses.value || !eulerPeripheryAddresses.value) {
      throw new Error('Wallet not connected or addresses not available')
    }

    const vaultAddr = vaultAddress as Address
    const assetAddr = assetAddress as Address
    const userAddr = address.value as Address
    const evcAddress = eulerCoreAddresses.value.evc as Address
    const tosSignerAddress = eulerPeripheryAddresses.value.termsOfUseSigner as Address
    const permit2Address = resolvePermit2Address(vaultAddr)
    const depositToAddr = subAccount ? (subAccount as Address) : userAddr

    const hasSigned = await hasSignature(userAddr)
    const allowance = await checkAllowance(assetAddr, vaultAddr, userAddr)
    const canUsePermit2 = !!chainId.value && !!permit2Address

    let permitCall: EVCCall | undefined
    let usingPermit2 = false

    if (canUsePermit2 && allowance < amount && permit2Address) {
      try {
        await ensurePermit2TokenApproval(assetAddr, amount, userAddr, permit2Address)
        permitCall = await buildPermit2Call(assetAddr, vaultAddr, amount, userAddr, permit2Address)
        usingPermit2 = true
      }
      catch {
        usingPermit2 = false
      }
    }

    const needsApproval = !usingPermit2 && allowance < amount

    if (needsApproval) {
      const approvalHash = await writeContractAsync({
        address: assetAddr,
        abi: erc20ABI,
        functionName: 'approve',
        args: [vaultAddr, maxUint256],
      })

      await rpcProvider.waitForTransaction(approvalHash)
    }

    const hooks = new SaHooksBuilder()

    hooks.addContractInterface(assetAddr, [
      'function approve(address,uint256) external',
    ])
    hooks.addContractInterface(vaultAddr, [
      'function deposit(uint256,address) external',
    ])

    if (!hasSigned) {
      hooks.addContractInterface(tosSignerAddress, [
        'function signTermsOfUse(string,bytes32) external',
      ])
    }

    hooks.setMainCallHookCallFromSelf(vaultAddr, 'deposit', [amount, depositToAddr])

    const saHooks = hooks.build()
    const evcCalls = convertSaHooksToEVCCalls(saHooks, userAddr, depositToAddr)

    if (!hasSigned) {
      const tosCall = {
        targetContract: tosSignerAddress,
        onBehalfOfAccount: userAddr,
        value: 0n,
        data: hooks.getDataForCall(tosSignerAddress, 'signTermsOfUse', [FINAL_MESSAGE, FINAL_HASH]) as Hash,
      }
      evcCalls.unshift(tosCall)
    }

    if (permitCall) {
      evcCalls.unshift(permitCall)
    }

    if (needsApproval) {
      const approveData = hooks.getDataForCall(assetAddr, 'approve', [vaultAddr, maxUint256]) as Hash
      const approveCall: EVCCall = {
        targetContract: assetAddr,
        onBehalfOfAccount: depositToAddr,
        value: 0n,
        data: approveData,
      }
      evcCalls.unshift(approveCall)
    }

    const depositHash = await writeContractAsync({
      address: evcAddress,
      abi: EVC_ABI,
      functionName: 'batch',
      args: [evcCalls as never],
      value: 0n,
    })

    return depositHash
  }

  const withdraw = async (
    vaultAddress: string,
    _assetAddress: string,
    assetsAmount: bigint,
    _symbol: string,
    subAccount?: string,
    _maxSharesAmount?: bigint,
    _isMax?: boolean,
  ) => {
    if (!address.value || !eulerCoreAddresses.value || !eulerPeripheryAddresses.value) {
      throw new Error('Wallet not connected or addresses not available')
    }

    const vaultAddr = vaultAddress as Address
    const userAddr = address.value as Address
    const evcAddress = eulerCoreAddresses.value.evc as Address
    const tosSignerAddress = eulerPeripheryAddresses.value.termsOfUseSigner as Address
    const withdrawFromAddr = subAccount ? (subAccount as Address) : userAddr

    const hasSigned = await hasSignature(userAddr)

    const hooks = new SaHooksBuilder()

    hooks.addContractInterface(vaultAddr, [
      'function withdraw(uint256,address,address) external',
    ])

    if (!hasSigned) {
      hooks.addContractInterface(tosSignerAddress, [
        'function signTermsOfUse(string,bytes32) external',
      ])
    }

    if (subAccount) {
      hooks.setMainCallHookCallFromSA(vaultAddr, 'withdraw', [assetsAmount, userAddr, withdrawFromAddr])
    }
    else {
      hooks.setMainCallHookCallFromSelf(vaultAddr, 'withdraw', [assetsAmount, userAddr, withdrawFromAddr])
    }

    const saHooks = hooks.build()
    const evcCalls = convertSaHooksToEVCCalls(saHooks, userAddr, withdrawFromAddr)

    if (!hasSigned) {
      const tosCall = {
        targetContract: tosSignerAddress,
        onBehalfOfAccount: userAddr,
        value: 0n,
        data: hooks.getDataForCall(tosSignerAddress, 'signTermsOfUse', [FINAL_MESSAGE, FINAL_HASH]) as Hash,
      }
      evcCalls.unshift(tosCall)
    }

    const withdrawHash = await writeContractAsync({
      address: evcAddress,
      abi: EVC_ABI,
      functionName: 'batch',
      args: [evcCalls as never],
      value: 0n,
    })

    return withdrawHash
  }

  const redeem = async (
    vaultAddress: string,
    _assetAddress: string,
    assetsAmount: bigint,
    _symbol: string,
    subAccount?: string,
    maxSharesAmount?: bigint,
    isMax?: boolean,
  ) => {
    if (!address.value || !eulerCoreAddresses.value || !eulerPeripheryAddresses.value) {
      throw new Error('Wallet not connected or addresses not available')
    }

    const vaultAddr = vaultAddress as Address
    const userAddr = address.value as Address
    const evcAddress = eulerCoreAddresses.value.evc as Address
    const tosSignerAddress = eulerPeripheryAddresses.value.termsOfUseSigner as Address

    const hasSigned = await hasSignature(userAddr)

    const vaultContract = new ethers.Contract(vaultAddr, [
      'function previewWithdraw(uint256) external view returns (uint256)',
    ], rpcProvider)

    let sharesAmount = isMax
      ? maxSharesAmount || 0n
      : await vaultContract.previewWithdraw(assetsAmount).catch(() => 0n)

    if (isMax === false && maxSharesAmount && (sharesAmount > maxSharesAmount)) {
      sharesAmount = maxSharesAmount
    }

    const hooks = new SaHooksBuilder()

    hooks.addContractInterface(vaultAddr, [
      'function redeem(uint256,address,address) external',
    ])

    if (!hasSigned) {
      hooks.addContractInterface(tosSignerAddress, [
        'function signTermsOfUse(string,bytes32) external',
      ])
    }

    hooks.setMainCallHookCallFromSelf(vaultAddr, 'redeem', [sharesAmount, userAddr, userAddr])

    const saHooks = hooks.build()
    const evcCalls = convertSaHooksToEVCCalls(saHooks, userAddr, userAddr)

    if (!hasSigned) {
      const tosCall = {
        targetContract: tosSignerAddress,
        onBehalfOfAccount: userAddr,
        value: 0n,
        data: hooks.getDataForCall(tosSignerAddress, 'signTermsOfUse', [FINAL_MESSAGE, FINAL_HASH]) as Hash,
      }
      evcCalls.unshift(tosCall)
    }

    const redeemHash = await writeContractAsync({
      address: evcAddress,
      abi: EVC_ABI,
      functionName: 'batch',
      args: [evcCalls as never],
      value: 0n,
    })

    return redeemHash
  }

  const borrow = async (
    vaultAddress: string,
    assetAddress: string,
    amount: bigint,
    borrowVaultAddress: string,
    _borrowAssetAddress: string,
    borrowAmount: bigint,
    _assetSymbol: string,
    subAccount?: string,
  ) => {
    if (!address.value || !eulerCoreAddresses.value || !eulerPeripheryAddresses.value) {
      throw new Error('Wallet not connected or addresses not available')
    }

    const vaultAddr = vaultAddress as Address
    const assetAddr = assetAddress as Address
    const borrowVaultAddr = borrowVaultAddress as Address
    const userAddr = address.value as Address
    const evcAddress = eulerCoreAddresses.value.evc as Address
    const tosSignerAddress = eulerPeripheryAddresses.value.termsOfUseSigner as Address

    const subAccountAddr = subAccount || await getNewSubAccount(address.value)

    const hasSigned = await hasSignature(userAddr)
    const requirePermit2 = true
    const permit2Address = resolvePermit2Address(vaultAddr)
    const canUsePermit2 = !!chainId.value && !!permit2Address
    let permitCall: EVCCall | undefined

    if (amount > 0n) {
      const allowance = await checkAllowance(assetAddr, vaultAddr, userAddr)
      let usingPermit2 = false

      if (canUsePermit2 && allowance < amount && permit2Address) {
        try {
          await ensurePermit2TokenApproval(assetAddr, amount, userAddr, permit2Address)
          permitCall = await buildPermit2Call(assetAddr, vaultAddr, amount, userAddr, permit2Address)
          usingPermit2 = true
        }
        catch {
          usingPermit2 = false
        }
      }

      const needsApproval = !usingPermit2 && allowance < amount

      if (needsApproval) {
        if (requirePermit2) {
          throw new Error('Permit2 required for borrow')
        }
        const approvalHash = await writeContractAsync({
          address: assetAddr,
          abi: erc20ABI,
          functionName: 'approve',
          args: [vaultAddr, maxUint256],
        })

        await rpcProvider.waitForTransaction(approvalHash)
      }
    }

    const hooks = new SaHooksBuilder()

    hooks.addContractInterface(vaultAddr, [
      'function deposit(uint256,address) external',
    ])
    hooks.addContractInterface(borrowVaultAddr, [
      'function borrow(uint256,address) external',
    ])
    hooks.addContractInterface(evcAddress, [
      'function enableController(address,address) external',
      'function enableCollateral(address,address) external',
    ])

    if (!hasSigned) {
      hooks.addContractInterface(tosSignerAddress, [
        'function signTermsOfUse(string,bytes32) external',
      ])
    }

    const saHooks = hooks.build()
    const evcCalls = convertSaHooksToEVCCalls(saHooks, userAddr, userAddr)

    if (!hasSigned) {
      const tosCall = {
        targetContract: tosSignerAddress,
        onBehalfOfAccount: userAddr,
        value: 0n,
        data: hooks.getDataForCall(tosSignerAddress, 'signTermsOfUse', [FINAL_MESSAGE, FINAL_HASH]) as Hash,
      }
      evcCalls.unshift(tosCall)
    }

    if (permitCall) {
      evcCalls.unshift(permitCall)
    }

    const depositCall = {
      targetContract: vaultAddr,
      onBehalfOfAccount: userAddr,
      value: 0n,
      data: hooks.getDataForCall(vaultAddr, 'deposit', [amount, subAccountAddr]) as Hash,
    }

    const enableControllerCall = {
      targetContract: evcAddress,
      onBehalfOfAccount: '0x0000000000000000000000000000000000000000' as Address,
      value: 0n,
      data: hooks.getDataForCall(evcAddress, 'enableController', [subAccountAddr, borrowVaultAddr]) as Hash,
    }

    const enableCollateralCall = {
      targetContract: evcAddress,
      onBehalfOfAccount: '0x0000000000000000000000000000000000000000' as Address,
      value: 0n,
      data: hooks.getDataForCall(evcAddress, 'enableCollateral', [subAccountAddr, vaultAddr]) as Hash,
    }

    const borrowCall = {
      targetContract: borrowVaultAddr,
      onBehalfOfAccount: subAccountAddr,
      value: 0n,
      data: hooks.getDataForCall(borrowVaultAddr, 'borrow', [borrowAmount, userAddr]) as Hash,
    }

    evcCalls.push(depositCall as EVCCall, enableControllerCall as EVCCall, enableCollateralCall as EVCCall, borrowCall as EVCCall)

    const { calls: pythCalls } = await preparePythUpdates([vaultAddr, borrowVaultAddr], userAddr)
    if (pythCalls.length) {
      evcCalls.unshift(...pythCalls as EVCCall[])
    }

    const totalValue = sumCallValues(evcCalls)

    const borrowHash = await writeContractAsync({
      address: evcAddress,
      abi: EVC_ABI,
      functionName: 'batch',
      args: [evcCalls as never],
      value: totalValue,
    })

    return borrowHash
  }

  const borrowBySaving = async (
    vaultAddress: string,
    _assetAddress: string,
    amount: bigint,
    borrowVaultAddress: string,
    _borrowAssetAddress: string,
    borrowAmount: bigint,
    _assetSymbol: string,
    subAccount?: string,
  ) => {
    if (!address.value || !eulerCoreAddresses.value || !eulerPeripheryAddresses.value) {
      throw new Error('Wallet not connected or addresses not available')
    }

    const vaultAddr = vaultAddress as Address
    const borrowVaultAddr = borrowVaultAddress as Address
    const userAddr = address.value as Address
    const evcAddress = eulerCoreAddresses.value.evc as Address
    const tosSignerAddress = eulerPeripheryAddresses.value.termsOfUseSigner as Address

    const subAccountAddr = subAccount || await getNewSubAccount(address.value)

    const hasSigned = await hasSignature(userAddr)

    const hooks = new SaHooksBuilder()

    // Add interface for vault share transfer
    hooks.addContractInterface(vaultAddr, [
      'function transfer(address,uint256) external',
    ])
    hooks.addContractInterface(borrowVaultAddr, [
      'function borrow(uint256,address) external',
    ])
    hooks.addContractInterface(evcAddress, [
      'function enableCollateral(address,address) external',
      'function enableController(address,address) external',
    ])

    if (!hasSigned) {
      hooks.addContractInterface(tosSignerAddress, [
        'function signTermsOfUse(string,bytes32) external',
      ])
    }

    // CRITICAL: Transfer vault shares from main account to subaccount
    // This makes the shares available as collateral for the subaccount
    hooks.addPreHookCallFromSelf(vaultAddr, 'transfer', [subAccountAddr, amount])

    const saHooks = hooks.build()
    const evcCalls = convertSaHooksToEVCCalls(saHooks, userAddr, userAddr)

    if (!hasSigned) {
      const tosCall = {
        targetContract: tosSignerAddress,
        onBehalfOfAccount: userAddr,
        value: 0n,
        data: hooks.getDataForCall(tosSignerAddress, 'signTermsOfUse', [FINAL_MESSAGE, FINAL_HASH]) as Hash,
      }
      evcCalls.unshift(tosCall)
    }

    // Enable the borrow vault as controller
    const enableControllerCall = {
      targetContract: evcAddress,
      onBehalfOfAccount: '0x0000000000000000000000000000000000000000' as Address,
      value: 0n,
      data: hooks.getDataForCall(evcAddress, 'enableController', [subAccountAddr, borrowVaultAddr]) as Hash,
    }

    // Enable the savings vault as collateral
    const enableCollateralCall = {
      targetContract: evcAddress,
      onBehalfOfAccount: '0x0000000000000000000000000000000000000000' as Address,
      value: 0n,
      data: hooks.getDataForCall(evcAddress, 'enableCollateral', [subAccountAddr, vaultAddr]) as Hash,
    }

    // Borrow from the borrow vault
    const borrowCall = {
      targetContract: borrowVaultAddr,
      onBehalfOfAccount: subAccountAddr,
      value: 0n,
      data: hooks.getDataForCall(borrowVaultAddr, 'borrow', [borrowAmount, userAddr]) as Hash,
    }

    evcCalls.push(enableControllerCall as EVCCall, enableCollateralCall as EVCCall, borrowCall as EVCCall)

    const { calls: pythCalls } = await preparePythUpdates([vaultAddr, borrowVaultAddr], userAddr)
    if (pythCalls.length) {
      evcCalls.unshift(...pythCalls as EVCCall[])
    }

    const totalValue = sumCallValues(evcCalls)

    const borrowHash = await writeContractAsync({
      address: evcAddress,
      abi: EVC_ABI,
      functionName: 'batch',
      args: [evcCalls as never],
      value: totalValue,
    })

    return borrowHash
  }

  const repay = async (
    borrowVaultAddress: string,
    borrowAssetAddress: string,
    amount: bigint,
    subAccount: string,
  ) => {
    if (!address.value || !eulerCoreAddresses.value || !eulerPeripheryAddresses.value) {
      throw new Error('Wallet not connected or addresses not available')
    }

    const borrowVaultAddr = borrowVaultAddress as Address
    const borrowAssetAddr = borrowAssetAddress as Address
    const userAddr = address.value as Address
    const subAccountAddr = subAccount as Address
    const evcAddress = eulerCoreAddresses.value.evc as Address
    const tosSignerAddress = eulerPeripheryAddresses.value.termsOfUseSigner as Address
    const permit2Address = resolvePermit2Address(borrowVaultAddr)

    const hasSigned = await hasSignature(userAddr)

    const allowance = await checkAllowance(borrowAssetAddr, borrowVaultAddr, userAddr)
    const canUsePermit2 = !!chainId.value && !!permit2Address

    let permitCall: EVCCall | undefined
    let usingPermit2 = false

    if (canUsePermit2 && allowance < amount && permit2Address) {
      try {
        await ensurePermit2TokenApproval(borrowAssetAddr, amount, userAddr, permit2Address)
        permitCall = await buildPermit2Call(borrowAssetAddr, borrowVaultAddr, amount, userAddr, permit2Address)
        usingPermit2 = true
      }
      catch {
        usingPermit2 = false
      }
    }

    const needsApproval = !usingPermit2 && allowance < amount

    if (needsApproval) {
      const approvalHash = await writeContractAsync({
        address: borrowAssetAddr,
        abi: erc20ABI,
        functionName: 'approve',
        args: [borrowVaultAddr, maxUint256],
      })

      await rpcProvider.waitForTransaction(approvalHash)
    }

    const hooks = new SaHooksBuilder()

    hooks.addContractInterface(borrowVaultAddr, [
      'function repay(uint256,address) external',
    ])

    if (!hasSigned) {
      hooks.addContractInterface(tosSignerAddress, [
        'function signTermsOfUse(string,bytes32) external',
      ])
    }

    hooks.setMainCallHookCallFromSelf(borrowVaultAddr, 'repay', [amount, subAccountAddr])

    const saHooks = hooks.build()
    const evcCalls = convertSaHooksToEVCCalls(saHooks, userAddr, subAccountAddr)

    if (!hasSigned) {
      const tosCall = {
        targetContract: tosSignerAddress,
        onBehalfOfAccount: userAddr,
        value: 0n,
        data: hooks.getDataForCall(tosSignerAddress, 'signTermsOfUse', [FINAL_MESSAGE, FINAL_HASH]) as Hash,
      }
      evcCalls.unshift(tosCall)
    }

    if (permitCall) {
      evcCalls.unshift(permitCall)
    }

    const repayHash = await writeContractAsync({
      address: evcAddress,
      abi: EVC_ABI,
      functionName: 'batch',
      args: [evcCalls as never],
      value: 0n,
    })

    return repayHash
  }

  const fullRepay = async (
    borrowVaultAddress: string,
    borrowAssetAddress: string,
    amount: bigint,
    subAccount: string,
    vaultAddress: string,
  ) => {
    if (!address.value || !eulerCoreAddresses.value || !eulerPeripheryAddresses.value) {
      throw new Error('Wallet not connected or addresses not available')
    }

    const vaultAddr = vaultAddress as Address
    const borrowVaultAddr = borrowVaultAddress as Address
    const borrowAssetAddr = borrowAssetAddress as Address
    const userAddr = address.value as Address
    const subAccountAddr = subAccount as Address
    const evcAddress = eulerCoreAddresses.value.evc as Address
    const tosSignerAddress = eulerPeripheryAddresses.value.termsOfUseSigner as Address
    const permit2Address = resolvePermit2Address(borrowVaultAddr)

    const hasSigned = await hasSignature(userAddr)
    const allowance = await checkAllowance(borrowAssetAddr, borrowVaultAddr, userAddr)
    const canUsePermit2 = !!chainId.value && !!permit2Address

    let permitCall: EVCCall | undefined
    let usingPermit2 = false

    if (canUsePermit2 && allowance < amount && permit2Address) {
      try {
        await ensurePermit2TokenApproval(borrowAssetAddr, amount, userAddr, permit2Address)
        permitCall = await buildPermit2Call(borrowAssetAddr, borrowVaultAddr, amount, userAddr, permit2Address)
        usingPermit2 = true
      }
      catch {
        usingPermit2 = false
      }
    }

    const needsApproval = !usingPermit2 && allowance < amount

    if (needsApproval) {
      const approvalHash = await writeContractAsync({
        address: borrowAssetAddr,
        abi: erc20ABI,
        functionName: 'approve',
        args: [borrowVaultAddr, maxUint256],
      })

      await rpcProvider.waitForTransaction(approvalHash)
    }

    const vaultContract = new ethers.Contract(vaultAddr, [
      'function balanceOf(address) external view returns (uint256)',
      'function convertToAssets(uint256) external view returns (uint256)',
    ], rpcProvider)

    const subAccountShares = await vaultContract.balanceOf(subAccountAddr).catch(() => 0n)
    const subAccountAssets = await vaultContract.convertToAssets(subAccountShares).catch(() => 0n)

    console.log('subAccountShares', subAccountShares)
    console.log('subAccountAssets', subAccountAssets)

    const hooks = new SaHooksBuilder()

    hooks.addContractInterface(borrowVaultAddr, [
      'function repay(uint256,address) external',
      'function disableController() external',
    ])
    hooks.addContractInterface(vaultAddr, [
      'function redeem(uint256,address,address) external',
      'function deposit(uint256,address) external',
    ])
    hooks.addContractInterface(evcAddress, [
      'function disableCollateral(address,address) external',
    ])

    if (!hasSigned) {
      hooks.addContractInterface(tosSignerAddress, [
        'function signTermsOfUse(string,bytes32) external',
      ])
    }

    const evcCalls = []

    if (!hasSigned) {
      const tosCall = {
        targetContract: tosSignerAddress,
        onBehalfOfAccount: userAddr,
        value: 0n,
        data: hooks.getDataForCall(tosSignerAddress, 'signTermsOfUse', [FINAL_MESSAGE, FINAL_HASH]) as Hash,
      }
      evcCalls.push(tosCall)
    }

    if (permitCall) {
      evcCalls.push(permitCall)
    }

    const repayCall = {
      targetContract: borrowVaultAddr,
      onBehalfOfAccount: userAddr,
      value: 0n,
      data: hooks.getDataForCall(borrowVaultAddr, 'repay', [maxUint256, subAccountAddr]) as Hash,
    }

    const disableControllerCall = {
      targetContract: borrowVaultAddr,
      onBehalfOfAccount: subAccountAddr,
      value: 0n,
      data: hooks.getDataForCall(borrowVaultAddr, 'disableController', []) as Hash,
    }

    const disableCollateralCall = {
      targetContract: evcAddress,
      onBehalfOfAccount: '0x0000000000000000000000000000000000000000' as Address,
      value: 0n,
      data: hooks.getDataForCall(evcAddress, 'disableCollateral', [subAccountAddr, vaultAddr]) as Hash,
    }

    const redeemCall = {
      targetContract: vaultAddr,
      onBehalfOfAccount: subAccountAddr,
      value: 0n,
      data: hooks.getDataForCall(vaultAddr, 'redeem', [subAccountShares, userAddr, subAccountAddr]) as Hash,
    }

    const depositCall = {
      targetContract: vaultAddr,
      onBehalfOfAccount: userAddr,
      value: 0n,
      data: hooks.getDataForCall(vaultAddr, 'deposit', [subAccountAssets, userAddr]) as Hash,
    }

    evcCalls.push(repayCall, disableControllerCall, disableCollateralCall, redeemCall, depositCall)

    const fullRepayHash = await writeContractAsync({
      address: evcAddress,
      abi: EVC_ABI,
      functionName: 'batch',
      args: [evcCalls as never],
      value: 0n,
    })

    return fullRepayHash
  }

  const disableCollateral = async (
    subAccount: string,
    vaultAddress: string,
    _borrowVaultAddress: string,
  ) => {
    if (!address.value || !eulerCoreAddresses.value || !eulerPeripheryAddresses.value) {
      throw new Error('Wallet not connected or addresses not available')
    }

    const vaultAddr = vaultAddress as Address
    const userAddr = address.value as Address
    const subAccountAddr = subAccount as Address
    const evcAddress = eulerCoreAddresses.value.evc as Address
    const tosSignerAddress = eulerPeripheryAddresses.value.termsOfUseSigner as Address

    const hasSigned = await hasSignature(userAddr)

    const hooks = new SaHooksBuilder()

    hooks.addContractInterface(vaultAddr, [
      'function redeem(uint256,address,address) external',
    ])

    if (!hasSigned) {
      hooks.addContractInterface(tosSignerAddress, [
        'function signTermsOfUse(string,bytes32) external',
      ])
    }

    const redeemCall = {
      targetContract: vaultAddr,
      onBehalfOfAccount: subAccountAddr,
      value: 0n,
      data: hooks.getDataForCall(vaultAddr, 'redeem', [maxUint256, userAddr, subAccountAddr]) as Hash,
    }

    const evcCalls = [redeemCall]

    if (!hasSigned) {
      const tosCall = {
        targetContract: tosSignerAddress,
        onBehalfOfAccount: userAddr,
        value: 0n,
        data: hooks.getDataForCall(tosSignerAddress, 'signTermsOfUse', [FINAL_MESSAGE, FINAL_HASH]) as Hash,
      }
      evcCalls.unshift(tosCall)
    }

    const disableHash = await writeContractAsync({
      address: evcAddress,
      abi: EVC_ABI,
      functionName: 'batch',
      args: [evcCalls as never],
      value: 0n,
    })

    return disableHash
  }

  const disableOperator = async (
    operatorAddress: Address,
    subAccount: Address,
    uninstallPool: boolean = false,
    eulerSwapFactoryAddress?: Address,
    transferVaults?: { vault0: Address, vault1: Address },
  ) => {
    if (!address.value || !eulerCoreAddresses.value || !eulerPeripheryAddresses.value) {
      throw new Error('Wallet not connected or addresses not available')
    }

    const userAddr = address.value as Address
    const evcAddress = eulerCoreAddresses.value.evc as Address
    const tosSignerAddress = eulerPeripheryAddresses.value.termsOfUseSigner as Address

    const hasSigned = await hasSignature(userAddr)

    const hooks = new SaHooksBuilder()

    hooks.addContractInterface(evcAddress, [
      'function setAccountOperator(address,address,bool) external',
    ])

    if (uninstallPool && eulerSwapFactoryAddress) {
      hooks.addContractInterface(eulerSwapFactoryAddress, [
        'function uninstallPool() external',
      ])
    }

    if (transferVaults) {
      hooks.addContractInterface(transferVaults.vault0, [
        'function transfer(address,uint256) external',
      ])
      hooks.addContractInterface(transferVaults.vault1, [
        'function transfer(address,uint256) external',
      ])
    }

    if (!hasSigned) {
      hooks.addContractInterface(tosSignerAddress, [
        'function signTermsOfUse(string,bytes32) external',
      ])
    }

    const evcCalls = []

    if (!hasSigned) {
      const tosCall = {
        targetContract: tosSignerAddress,
        onBehalfOfAccount: userAddr,
        value: 0n,
        data: hooks.getDataForCall(tosSignerAddress, 'signTermsOfUse', [FINAL_MESSAGE, FINAL_HASH]) as Hash,
      }
      evcCalls.push(tosCall)
    }

    if (uninstallPool && eulerSwapFactoryAddress) {
      const uninstallCall = {
        targetContract: eulerSwapFactoryAddress,
        onBehalfOfAccount: subAccount,
        value: 0n,
        data: hooks.getDataForCall(eulerSwapFactoryAddress, 'uninstallPool', []) as Hash,
      }
      evcCalls.push(uninstallCall)
    }

    const disableOperatorCall = {
      targetContract: evcAddress,
      onBehalfOfAccount: '0x0000000000000000000000000000000000000000' as Address,
      value: 0n,
      data: hooks.getDataForCall(evcAddress, 'setAccountOperator', [subAccount, operatorAddress, false]) as Hash,
    }
    evcCalls.push(disableOperatorCall)

    if (transferVaults) {
      const transfer0Call = {
        targetContract: transferVaults.vault0,
        onBehalfOfAccount: subAccount,
        value: 0n,
        data: hooks.getDataForCall(transferVaults.vault0, 'transfer', [userAddr, ethers.MaxUint256]) as Hash,
      }
      evcCalls.push(transfer0Call)

      const transfer1Call = {
        targetContract: transferVaults.vault1,
        onBehalfOfAccount: subAccount,
        value: 0n,
        data: hooks.getDataForCall(transferVaults.vault1, 'transfer', [userAddr, ethers.MaxUint256]) as Hash,
      }
      evcCalls.push(transfer1Call)
    }

    const disableHash = await writeContractAsync({
      address: evcAddress,
      abi: EVC_ABI,
      functionName: 'batch',
      args: [evcCalls as never],
      value: 0n,
    })

    return disableHash
  }

  return {
    supply,
    withdraw,
    redeem,
    repay,
    borrow,
    borrowBySaving,
    fullRepay,
    disableCollateral,
    swap,
    executeTxPlan,
    buildSupplyPlan,
    buildWithdrawPlan,
    buildRedeemPlan,
    buildBorrowPlan,
    buildBorrowBySavingPlan,
    buildRepayPlan,
    buildFullRepayPlan,
    buildSwapPlan,
    buildDisableCollateralPlan,
    disableOperator,
  }
}
