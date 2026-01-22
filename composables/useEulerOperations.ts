import { useConfig, useSignTypedData, useWriteContract } from '@wagmi/vue'
import { readContract, simulateContract } from '@wagmi/vue/actions'
import type { Address, Hash, Hex, Abi, StateOverride } from 'viem'
import { encodeFunctionData, encodePacked, hexToBigInt, keccak256, maxUint256, toHex } from 'viem'
import { ethers } from 'ethers'
import { ALLOWANCE_SLOT_CANDIDATES, FINAL_HASH, FINAL_MESSAGE, PERMIT2_SIG_WINDOW } from '~/entities/constants'
import { SaHooksBuilder } from '~/entities/saHooksSDK'
import { erc20ApproveAbi, erc20BalanceOfAbi, erc20TransferAbi } from '~/abis/erc20'
import { EVC_ABI, evcDisableCollateralAbi, evcDisableControllerAbi, evcEnableCollateralAbi, evcEnableControllerAbi } from '~/abis/evc'
import { tosSignerReadAbi, tosSignerWriteAbi } from '~/abis/tos'
import { vaultBorrowAbi, vaultConvertToAssetsAbi, vaultDepositAbi, vaultPreviewWithdrawAbi, vaultRedeemAbi, vaultRepayAbi, vaultWithdrawAbi } from '~/abis/vault'
import { convertSaHooksToEVCCalls, type EVCCall } from '~/utils/evc-converter'
import { getNewSubAccount } from '~/entities/account'
import { erc20ABI, swapperAbi, swapVerifierAbi } from '~/entities/euler/abis'
import type { TxPlan, TxStep } from '~/entities/txPlan'
import { buildPythUpdateCalls, sumCallValues } from '~/utils/pyth'
import { useVaults } from '~/composables/useVaults'
import { MAX_UINT48, MAX_UINT160, PERMIT2_TYPES, permit2Abi } from '~/entities/permit2'
import { type SwapApiQuote, SwapperMode, SwapVerificationType } from '~/entities/swap'
import { isNonBlockingSimulationError } from '~/utils/tx-errors'

const allowanceSlotIndexCache = new Map<string, bigint>()

export const useEulerOperations = () => {
  const { address, chainId } = useWagmi()
  const { writeContractAsync } = useWriteContract()
  const { signTypedDataAsync } = useSignTypedData()
  const config = useConfig()
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

  const waitForTxReceipt = async (txHash?: Hash) => {
    if (!txHash) {
      return
    }

    const receipt = await rpcProvider.waitForTransaction(txHash)
    if (!receipt) {
      throw new Error('Transaction not found')
    }
    if (receipt.status === 0) {
      throw new Error('Transaction reverted')
    }
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

  const maxUint256Hex = toHex(maxUint256, { size: 32 })
  const normalizeAddress = (address: Address | string) => {
    try {
      return ethers.getAddress(address)
    }
    catch {
      return address.toLowerCase()
    }
  }
  const computeErc20AllowanceSlot = (owner: Address, spender: Address, slotIndex: bigint): Hex => {
    const baseSlot = keccak256(encodePacked(['uint256', 'uint256'], [hexToBigInt(owner), slotIndex]))
    return keccak256(encodePacked(['uint256', 'uint256'], [hexToBigInt(spender), hexToBigInt(baseSlot)]))
  }
  const resolveAllowanceSlotIndex = async (token: Address, owner: Address, spender: Address): Promise<bigint | undefined> => {
    const tokenKey = normalizeAddress(token)
    const cached = allowanceSlotIndexCache.get(tokenKey)
    if (cached !== undefined) {
      return cached
    }

    for (const slotIndex of ALLOWANCE_SLOT_CANDIDATES) {
      const slot = computeErc20AllowanceSlot(owner, spender, slotIndex)
      try {
        const value = await readContract(config, {
          address: token,
          abi: erc20ABI,
          functionName: 'allowance',
          args: [owner, spender],
          stateOverride: [
            {
              address: token,
              stateDiff: [{ slot, value: maxUint256Hex }],
            },
          ],
        })
        if (value === maxUint256) {
          allowanceSlotIndexCache.set(tokenKey, slotIndex)
          return slotIndex
        }
      }
      catch {
        continue
      }
    }
    return undefined
  }
  const buildErc20AllowanceOverrides = async (
    pairs: { token: Address; spender: Address }[],
    owner: Address,
  ): Promise<StateOverride> => {
    const overridesByToken = new Map<string, { address: Address; stateDiff: { slot: Hex; value: Hex }[] }>()
    for (const pair of pairs) {
      let slotIndex: bigint | undefined
      try {
        slotIndex = await resolveAllowanceSlotIndex(pair.token, owner, pair.spender)
      }
      catch {
        slotIndex = undefined
      }
      if (slotIndex === undefined) {
        continue
      }
      const slot = computeErc20AllowanceSlot(owner, pair.spender, slotIndex)
      const tokenKey = normalizeAddress(pair.token)
      const entry = overridesByToken.get(tokenKey) || { address: pair.token, stateDiff: [] }
      if (!entry.stateDiff.some(diff => diff.slot === slot)) {
        entry.stateDiff.push({ slot, value: maxUint256Hex })
      }
      overridesByToken.set(tokenKey, entry)
    }
    return Array.from(overridesByToken.values())
  }
  const computePermit2AllowanceSlot = (owner: Address, token: Address, spender: Address): Hex => {
    const baseSlot = keccak256(encodePacked(['uint256', 'uint256'], [hexToBigInt(owner), 1n]))
    const assetSlot = keccak256(encodePacked(['uint256', 'uint256'], [hexToBigInt(token), hexToBigInt(baseSlot)]))
    return keccak256(encodePacked(['uint256', 'uint256'], [hexToBigInt(spender), hexToBigInt(assetSlot)]))
  }
  const buildPermit2Overrides = (
    pairsByPermit2: Map<string, { address: Address; pairs: { token: Address; spender: Address }[] }>,
    owner: Address,
  ): StateOverride => {
    const overrides: StateOverride = []
    for (const entry of pairsByPermit2.values()) {
      const stateDiff = entry.pairs.map(pair => ({
        slot: computePermit2AllowanceSlot(owner, pair.token, pair.spender),
        value: maxUint256Hex,
      }))
      if (stateDiff.length) {
        overrides.push({
          address: entry.address,
          stateDiff,
        })
      }
    }
    return overrides
  }
  const buildSimulationStateOverride = async (plan: TxPlan, owner: Address): Promise<StateOverride> => {
    const approvalPairs: { token: Address; spender: Address }[] = []
    const approvalSeen = new Set<string>()
    let usesPermit2 = false

    for (const step of plan.steps) {
      if (step.type === 'permit2-approve' || (step.label && step.label.includes('Permit2'))) {
        usesPermit2 = true
      }
      if (step.type !== 'approve' && step.type !== 'permit2-approve') {
        continue
      }
      const spender = step.args?.[0]
      if (typeof spender !== 'string') {
        continue
      }
      const token = step.to as Address
      const key = `${normalizeAddress(token)}:${normalizeAddress(spender as Address)}`
      if (!approvalSeen.has(key)) {
        approvalSeen.add(key)
        approvalPairs.push({ token, spender: spender as Address })
      }
    }

    const permit2Pairs = new Map<string, { address: Address; pairs: { token: Address; spender: Address }[] }>()
    if (usesPermit2) {
      for (const step of plan.steps) {
        if (step.type !== 'evc-batch') {
          continue
        }
        const calls = step.args?.[0] as EVCCall[] | undefined
        if (!Array.isArray(calls)) {
          continue
        }
        for (const call of calls) {
          const target = call?.targetContract
          if (!target) {
            continue
          }
          const vault = map.value.get(normalizeAddress(target))
          if (!vault?.asset?.address) {
            continue
          }
          const permit2Address = resolvePermit2Address(vault.address as Address)
          if (!permit2Address) {
            continue
          }
          const permit2Key = normalizeAddress(permit2Address)
          const pairKey = `${normalizeAddress(vault.asset.address as Address)}:${normalizeAddress(vault.address as Address)}`
          const entry = permit2Pairs.get(permit2Key) || { address: permit2Address, pairs: [] }
          if (!entry.pairs.some(pair => `${normalizeAddress(pair.token)}:${normalizeAddress(pair.spender)}` === pairKey)) {
            entry.pairs.push({ token: vault.asset.address as Address, spender: vault.address as Address })
          }
          permit2Pairs.set(permit2Key, entry)
        }
      }
    }

    const erc20Overrides = await buildErc20AllowanceOverrides(approvalPairs, owner)
    const permit2Overrides = buildPermit2Overrides(permit2Pairs, owner)
    return [...permit2Overrides, ...erc20Overrides]
  }

  const nowInSeconds = () => BigInt(Math.floor(Date.now() / 1000))

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

    await waitForTxReceipt(approvalHash)
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

    const abi = tosSignerReadAbi
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

  const getSwapInputAmount = (quote: SwapApiQuote, swapperMode: SwapperMode) => {
    const amountIn = BigInt(quote.amountIn || 0)
    const amountInMax = BigInt(quote.amountInMax || 0)
    if (swapperMode === SwapperMode.EXACT_IN) {
      return amountIn
    }
    if (amountInMax > 0n) {
      return amountInMax
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
    enableCollateral = false,
  }: {
    quote: SwapApiQuote
    swapperMode: SwapperMode
    isRepay: boolean
    targetDebt?: bigint
    currentDebt?: bigint
    enableCollateral?: boolean
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

    const inputAmount = getSwapInputAmount(quote, swapperMode)
    if (inputAmount <= 0n) {
      throw new Error('Swap amount is zero')
    }

    const isDebtSwap = isRepay && quote.accountIn.toLowerCase() !== quote.accountOut.toLowerCase()
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
    if (isDebtSwap) {
      hooks.addContractInterface(quote.vaultIn, vaultBorrowAbi)
      hooks.addContractInterface(evcAddress, evcEnableControllerAbi)
      hooks.addContractInterface(quote.receiver, evcDisableControllerAbi)
    }
    else {
      hooks.addContractInterface(quote.vaultIn, vaultWithdrawAbi)
    }

    if (enableCollateral) {
      hooks.addContractInterface(evcAddress, evcEnableCollateralAbi)
    }

    if (!hasSigned) {
      hooks.addContractInterface(tosSignerAddress, tosSignerWriteAbi)
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

    if (isDebtSwap) {
      evcCalls.push({
        targetContract: evcAddress,
        onBehalfOfAccount: '0x0000000000000000000000000000000000000000' as Address,
        value: 0n,
        data: hooks.getDataForCall(evcAddress, 'enableController', [quote.accountOut, quote.vaultIn]) as Hash,
      })
      evcCalls.push({
        targetContract: quote.vaultIn,
        onBehalfOfAccount: quote.accountOut,
        value: 0n,
        data: hooks.getDataForCall(
          quote.vaultIn,
          'borrow',
          [inputAmount, quote.swap.swapperAddress],
        ) as Hash,
      })
    }
    else {
      evcCalls.push({
        targetContract: quote.vaultIn,
        onBehalfOfAccount: quote.accountIn,
        value: 0n,
        data: hooks.getDataForCall(
          quote.vaultIn,
          'withdraw',
          [inputAmount, quote.swap.swapperAddress, quote.accountIn],
        ) as Hash,
      })
    }

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

    if (enableCollateral) {
      evcCalls.push({
        targetContract: evcAddress,
        onBehalfOfAccount: '0x0000000000000000000000000000000000000000' as Address,
        value: 0n,
        data: hooks.getDataForCall(evcAddress, 'enableCollateral', [quote.accountOut, quote.receiver]) as Hash,
      })
    }

    if (isDebtSwap && quote.receiver.toLowerCase() !== quote.vaultIn.toLowerCase()) {
      evcCalls.push({
        targetContract: quote.receiver,
        onBehalfOfAccount: quote.accountOut,
        value: 0n,
        data: hooks.getDataForCall(quote.receiver, 'disableController', []) as Hash,
      })
    }

    const { calls: pythCalls } = await preparePythUpdates([quote.vaultIn, quote.receiver], userAddr)
    if (pythCalls.length) {
      evcCalls.unshift(...pythCalls as EVCCall[])
    }

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
      await waitForTxReceipt(txHash)
    }

    return lastHash
  }

  const simulateTxPlan = async (plan: TxPlan) => {
    if (!address.value) {
      throw new Error('Wallet not connected')
    }

    const hasApprovalSteps = plan.steps.some(step => step.type === 'approve' || step.type === 'permit2-approve')
    const stepsToSimulate = plan.steps.filter(step => step.type !== 'approve' && step.type !== 'permit2-approve')
    let stateOverride: StateOverride | undefined
    try {
      const overrides = await buildSimulationStateOverride(plan, address.value as Address)
      if (overrides.length) {
        stateOverride = overrides
      }
    }
    catch (err) {
      console.warn('[simulateTxPlan] failed to build state overrides', err)
    }

    for (const step of stepsToSimulate) {
      try {
        await simulateContract(config, {
          account: address.value as Address,
          address: step.to,
          abi: step.abi,
          functionName: step.functionName as any,
          args: step.args as any,
          value: step.value ?? 0n,
          stateOverride,
        })
      }
      catch (err) {
        if (hasApprovalSteps && isNonBlockingSimulationError(err)) {
          continue
        }
        throw err
      }
    }
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
    const canUsePermit2 = !!chainId.value && !!permit2Address

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

      if (!needsPermit2Approval && includePermit2Call) {
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

    hooks.addContractInterface(assetAddr, erc20ApproveAbi)
    hooks.addContractInterface(vaultAddr, vaultDepositAbi)

    if (!hasSigned) {
      hooks.addContractInterface(tosSignerAddress, tosSignerWriteAbi)
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

    const { calls: pythCalls } = await preparePythUpdates([vaultAddr], userAddr)
    if (pythCalls.length) {
      evcCalls.unshift(...pythCalls as EVCCall[])
    }

    const totalValue = sumCallValues(evcCalls)

    steps.push({
      type: 'evc-batch',
      label: usesPermit2 ? 'Permit2 supply via EVC' : 'Supply via EVC',
      to: evcAddress,
      abi: EVC_ABI,
      functionName: 'batch',
      args: [evcCalls] as const,
      value: totalValue,
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

    hooks.addContractInterface(vaultAddr, vaultWithdrawAbi)

    if (!hasSigned) {
      hooks.addContractInterface(tosSignerAddress, tosSignerWriteAbi)
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

    const { calls: pythCalls } = await preparePythUpdates([vaultAddr], userAddr)
    if (pythCalls.length) {
      evcCalls.unshift(...pythCalls as EVCCall[])
    }

    const totalValue = sumCallValues(evcCalls)

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
          value: totalValue,
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

    const vaultContract = new ethers.Contract(vaultAddr, vaultPreviewWithdrawAbi, rpcProvider)

    let sharesAmount = isMax
      ? maxSharesAmount || 0n
      : await vaultContract.previewWithdraw(assetsAmount).catch(() => 0n)

    if (isMax === false && maxSharesAmount && (sharesAmount > maxSharesAmount)) {
      sharesAmount = maxSharesAmount
    }

    const hooks = new SaHooksBuilder()

    hooks.addContractInterface(vaultAddr, vaultRedeemAbi)

    if (!hasSigned) {
      hooks.addContractInterface(tosSignerAddress, tosSignerWriteAbi)
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

    const { calls: pythCalls } = await preparePythUpdates([vaultAddr], userAddr)
    if (pythCalls.length) {
      evcCalls.unshift(...pythCalls as EVCCall[])
    }

    const totalValue = sumCallValues(evcCalls)

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
          value: totalValue,
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
      const canUsePermit2 = !!chainId.value && !!permit2Address
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

        if (!needsPermit2Approval && includePermit2Call) {
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

    hooks.addContractInterface(vaultAddr, vaultDepositAbi)
    hooks.addContractInterface(borrowVaultAddr, vaultBorrowAbi)
    hooks.addContractInterface(evcAddress, [...evcEnableControllerAbi, ...evcEnableCollateralAbi])

    if (!hasSigned) {
      hooks.addContractInterface(tosSignerAddress, tosSignerWriteAbi)
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

    hooks.addContractInterface(vaultAddr, erc20TransferAbi)
    hooks.addContractInterface(borrowVaultAddr, vaultBorrowAbi)
    hooks.addContractInterface(evcAddress, [...evcEnableCollateralAbi, ...evcEnableControllerAbi])

    if (!hasSigned) {
      hooks.addContractInterface(tosSignerAddress, tosSignerWriteAbi)
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

  const buildMultiplyPlan = async ({
    supplyVaultAddress,
    supplyAssetAddress,
    supplyAmount,
    supplySharesAmount,
    supplyIsSavings = false,
    longVaultAddress,
    longAssetAddress,
    borrowVaultAddress,
    debtAmount,
    quote,
    swapperMode = SwapperMode.EXACT_IN,
    subAccount,
    includePermit2Call = true,
  }: {
    supplyVaultAddress: string
    supplyAssetAddress: string
    supplyAmount: bigint
    supplySharesAmount?: bigint
    supplyIsSavings?: boolean
    longVaultAddress: string
    longAssetAddress: string
    borrowVaultAddress: string
    debtAmount: bigint
    quote?: SwapApiQuote
    swapperMode?: SwapperMode
    subAccount?: string
    includePermit2Call?: boolean
  }): Promise<TxPlan> => {
    if (!address.value || !eulerCoreAddresses.value || !eulerPeripheryAddresses.value) {
      throw new Error('Wallet not connected or addresses not available')
    }

    const supplyVaultAddr = supplyVaultAddress as Address
    const supplyAssetAddr = supplyAssetAddress as Address
    const longVaultAddr = longVaultAddress as Address
    const longAssetAddr = longAssetAddress as Address
    const borrowVaultAddr = borrowVaultAddress as Address
    const userAddr = address.value as Address
    const evcAddress = eulerCoreAddresses.value.evc as Address
    const tosSignerAddress = eulerPeripheryAddresses.value.termsOfUseSigner as Address
    const supplyPermit2Address = resolvePermit2Address(supplyVaultAddr)
    const longPermit2Address = resolvePermit2Address(longVaultAddr)

    const subAccountAddr = subAccount || await getNewSubAccount(address.value)
    const hasSigned = await hasSignature(userAddr)
    const requirePermit2 = true

    const hasSwap = !!quote
    const borrowDepositAmount = hasSwap ? 0n : debtAmount
    const isSameVault = supplyVaultAddr.toLowerCase() === longVaultAddr.toLowerCase()
    const isSupplySavings = Boolean(supplyIsSavings)
    const shouldDepositSupply = !isSupplySavings
    if (isSupplySavings && (!supplySharesAmount || supplySharesAmount <= 0n)) {
      throw new Error('Supply shares amount missing')
    }
    const supplyApprovalAmount = shouldDepositSupply
      ? supplyAmount + (isSameVault ? borrowDepositAmount : 0n)
      : 0n

    const steps: TxStep[] = []
    const permitCalls: EVCCall[] = []
    let usesPermit2 = false

    const prepareApproval = async (
      assetAddr: Address,
      vaultAddr: Address,
      amount: bigint,
      permit2Addr?: Address,
    ) => {
      let permitCall: EVCCall | undefined
      let usesPermit2Local = false

      if (amount <= 0n) {
        return { permitCall, usesPermit2Local }
      }

      const allowance = await checkAllowance(assetAddr, vaultAddr, userAddr)
      const canUsePermit2 = !!chainId.value && !!permit2Addr
      usesPermit2Local = canUsePermit2 && allowance < amount

      if (usesPermit2Local && permit2Addr) {
        const permit2Allowance = await checkAllowance(assetAddr, permit2Addr, userAddr)
        const needsPermit2Approval = permit2Allowance < amount
        if (needsPermit2Approval) {
          steps.push({
            type: 'permit2-approve',
            label: 'Approve token for Permit2',
            to: assetAddr,
            abi: erc20ABI as Abi,
            functionName: 'approve',
            args: [permit2Addr, maxUint256] as const,
            value: 0n,
          })
        }

        if (!needsPermit2Approval && includePermit2Call) {
          permitCall = await buildPermit2Call(assetAddr, vaultAddr, amount, userAddr, permit2Addr)
        }
      }
      else if (allowance < amount) {
        if (requirePermit2) {
          throw new Error('Permit2 required for multiply')
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

      return { permitCall, usesPermit2Local }
    }

    if (shouldDepositSupply) {
      const supplyApproval = await prepareApproval(
        supplyAssetAddr,
        supplyVaultAddr,
        supplyApprovalAmount,
        supplyPermit2Address,
      )
      if (supplyApproval.permitCall) {
        permitCalls.push(supplyApproval.permitCall)
      }
      usesPermit2 = usesPermit2 || supplyApproval.usesPermit2Local
    }

    if (borrowDepositAmount > 0n && (!isSameVault || !shouldDepositSupply)) {
      const longApproval = await prepareApproval(
        longAssetAddr,
        longVaultAddr,
        borrowDepositAmount,
        longPermit2Address,
      )
      if (longApproval.permitCall) {
        permitCalls.push(longApproval.permitCall)
      }
      usesPermit2 = usesPermit2 || longApproval.usesPermit2Local
    }

    const hooks = new SaHooksBuilder()

    hooks.addContractInterface(supplyVaultAddr, vaultDepositAbi)
    if (isSupplySavings) {
      hooks.addContractInterface(supplyVaultAddr, erc20TransferAbi)
    }
    if (isSupplySavings) {
      hooks.addPreHookCallFromSelf(supplyVaultAddr, 'transfer', [subAccountAddr, supplySharesAmount!])
    }
    if (!isSameVault) {
      hooks.addContractInterface(longVaultAddr, vaultDepositAbi)
    }
    hooks.addContractInterface(borrowVaultAddr, vaultBorrowAbi)
    hooks.addContractInterface(evcAddress, [...evcEnableControllerAbi, ...evcEnableCollateralAbi])

    if (!hasSigned) {
      hooks.addContractInterface(tosSignerAddress, tosSignerWriteAbi)
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

    if (permitCalls.length) {
      evcCalls.unshift(...permitCalls)
    }

    if (shouldDepositSupply && supplyAmount > 0n) {
      const depositCall = {
        targetContract: supplyVaultAddr,
        onBehalfOfAccount: userAddr,
        value: 0n,
        data: hooks.getDataForCall(supplyVaultAddr, 'deposit', [supplyAmount, subAccountAddr]) as Hash,
      }
      evcCalls.push(depositCall as EVCCall)
    }

    const enableControllerCall = {
      targetContract: evcAddress,
      onBehalfOfAccount: '0x0000000000000000000000000000000000000000' as Address,
      value: 0n,
      data: hooks.getDataForCall(evcAddress, 'enableController', [subAccountAddr, borrowVaultAddr]) as Hash,
    }

    const enableSupplyCollateralCall = {
      targetContract: evcAddress,
      onBehalfOfAccount: '0x0000000000000000000000000000000000000000' as Address,
      value: 0n,
      data: hooks.getDataForCall(evcAddress, 'enableCollateral', [subAccountAddr, supplyVaultAddr]) as Hash,
    }

    const borrowRecipient = hasSwap ? quote!.swap.swapperAddress : userAddr
    const borrowAmount = hasSwap ? getSwapInputAmount(quote!, swapperMode) : debtAmount
    if (borrowAmount <= 0n) {
      throw new Error('Borrow amount is zero')
    }

    const borrowCall = {
      targetContract: borrowVaultAddr,
      onBehalfOfAccount: subAccountAddr,
      value: 0n,
      data: hooks.getDataForCall(borrowVaultAddr, 'borrow', [borrowAmount, borrowRecipient]) as Hash,
    }

    evcCalls.push(enableControllerCall as EVCCall, enableSupplyCollateralCall as EVCCall, borrowCall as EVCCall)

    if (hasSwap) {
      if (quote!.verify.type !== SwapVerificationType.SkimMin) {
        throw new Error('Swap verifier type mismatch')
      }
      if (quote!.accountIn.toLowerCase() !== subAccountAddr.toLowerCase()) {
        throw new Error('Swap quote account mismatch')
      }
      const verifierData = buildSwapVerifierData({
        quote: quote!,
        swapperMode,
        isRepay: false,
        targetDebt: 0n,
        currentDebt: 0n,
      })
      if (verifierData.toLowerCase() !== quote!.verify.verifierData.toLowerCase()) {
        console.warn('[multiply] SwapVerifier data mismatch')
        throw new Error('SwapVerifier data mismatch')
      }

      evcCalls.push({
        targetContract: quote!.swap.swapperAddress,
        onBehalfOfAccount: quote!.accountIn as Address,
        value: 0n,
        data: encodeFunctionData({
          abi: swapperAbi,
          functionName: 'multicall',
          args: [quote!.swap.multicallItems.map(item => item.data)],
        }),
      })

      evcCalls.push({
        targetContract: quote!.verify.verifierAddress,
        onBehalfOfAccount: quote!.verify.account,
        value: 0n,
        data: verifierData,
      })
    }
    else if (debtAmount > 0n) {
      const depositBorrowedCall = {
        targetContract: longVaultAddr,
        onBehalfOfAccount: userAddr,
        value: 0n,
        data: hooks.getDataForCall(longVaultAddr, 'deposit', [debtAmount, subAccountAddr]) as Hash,
      }
      evcCalls.push(depositBorrowedCall as EVCCall)
    }

    if (!isSameVault) {
      const enableLongCollateralCall = {
        targetContract: evcAddress,
        onBehalfOfAccount: '0x0000000000000000000000000000000000000000' as Address,
        value: 0n,
        data: hooks.getDataForCall(evcAddress, 'enableCollateral', [subAccountAddr, longVaultAddr]) as Hash,
      }
      evcCalls.push(enableLongCollateralCall as EVCCall)
    }

    const pythVaults = isSameVault
      ? [supplyVaultAddr, borrowVaultAddr]
      : [supplyVaultAddr, borrowVaultAddr, longVaultAddr]
    const { calls: pythCalls } = await preparePythUpdates(pythVaults, userAddr)
    if (pythCalls.length) {
      evcCalls.unshift(...pythCalls as EVCCall[])
    }

    const totalValue = sumCallValues(evcCalls)

    steps.push({
      type: 'evc-batch',
      label: usesPermit2 ? 'Permit2 multiply via EVC' : 'Multiply via EVC',
      to: evcAddress,
      abi: EVC_ABI,
      functionName: 'batch',
      args: [evcCalls as never],
      value: totalValue,
    })

    return {
      kind: 'multiply',
      steps,
    }
  }

  const buildRepayPlan = async (
    borrowVaultAddress: string,
    borrowAssetAddress: string,
    amount: bigint,
    subAccount: string,
    options: { includePermit2Call?: boolean } = {},
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
    const includePermit2Call = options.includePermit2Call ?? true
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

      if (!needsPermit2Approval && includePermit2Call) {
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

    hooks.addContractInterface(borrowVaultAddr, vaultRepayAbi)

    if (!hasSigned) {
      hooks.addContractInterface(tosSignerAddress, tosSignerWriteAbi)
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

    const { calls: pythCalls } = await preparePythUpdates([borrowVaultAddr], userAddr)
    if (pythCalls.length) {
      evcCalls.unshift(...pythCalls as EVCCall[])
    }

    const totalValue = sumCallValues(evcCalls)

    steps.push({
      type: 'evc-batch',
      label: usesPermit2 ? 'Permit2 repay via EVC' : 'Repay via EVC',
      to: evcAddress,
      abi: EVC_ABI,
      functionName: 'batch',
      args: [evcCalls as never],
      value: totalValue,
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
    options: { includePermit2Call?: boolean } = {},
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
    const includePermit2Call = options.includePermit2Call ?? true
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

      if (!needsPermit2Approval && includePermit2Call) {
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

    const vaultContract = new ethers.Contract(
      vaultAddr,
      [...erc20BalanceOfAbi, ...vaultConvertToAssetsAbi],
      rpcProvider,
    )

    const subAccountShares = await vaultContract.balanceOf(subAccountAddr).catch(() => 0n)
    const subAccountAssets = await vaultContract.convertToAssets(subAccountShares).catch(() => 0n)

    const hooks = new SaHooksBuilder()

    hooks.addContractInterface(borrowVaultAddr, [...vaultRepayAbi, ...evcDisableControllerAbi])
    hooks.addContractInterface(vaultAddr, [...vaultRedeemAbi, ...vaultDepositAbi])
    hooks.addContractInterface(evcAddress, evcDisableCollateralAbi)

    if (!hasSigned) {
      hooks.addContractInterface(tosSignerAddress, tosSignerWriteAbi)
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

    const { calls: pythCalls } = await preparePythUpdates([vaultAddr, borrowVaultAddr], userAddr)
    if (pythCalls.length) {
      evcCalls.unshift(...pythCalls as EVCCall[])
    }

    const totalValue = sumCallValues(evcCalls)

    steps.push({
      type: 'evc-batch',
      label: usesPermit2 ? 'Permit2 full repay via EVC' : 'Repay via EVC',
      to: evcAddress,
      abi: EVC_ABI,
      functionName: 'batch',
      args: [evcCalls as never],
      value: totalValue,
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
    enableCollateral = false,
  }: {
    quote: SwapApiQuote
    swapperMode?: SwapperMode
    isRepay?: boolean
    targetDebt?: bigint
    currentDebt?: bigint
    enableCollateral?: boolean
  }): Promise<TxPlan> => {
    const { evcCalls, evcAddress, totalValue } = await buildSwapEvcCalls({
      quote,
      swapperMode,
      isRepay,
      targetDebt,
      currentDebt,
      enableCollateral,
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

    hooks.addContractInterface(vaultAddr, vaultRedeemAbi)

    if (!hasSigned) {
      hooks.addContractInterface(tosSignerAddress, tosSignerWriteAbi)
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

    const { calls: pythCalls } = await preparePythUpdates([vaultAddr], userAddr)
    if (pythCalls.length) {
      evcCalls.unshift(...pythCalls as EVCCall[])
    }

    const totalValue = sumCallValues(evcCalls)

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
          value: totalValue,
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
    enableCollateral = false,
  }: {
    quote: SwapApiQuote
    swapperMode?: SwapperMode
    isRepay?: boolean
    targetDebt?: bigint
    currentDebt?: bigint
    enableCollateral?: boolean
  }) => {
    const { evcCalls, evcAddress, totalValue } = await buildSwapEvcCalls({
      quote,
      swapperMode,
      isRepay,
      targetDebt,
      currentDebt,
      enableCollateral,
    })

    const swapHash = await writeContractAsync({
      address: evcAddress,
      abi: EVC_ABI,
      functionName: 'batch',
      args: [evcCalls as never],
      value: totalValue,
    })

    await waitForTxReceipt(swapHash)
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

      await waitForTxReceipt(approvalHash)
    }

    const hooks = new SaHooksBuilder()

    hooks.addContractInterface(assetAddr, erc20ApproveAbi)
    hooks.addContractInterface(vaultAddr, vaultDepositAbi)

    if (!hasSigned) {
      hooks.addContractInterface(tosSignerAddress, tosSignerWriteAbi)
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

    const { calls: pythCalls } = await preparePythUpdates([vaultAddr], userAddr)
    if (pythCalls.length) {
      evcCalls.unshift(...pythCalls as EVCCall[])
    }

    const totalValue = sumCallValues(evcCalls)

    const depositHash = await writeContractAsync({
      address: evcAddress,
      abi: EVC_ABI,
      functionName: 'batch',
      args: [evcCalls as never],
      value: totalValue,
    })

    await waitForTxReceipt(depositHash)
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

    hooks.addContractInterface(vaultAddr, vaultWithdrawAbi)

    if (!hasSigned) {
      hooks.addContractInterface(tosSignerAddress, tosSignerWriteAbi)
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

    const { calls: pythCalls } = await preparePythUpdates([vaultAddr], userAddr)
    if (pythCalls.length) {
      evcCalls.unshift(...pythCalls as EVCCall[])
    }

    const totalValue = sumCallValues(evcCalls)

    const withdrawHash = await writeContractAsync({
      address: evcAddress,
      abi: EVC_ABI,
      functionName: 'batch',
      args: [evcCalls as never],
      value: totalValue,
    })

    await waitForTxReceipt(withdrawHash)
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

    const vaultContract = new ethers.Contract(vaultAddr, vaultPreviewWithdrawAbi, rpcProvider)

    let sharesAmount = isMax
      ? maxSharesAmount || 0n
      : await vaultContract.previewWithdraw(assetsAmount).catch(() => 0n)

    if (isMax === false && maxSharesAmount && (sharesAmount > maxSharesAmount)) {
      sharesAmount = maxSharesAmount
    }

    const hooks = new SaHooksBuilder()

    hooks.addContractInterface(vaultAddr, vaultRedeemAbi)

    if (!hasSigned) {
      hooks.addContractInterface(tosSignerAddress, tosSignerWriteAbi)
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

    const { calls: pythCalls } = await preparePythUpdates([vaultAddr], userAddr)
    if (pythCalls.length) {
      evcCalls.unshift(...pythCalls as EVCCall[])
    }

    const totalValue = sumCallValues(evcCalls)

    const redeemHash = await writeContractAsync({
      address: evcAddress,
      abi: EVC_ABI,
      functionName: 'batch',
      args: [evcCalls as never],
      value: totalValue,
    })

    await waitForTxReceipt(redeemHash)
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

        await waitForTxReceipt(approvalHash)
      }
    }

    const hooks = new SaHooksBuilder()

    hooks.addContractInterface(vaultAddr, vaultDepositAbi)
    hooks.addContractInterface(borrowVaultAddr, vaultBorrowAbi)
    hooks.addContractInterface(evcAddress, [...evcEnableControllerAbi, ...evcEnableCollateralAbi])

    if (!hasSigned) {
      hooks.addContractInterface(tosSignerAddress, tosSignerWriteAbi)
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

    await waitForTxReceipt(borrowHash)
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
    hooks.addContractInterface(vaultAddr, erc20TransferAbi)
    hooks.addContractInterface(borrowVaultAddr, vaultBorrowAbi)
    hooks.addContractInterface(evcAddress, [...evcEnableCollateralAbi, ...evcEnableControllerAbi])

    if (!hasSigned) {
      hooks.addContractInterface(tosSignerAddress, tosSignerWriteAbi)
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

    await waitForTxReceipt(borrowHash)
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

      await waitForTxReceipt(approvalHash)
    }

    const hooks = new SaHooksBuilder()

    hooks.addContractInterface(borrowVaultAddr, vaultRepayAbi)

    if (!hasSigned) {
      hooks.addContractInterface(tosSignerAddress, tosSignerWriteAbi)
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

    const { calls: pythCalls } = await preparePythUpdates([borrowVaultAddr], userAddr)
    if (pythCalls.length) {
      evcCalls.unshift(...pythCalls as EVCCall[])
    }

    const totalValue = sumCallValues(evcCalls)

    const repayHash = await writeContractAsync({
      address: evcAddress,
      abi: EVC_ABI,
      functionName: 'batch',
      args: [evcCalls as never],
      value: totalValue,
    })

    await waitForTxReceipt(repayHash)
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

      await waitForTxReceipt(approvalHash)
    }

    const vaultContract = new ethers.Contract(
      vaultAddr,
      [...erc20BalanceOfAbi, ...vaultConvertToAssetsAbi],
      rpcProvider,
    )

    const subAccountShares = await vaultContract.balanceOf(subAccountAddr).catch(() => 0n)
    const subAccountAssets = await vaultContract.convertToAssets(subAccountShares).catch(() => 0n)

    console.log('subAccountShares', subAccountShares)
    console.log('subAccountAssets', subAccountAssets)

    const hooks = new SaHooksBuilder()

    hooks.addContractInterface(borrowVaultAddr, [...vaultRepayAbi, ...evcDisableControllerAbi])
    hooks.addContractInterface(vaultAddr, [...vaultRedeemAbi, ...vaultDepositAbi])
    hooks.addContractInterface(evcAddress, evcDisableCollateralAbi)

    if (!hasSigned) {
      hooks.addContractInterface(tosSignerAddress, tosSignerWriteAbi)
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

    const { calls: pythCalls } = await preparePythUpdates([vaultAddr, borrowVaultAddr], userAddr)
    if (pythCalls.length) {
      evcCalls.unshift(...pythCalls as EVCCall[])
    }

    const totalValue = sumCallValues(evcCalls)

    const fullRepayHash = await writeContractAsync({
      address: evcAddress,
      abi: EVC_ABI,
      functionName: 'batch',
      args: [evcCalls as never],
      value: totalValue,
    })

    await waitForTxReceipt(fullRepayHash)
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

    hooks.addContractInterface(vaultAddr, vaultRedeemAbi)

    if (!hasSigned) {
      hooks.addContractInterface(tosSignerAddress, tosSignerWriteAbi)
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

    const { calls: pythCalls } = await preparePythUpdates([vaultAddr], userAddr)
    if (pythCalls.length) {
      evcCalls.unshift(...pythCalls as EVCCall[])
    }

    const totalValue = sumCallValues(evcCalls)

    const disableHash = await writeContractAsync({
      address: evcAddress,
      abi: EVC_ABI,
      functionName: 'batch',
      args: [evcCalls as never],
      value: totalValue,
    })

    await waitForTxReceipt(disableHash)
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
    simulateTxPlan,
    buildSupplyPlan,
    buildWithdrawPlan,
    buildRedeemPlan,
    buildBorrowPlan,
    buildBorrowBySavingPlan,
    buildMultiplyPlan,
    buildRepayPlan,
    buildFullRepayPlan,
    buildSwapPlan,
    buildDisableCollateralPlan,
  }
}
