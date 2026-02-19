import { useConfig, useSignTypedData, useWriteContract } from '@wagmi/vue'
import { readContract, simulateContract } from '@wagmi/vue/actions'
import type { Address, Hash, Hex, Abi, StateOverride } from 'viem'
import { encodeFunctionData, encodePacked, getAddress, hexToBigInt, keccak256, maxUint256, toHex, zeroAddress } from 'viem'
import { getPublicClient } from '~/utils/public-client'
import { ALLOWANCE_MAX_SEQUENTIAL_SLOT, ALLOWANCE_EXTRA_SLOT_CANDIDATES, PERMIT2_SIG_WINDOW } from '~/entities/constants'
import { getTosData } from '~/composables/useTosData'
// enableTermsOfUseSignature is read from useDeployConfig() inside useEulerOperations()
import { SaHooksBuilder } from '~/entities/saHooksSDK'
import { erc20ApproveAbi, erc20BalanceOfAbi, erc20TransferAbi } from '~/abis/erc20'
import { EVC_ABI, evcDisableCollateralAbi, evcDisableControllerAbi, evcEnableCollateralAbi, evcEnableControllerAbi } from '~/abis/evc'
import { tosSignerReadAbi, tosSignerWriteAbi } from '~/abis/tos'
import { vaultBorrowAbi, vaultConvertToAssetsAbi, vaultDepositAbi, vaultPreviewWithdrawAbi, vaultRedeemAbi, vaultRepayAbi, vaultRepayWithSharesAbi, vaultSkimAbi, vaultTransferFromMaxAbi, vaultWithdrawAbi } from '~/abis/vault'
import { convertSaHooksToEVCCalls, type EVCCall } from '~/utils/evc-converter'
import { getNewSubAccount } from '~/entities/account'
import { buildCollateralCleanupCalls } from '~/utils/collateral-cleanup'
import { erc20ABI, swapperAbi, swapVerifierAbi, transferFromSenderAbi } from '~/entities/euler/abis'
import type { TxPlan, TxStep } from '~/entities/txPlan'
import type { Vault } from '~/entities/vault'
import { buildPythUpdateCalls, buildPythUpdateCallsFromFeeds, collectPythFeedsForHealthCheck, sumCallValues } from '~/utils/pyth'
import { logWarn, catchToFallback } from '~/utils/errorHandling'
import { useVaults } from '~/composables/useVaults'
import { useVaultRegistry } from '~/composables/useVaultRegistry'
import { MAX_UINT160, PERMIT2_TYPES, permit2Abi } from '~/entities/permit2'
import { type SwapApiQuote, SwapperMode, SwapVerificationType } from '~/entities/swap'
import { isNonBlockingSimulationError } from '~/utils/tx-errors'
import { INTEREST_ADJUSTMENT_BPS, BPS_BASE } from '~/entities/tuning-constants'

const allowanceSlotIndexCache = new Map<string, bigint>()
/** Pad amount by 0.01% to cover interest accrual between plan build and tx execution */
const adjustForInterest = (amount: bigint) => (amount * INTEREST_ADJUSTMENT_BPS) / BPS_BASE

export const useEulerOperations = () => {
  const { address, chainId } = useWagmi()
  const { writeContractAsync } = useWriteContract()
  const { signTypedDataAsync } = useSignTypedData()
  const config = useConfig()
  const { eulerCoreAddresses, eulerPeripheryAddresses, eulerLensAddresses } = useEulerAddresses()
  const { enableTosSignature: enableTermsOfUseSignature } = useDeployConfig()
  const { EVM_PROVIDER_URL, PYTH_HERMES_URL, SUBGRAPH_URL } = useEulerConfig()
  const { get: registryGet } = useVaultRegistry()
  const { permit2Enabled } = usePermit2Preference()

  const rpcProvider = getPublicClient(EVM_PROVIDER_URL)
  const resolvePermit2Address = (): Address | undefined => {
    const permit2 = eulerCoreAddresses.value?.permit2 as Address | undefined
    return permit2 && permit2 !== zeroAddress ? permit2 : undefined
  }

  const waitForTxReceipt = async (txHash?: Hash) => {
    if (!txHash) {
      return
    }

    const receipt = await rpcProvider.waitForTransactionReceipt({ hash: txHash })
    if (receipt.status === 'reverted') {
      throw new Error('Transaction reverted')
    }
  }

  const checkAllowance = async (assetAddress: Address, spenderAddress: Address, userAddress: Address): Promise<bigint> => {
    try {
      const allowance = await rpcProvider.readContract({
        address: assetAddress,
        abi: erc20ABI,
        functionName: 'allowance',
        args: [userAddress, spenderAddress],
      })
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
      return getAddress(address)
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
      console.info('[resolveAllowanceSlotIndex] cache hit', { token: tokenKey, slotIndex: cached.toString() })
      return cached
    }

    const trySlot = async (slotIndex: bigint): Promise<boolean> => {
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
          console.info('[resolveAllowanceSlotIndex] found slot', { token: tokenKey, slotIndex: slotIndex.toString(), slot })
          allowanceSlotIndexCache.set(tokenKey, slotIndex)
          return true
        }
      }
      catch {
        // slot candidate didn't match
      }
      return false
    }

    for (let i = 0; i <= ALLOWANCE_MAX_SEQUENTIAL_SLOT; i++) {
      if (await trySlot(BigInt(i))) return BigInt(i)
    }
    for (const slotIndex of ALLOWANCE_EXTRA_SLOT_CANDIDATES) {
      if (await trySlot(slotIndex)) return slotIndex
    }

    logWarn('resolveAllowanceSlotIndex', 'no slot found for token', { data: { token: tokenKey, owner, spender } })
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
  // Selector for SwapVerifier.transferFromSender(address token, uint256 amount, address receiver)
  const TRANSFER_FROM_SENDER_SELECTOR = '0xbe6f2b2f'

  const extractTokenFromTransferFromSender = (data: string): Address | undefined => {
    if (!data.startsWith(TRANSFER_FROM_SENDER_SELECTOR) || data.length < 74) {
      return undefined
    }
    try {
      return getAddress(`0x${data.slice(34, 74)}`) as Address
    }
    catch {
      return undefined
    }
  }

  const buildSimulationStateOverride = async (plan: TxPlan, owner: Address): Promise<StateOverride> => {
    const approvalPairs: { token: Address; spender: Address }[] = []
    const approvalSeen = new Set<string>()
    const permit2TokenAddresses: Address[] = []

    for (const step of plan.steps) {
      if (step.type === 'permit2-approve') {
        permit2TokenAddresses.push(step.to)
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
    // Always build Permit2 overrides — they're harmless when Permit2 isn't used
    // and essential when Permit2 IS used (even without a separate permit2-approve step,
    // e.g. when the user already approved the token for Permit2 in a previous tx).
    const permit2Pairs = new Map<string, { address: Address; pairs: { token: Address; spender: Address }[] }>()
    const permit2Address = resolvePermit2Address()
    if (permit2Address) {
      // Collect tokens from permit2-approve steps AND from transferFromSender calldata in the batch
      const knownTokens = new Set<string>(permit2TokenAddresses.map(normalizeAddress))
      for (const step of plan.steps) {
        if (step.type !== 'evc-batch') continue
        const calls = step.args?.[0] as EVCCall[] | undefined
        if (!Array.isArray(calls)) continue
        for (const call of calls) {
          const token = extractTokenFromTransferFromSender(call?.data)
          if (token) {
            knownTokens.add(normalizeAddress(token))
          }
        }
      }
      const tokenAddresses = [...knownTokens].map(t => getAddress(t) as Address)

      // Ensure ERC20 allowance overrides exist for token → Permit2.
      // When the plan omits the permit2-approve step (e.g. user already approved
      // in a previous session), the approval pairs list is empty and the simulation
      // would fail because Permit2 can't pull the token from the user.
      for (const token of tokenAddresses) {
        const key = `${normalizeAddress(token)}:${normalizeAddress(permit2Address)}`
        if (!approvalSeen.has(key)) {
          approvalSeen.add(key)
          approvalPairs.push({ token, spender: permit2Address })
        }
      }

      for (const step of plan.steps) {
        if (step.type !== 'evc-batch') continue
        const calls = step.args?.[0] as EVCCall[] | undefined
        if (!Array.isArray(calls)) continue

        const permit2Key = normalizeAddress(permit2Address)
        const entry = permit2Pairs.get(permit2Key) || { address: permit2Address, pairs: [] }

        const addPair = (token: Address, spender: Address) => {
          const pairKey = `${normalizeAddress(token)}:${normalizeAddress(spender)}`
          if (!entry.pairs.some(pair => `${normalizeAddress(pair.token)}:${normalizeAddress(pair.spender)}` === pairKey)) {
            entry.pairs.push({ token, spender })
          }
        }

        for (const call of calls) {
          const target = call?.targetContract
          if (!target) continue

          // Vault target: vault pulls tokens via Permit2.transferFrom
          const vaultEntry = registryGet(normalizeAddress(target))
          const vault = vaultEntry?.vault
          if (vault?.asset?.address && vault.address) {
            addPair(vault.asset.address as Address, vault.address as Address)
            continue
          }

          // Non-vault target: only override if this call uses transferFromSender
          // (e.g. SwapVerifier pulls tokens via Permit2)
          const transferToken = extractTokenFromTransferFromSender(call?.data)
          if (transferToken) {
            addPair(transferToken, target)
          }
        }

        permit2Pairs.set(permit2Key, entry)
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

    try {
      const result = await rpcProvider.readContract({
        address: resolvedPermit2,
        abi: permit2Abi,
        functionName: 'allowance',
        args: [owner, token, spender],
      })
      const tuple = result as unknown as readonly [bigint, bigint, bigint]
      const amount = tuple[0] ?? 0n
      const expiration = tuple[1] ?? 0n
      const nonce = tuple[2] ?? 0n

      return { amount, expiration, nonce }
    }
    catch {
      return { amount: 0n, expiration: 0n, nonce: 0n }
    }
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
        amount: requiredAmount > MAX_UINT160 ? MAX_UINT160 : requiredAmount,
        expiration: Number(currentTime + PERMIT2_SIG_WINDOW),
        nonce: Number(allowance.nonce),
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
      const { getVault: registryGetVault } = useVaultRegistry()
      const vaults = vaultAddresses.map((addr) => {
        return registryGetVault(getAddress(addr)) as Vault | undefined
      })
      return await buildPythUpdateCalls(vaults, EVM_PROVIDER_URL, PYTH_HERMES_URL, sender)
    }
    catch (err) {
      logWarn('preparePythUpdates', err)
      return { calls: [], totalFee: 0n }
    }
  }

  /**
   * Collect Pyth feeds needed for a health check using only the LIABILITY vault's oracle.
   * Resolves feeds for the liability asset and each enabled collateral's underlying asset,
   * all priced against the liability vault's unit of account.
   */
  const preparePythUpdatesForHealthCheck = async (
    liabilityVaultAddress: string,
    collateralVaultAddresses: string[],
    sender: Address,
  ) => {
    try {
      const { getVault: registryGetVault } = useVaultRegistry()
      const liabilityVault = registryGetVault(getAddress(liabilityVaultAddress)) as Vault | undefined
      if (!liabilityVault) {
        logWarn('preparePythUpdatesForHealthCheck', `liability vault not found: ${liabilityVaultAddress}`)
        return { calls: [], totalFee: 0n }
      }

      // Pass collateral vault addresses directly - the EulerRouter has routes
      // keyed by vault address (e.g. sBOLD vault → ERC4626 unwrap → BOLD → Pyth)
      const feeds = collectPythFeedsForHealthCheck(liabilityVault, collateralVaultAddresses)
      return await buildPythUpdateCallsFromFeeds(feeds, EVM_PROVIDER_URL, PYTH_HERMES_URL, sender)
    }
    catch (err) {
      logWarn('preparePythUpdatesForHealthCheck', err)
      return { calls: [], totalFee: 0n }
    }
  }

  /**
   * Compute the set of collateral vault addresses that will be enabled after the tx.
   */
  const resolveEffectiveCollaterals = (
    enabledCollaterals?: string[],
    adding?: string[],
    removing?: string[],
  ): string[] => {
    const set = new Set<string>()
    for (const addr of enabledCollaterals || []) {
      set.add(normalizeAddress(addr))
    }
    for (const addr of adding || []) {
      set.add(normalizeAddress(addr))
    }
    for (const addr of removing || []) {
      set.delete(normalizeAddress(addr))
    }
    return [...set]
  }

  const hasSignature = async (userAddress: Address) => {
    if (!eulerPeripheryAddresses.value) {
      return false
    }

    const abi = tosSignerReadAbi
    const tosSignerAddress = eulerPeripheryAddresses.value.termsOfUseSigner as Address

    try {
      const { tosMessageHash } = await getTosData()
      const lastSignTimestamp = await rpcProvider.readContract({
        address: tosSignerAddress,
        abi,
        functionName: 'lastTermsOfUseSignatureTimestamp',
        args: [userAddress, tosMessageHash],
      })
      return (lastSignTimestamp as bigint) > 0
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
    disableCollateral,
    liabilityVault,
    enabledCollaterals,
    isDebtSwap = false,
  }: {
    quote: SwapApiQuote
    swapperMode: SwapperMode
    isRepay: boolean
    targetDebt?: bigint
    currentDebt?: bigint
    enableCollateral?: boolean
    disableCollateral?: string
    liabilityVault?: string
    enabledCollaterals?: string[]
    /** When true, uses borrow (not withdraw) on the input vault, enables a controller
     *  on accountOut, and disables the old controller after the swap. */
    isDebtSwap?: boolean
  }) => {
    if (!address.value || !eulerCoreAddresses.value || !eulerPeripheryAddresses.value) {
      throw new Error('Wallet not connected or addresses not available')
    }

    const userAddr = address.value as Address
    const evcAddress = eulerCoreAddresses.value.evc as Address
    const tosSignerAddress = eulerPeripheryAddresses.value.termsOfUseSigner as Address
    const hasSigned = await hasSignature(userAddr)
    const tosData = await getTosData()

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

    // isDebtSwap controls whether the input side uses borrow (true) or withdraw (false).
    // Callers must explicitly opt in — different accountIn/accountOut doesn't imply debt swap
    // (e.g. savings repay withdraws from a different sub-account, not a borrow).
    const verifierData = buildSwapVerifierData({
      quote,
      swapperMode,
      isRepay,
      targetDebt,
      currentDebt,
    })

    if (verifierData.toLowerCase() !== quote.verify.verifierData.toLowerCase()) {
      logWarn('swap', 'SwapVerifier data mismatch')
      throw new Error('SwapVerifier data mismatch')
    }

    const hooks = new SaHooksBuilder()
    if (isDebtSwap) {
      hooks.addContractInterface(quote.vaultIn, vaultBorrowAbi)
      hooks.addContractInterface(quote.receiver, evcDisableControllerAbi)
    }
    else {
      hooks.addContractInterface(quote.vaultIn, vaultWithdrawAbi)
    }

    const evcAbis = [
      ...(isDebtSwap ? evcEnableControllerAbi : []),
      ...(enableCollateral ? evcEnableCollateralAbi : []),
      ...(disableCollateral ? evcDisableCollateralAbi : []),
    ]
    if (evcAbis.length) {
      hooks.addContractInterface(evcAddress, evcAbis)
    }

    if (!hasSigned && enableTermsOfUseSignature) {
      hooks.addContractInterface(tosSignerAddress, tosSignerWriteAbi)
    }

    const evcCalls: EVCCall[] = []

    if (!hasSigned && enableTermsOfUseSignature) {
      evcCalls.push({
        targetContract: tosSignerAddress,
        onBehalfOfAccount: userAddr,
        value: 0n,
        data: hooks.getDataForCall(tosSignerAddress, 'signTermsOfUse', [tosData.tosMessage, tosData.tosMessageHash]) as Hash,
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

    if (disableCollateral) {
      const oldVaultAddr = disableCollateral as Address
      evcCalls.push({
        targetContract: evcAddress,
        onBehalfOfAccount: '0x0000000000000000000000000000000000000000' as Address,
        value: 0n,
        data: hooks.getDataForCall(evcAddress, 'disableCollateral', [quote.accountOut, oldVaultAddr]) as Hash,
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

    let pythResult: { calls: EVCCall[]; totalFee: bigint }
    if (liabilityVault) {
      const removingCollaterals = disableCollateral ? [disableCollateral] : []
      const effectiveCollaterals = resolveEffectiveCollaterals(enabledCollaterals, enableCollateral ? [quote.receiver] : [], removingCollaterals)
      pythResult = await preparePythUpdatesForHealthCheck(liabilityVault, effectiveCollaterals, userAddr)
    }
    else {
      pythResult = await preparePythUpdates([quote.vaultIn, quote.receiver], userAddr)
    }
    const { calls: pythCalls } = pythResult
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
    const usesPermit2 = plan.steps.some(step => step.type === 'permit2-approve' || (step.label && step.label.includes('Permit2')))
    const stepsToSimulate = plan.steps.filter(step => step.type !== 'approve' && step.type !== 'permit2-approve')

    const stateOverride = await catchToFallback(
      async () => {
        const overrides = await buildSimulationStateOverride(plan, address.value as Address)
        return overrides.length ? overrides as StateOverride : undefined
      },
      undefined,
      'simulateTxPlan/stateOverrides',
    )

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
        const isNonBlocking = (hasApprovalSteps || usesPermit2) && isNonBlockingSimulationError(err)
        if (isNonBlocking) {
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
    const tosData = await getTosData()
    const allowance = await checkAllowance(assetAddr, vaultAddr, userAddr)
    const permit2Address = resolvePermit2Address()
    const includePermit2Call = options.includePermit2Call ?? true
    const canUsePermit2 = !!chainId.value && !!permit2Address && permit2Enabled.value

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

      if (includePermit2Call) {
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
        args: [vaultAddr, amount] as const,
        value: 0n,
      })
    }

    const hooks = new SaHooksBuilder()

    hooks.addContractInterface(assetAddr, erc20ApproveAbi)
    hooks.addContractInterface(vaultAddr, vaultDepositAbi)

    if (!hasSigned && enableTermsOfUseSignature) {
      hooks.addContractInterface(tosSignerAddress, tosSignerWriteAbi)
    }

    hooks.setMainCallHookCallFromSelf(vaultAddr, 'deposit', [amount, depositToAddr])

    const saHooks = hooks.build()
    const evcCalls = convertSaHooksToEVCCalls(saHooks, userAddr, depositToAddr)

    if (!hasSigned && enableTermsOfUseSignature) {
      const tosCall = {
        targetContract: tosSignerAddress,
        onBehalfOfAccount: userAddr,
        value: 0n,
        data: hooks.getDataForCall(
          tosSignerAddress,
          'signTermsOfUse',
          [tosData.tosMessage, tosData.tosMessageHash],
        ) as Hex,
      }
      evcCalls.unshift(tosCall)
    }

    if (permitCall) {
      evcCalls.unshift(permitCall)
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
    options: { includePythUpdate?: boolean; liabilityVault?: string; enabledCollaterals?: string[] } = {},
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
    const tosData = await getTosData()

    const hooks = new SaHooksBuilder()

    hooks.addContractInterface(vaultAddr, vaultWithdrawAbi)

    if (!hasSigned && enableTermsOfUseSignature) {
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

    if (!hasSigned && enableTermsOfUseSignature) {
      const tosCall = {
        targetContract: tosSignerAddress,
        onBehalfOfAccount: userAddr,
        value: 0n,
        data: hooks.getDataForCall(tosSignerAddress, 'signTermsOfUse', [tosData.tosMessage, tosData.tosMessageHash]) as Hash,
      }
      evcCalls.unshift(tosCall)
    }

    if (options.includePythUpdate) {
      const liabilityAddr = options.liabilityVault || vaultAddr
      const effectiveCollaterals = resolveEffectiveCollaterals(options.enabledCollaterals)
      const { calls: pythCalls } = await preparePythUpdatesForHealthCheck(liabilityAddr, effectiveCollaterals, userAddr)
      if (pythCalls.length) {
        evcCalls.unshift(...pythCalls as EVCCall[])
      }
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
    subAccount?: string,
  ): Promise<TxPlan> => {
    if (!address.value || !eulerCoreAddresses.value || !eulerPeripheryAddresses.value) {
      throw new Error('Wallet not connected or addresses not available')
    }

    const vaultAddr = vaultAddress as Address
    const userAddr = address.value as Address
    const evcAddress = eulerCoreAddresses.value.evc as Address
    const tosSignerAddress = eulerPeripheryAddresses.value.termsOfUseSigner as Address
    const redeemFromAddr = subAccount ? (subAccount as Address) : userAddr

    const hasSigned = await hasSignature(userAddr)
    const tosData = await getTosData()

    let sharesAmount = isMax
      ? maxSharesAmount || 0n
      : await rpcProvider.readContract({
        address: vaultAddr,
        abi: vaultPreviewWithdrawAbi,
        functionName: 'previewWithdraw',
        args: [assetsAmount],
      }).catch(() => 0n) as bigint

    if (isMax === false && maxSharesAmount && (sharesAmount > maxSharesAmount)) {
      sharesAmount = maxSharesAmount
    }

    const hooks = new SaHooksBuilder()

    hooks.addContractInterface(vaultAddr, vaultRedeemAbi)

    if (!hasSigned && enableTermsOfUseSignature) {
      hooks.addContractInterface(tosSignerAddress, tosSignerWriteAbi)
    }

    if (subAccount) {
      hooks.setMainCallHookCallFromSA(vaultAddr, 'redeem', [sharesAmount, userAddr, redeemFromAddr])
    }
    else {
      hooks.setMainCallHookCallFromSelf(vaultAddr, 'redeem', [sharesAmount, userAddr, redeemFromAddr])
    }

    const saHooks = hooks.build()
    const evcCalls = convertSaHooksToEVCCalls(saHooks, userAddr, redeemFromAddr)

    if (!hasSigned && enableTermsOfUseSignature) {
      const tosCall = {
        targetContract: tosSignerAddress,
        onBehalfOfAccount: userAddr,
        value: 0n,
        data: hooks.getDataForCall(tosSignerAddress, 'signTermsOfUse', [tosData.tosMessage, tosData.tosMessageHash]) as Hash,
      }
      evcCalls.unshift(tosCall)
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
    options: { includePermit2Call?: boolean; enabledCollaterals?: string[] } = {},
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
    const permit2Address = resolvePermit2Address()

    const subAccountAddr = subAccount || await getNewSubAccount(address.value)

    const hasSigned = await hasSignature(userAddr)
    const tosData = await getTosData()

    const steps: TxStep[] = []

    let permitCall: EVCCall | undefined
    let usesPermit2 = false

    if (amount > 0n) {
      const allowance = await checkAllowance(assetAddr, vaultAddr, userAddr)
      const includePermit2Call = options.includePermit2Call ?? true
      const canUsePermit2 = !!chainId.value && !!permit2Address && permit2Enabled.value
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

        if (includePermit2Call) {
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
          args: [vaultAddr, amount] as const,
          value: 0n,
        })
      }
    }

    const hooks = new SaHooksBuilder()

    hooks.addContractInterface(vaultAddr, vaultDepositAbi)
    hooks.addContractInterface(borrowVaultAddr, vaultBorrowAbi)
    hooks.addContractInterface(evcAddress, [...evcEnableControllerAbi, ...evcEnableCollateralAbi])

    if (!hasSigned && enableTermsOfUseSignature) {
      hooks.addContractInterface(tosSignerAddress, tosSignerWriteAbi)
    }

    const saHooks = hooks.build()
    const evcCalls = convertSaHooksToEVCCalls(saHooks, userAddr, userAddr)

    if (!hasSigned && enableTermsOfUseSignature) {
      const tosCall = {
        targetContract: tosSignerAddress,
        onBehalfOfAccount: userAddr,
        value: 0n,
        data: hooks.getDataForCall(tosSignerAddress, 'signTermsOfUse', [tosData.tosMessage, tosData.tosMessageHash]) as Hash,
      }
      evcCalls.unshift(tosCall)
    }

    if (permitCall) {
      evcCalls.unshift(permitCall)
    }

    const cleanupCalls = await buildCollateralCleanupCalls({
      evcAddress,
      accountLensAddress: eulerLensAddresses.value!.accountLens as Address,
      subAccount: subAccountAddr as Address,
      providerUrl: EVM_PROVIDER_URL,
      subgraphUrl: SUBGRAPH_URL,
    })
    if (cleanupCalls.length) {
      evcCalls.push(...cleanupCalls)
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

    const effectiveCollaterals = resolveEffectiveCollaterals(options.enabledCollaterals, [vaultAddr])
    const { calls: pythCalls } = await preparePythUpdatesForHealthCheck(borrowVaultAddr, effectiveCollaterals, userAddr)
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
    enabledCollaterals?: string[],
    savingsSubAccount?: string,
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

    const isSavingsAtSubAccount = savingsSubAccount
      && getAddress(savingsSubAccount) !== getAddress(userAddr)

    const hasSigned = await hasSignature(userAddr)
    const tosData = await getTosData()

    const hooks = new SaHooksBuilder()

    hooks.addContractInterface(vaultAddr, erc20TransferAbi)
    hooks.addContractInterface(borrowVaultAddr, vaultBorrowAbi)
    hooks.addContractInterface(evcAddress, [...evcEnableCollateralAbi, ...evcEnableControllerAbi])

    if (!hasSigned && enableTermsOfUseSignature) {
      hooks.addContractInterface(tosSignerAddress, tosSignerWriteAbi)
    }

    if (!isSavingsAtSubAccount) {
      hooks.addPreHookCallFromSelf(vaultAddr, 'transfer', [subAccountAddr, amount])
    }

    const saHooks = hooks.build()
    const evcCalls = convertSaHooksToEVCCalls(saHooks, userAddr, userAddr)

    if (!hasSigned && enableTermsOfUseSignature) {
      const tosCall = {
        targetContract: tosSignerAddress,
        onBehalfOfAccount: userAddr,
        value: 0n,
        data: hooks.getDataForCall(tosSignerAddress, 'signTermsOfUse', [tosData.tosMessage, tosData.tosMessageHash]) as Hash,
      }
      evcCalls.unshift(tosCall)
    }

    if (isSavingsAtSubAccount) {
      const transferCall: EVCCall = {
        targetContract: vaultAddr,
        onBehalfOfAccount: getAddress(savingsSubAccount!) as Address,
        value: 0n,
        data: hooks.getDataForCall(vaultAddr, 'transfer', [subAccountAddr, amount]) as Hash,
      }
      evcCalls.push(transferCall)
    }

    const cleanupCalls = await buildCollateralCleanupCalls({
      evcAddress,
      accountLensAddress: eulerLensAddresses.value!.accountLens as Address,
      subAccount: subAccountAddr as Address,
      providerUrl: EVM_PROVIDER_URL,
      subgraphUrl: SUBGRAPH_URL,
    })
    if (cleanupCalls.length) {
      evcCalls.push(...cleanupCalls)
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

    const effectiveCollaterals = resolveEffectiveCollaterals(enabledCollaterals, [vaultAddr])
    const { calls: pythCalls } = await preparePythUpdatesForHealthCheck(borrowVaultAddr, effectiveCollaterals, userAddr)
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
    enabledCollaterals,
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
    enabledCollaterals?: string[]
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
    const supplyPermit2Address = resolvePermit2Address()
    const longPermit2Address = resolvePermit2Address()

    const subAccountAddr = subAccount || await getNewSubAccount(address.value)
    const hasSigned = await hasSignature(userAddr)
    const tosData = await getTosData()
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
      const canUsePermit2 = !!chainId.value && !!permit2Addr && permit2Enabled.value
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

        if (includePermit2Call) {
          permitCall = await buildPermit2Call(assetAddr, vaultAddr, amount, userAddr, permit2Addr)
        }
      }
      else if (allowance < amount) {
        steps.push({
          type: 'approve',
          label: 'Approve asset for vault',
          to: assetAddr,
          abi: erc20ABI as Abi,
          functionName: 'approve',
          args: [vaultAddr, amount] as const,
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

    if (!hasSigned && enableTermsOfUseSignature) {
      hooks.addContractInterface(tosSignerAddress, tosSignerWriteAbi)
    }

    const saHooks = hooks.build()
    const evcCalls = convertSaHooksToEVCCalls(saHooks, userAddr, userAddr)

    if (!hasSigned && enableTermsOfUseSignature) {
      const tosCall = {
        targetContract: tosSignerAddress,
        onBehalfOfAccount: userAddr,
        value: 0n,
        data: hooks.getDataForCall(tosSignerAddress, 'signTermsOfUse', [tosData.tosMessage, tosData.tosMessageHash]) as Hash,
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

    const cleanupCalls = await buildCollateralCleanupCalls({
      evcAddress,
      accountLensAddress: eulerLensAddresses.value!.accountLens as Address,
      subAccount: subAccountAddr as Address,
      providerUrl: EVM_PROVIDER_URL,
      subgraphUrl: SUBGRAPH_URL,
    })
    if (cleanupCalls.length) {
      evcCalls.push(...cleanupCalls)
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
        logWarn('multiply', 'SwapVerifier data mismatch')
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

    const addingCollaterals = isSameVault ? [supplyVaultAddr] : [supplyVaultAddr, longVaultAddr]
    const effectiveCollaterals = resolveEffectiveCollaterals(enabledCollaterals, addingCollaterals)
    const { calls: pythCalls } = await preparePythUpdatesForHealthCheck(borrowVaultAddr, effectiveCollaterals, userAddr)
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
    const permit2Address = resolvePermit2Address()

    const hasSigned = await hasSignature(userAddr)
    const tosData = await getTosData()

    const steps: TxStep[] = []
    const allowance = await checkAllowance(borrowAssetAddr, borrowVaultAddr, userAddr)
    const includePermit2Call = options.includePermit2Call ?? true
    const canUsePermit2 = !!chainId.value && !!permit2Address && permit2Enabled.value
    let permitCall: EVCCall | undefined
    const adjustedAmount = adjustForInterest(amount)
    const usesPermit2 = canUsePermit2 && allowance < amount

    if (usesPermit2 && permit2Address) {
      const permit2Allowance = await checkAllowance(borrowAssetAddr, permit2Address, userAddr)
      const needsPermit2Approval = permit2Allowance < adjustedAmount
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

      if (includePermit2Call) {
        permitCall = await buildPermit2Call(borrowAssetAddr, borrowVaultAddr, adjustedAmount, userAddr, permit2Address)
      }
    }
    else if (allowance < amount) {
      steps.push({
        type: 'approve',
        label: 'Approve asset for vault',
        to: borrowAssetAddr,
        abi: erc20ABI as Abi,
        functionName: 'approve',
        args: [borrowVaultAddr, adjustForInterest(amount)] as const,
        value: 0n,
      })
    }

    const hooks = new SaHooksBuilder()

    hooks.addContractInterface(borrowVaultAddr, vaultRepayAbi)

    if (!hasSigned && enableTermsOfUseSignature) {
      hooks.addContractInterface(tosSignerAddress, tosSignerWriteAbi)
    }

    hooks.setMainCallHookCallFromSelf(borrowVaultAddr, 'repay', [amount, subAccountAddr])

    const saHooks = hooks.build()
    const evcCalls = convertSaHooksToEVCCalls(saHooks, userAddr, subAccountAddr)

    if (!hasSigned && enableTermsOfUseSignature) {
      const tosCall = {
        targetContract: tosSignerAddress,
        onBehalfOfAccount: userAddr,
        value: 0n,
        data: hooks.getDataForCall(tosSignerAddress, 'signTermsOfUse', [tosData.tosMessage, tosData.tosMessageHash]) as Hash,
      }
      evcCalls.unshift(tosCall)
    }

    if (permitCall) {
      evcCalls.unshift(permitCall)
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

  // Pyth oracle updates are intentionally omitted: the batch ends with disableController
  // which removes the controller vault. With no active controller at batch end, the EVC
  // skips account health checks, so oracle prices are not needed.
  const buildFullRepayPlan = async (
    borrowVaultAddress: string,
    borrowAssetAddress: string,
    amount: bigint,
    subAccount: string,
    collateralAddresses: string[],
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
    const permit2Address = resolvePermit2Address()

    const hasSigned = await hasSignature(userAddr)
    const tosData = await getTosData()
    const allowance = await checkAllowance(borrowAssetAddr, borrowVaultAddr, userAddr)
    const includePermit2Call = options.includePermit2Call ?? true
    const canUsePermit2 = !!chainId.value && !!permit2Address && permit2Enabled.value
    let permitCall: EVCCall | undefined
    const usesPermit2 = canUsePermit2 && allowance < amount

    const steps: TxStep[] = []
    const adjustedAmount = adjustForInterest(amount)
    if (usesPermit2 && permit2Address) {
      const permit2Allowance = await checkAllowance(borrowAssetAddr, permit2Address, userAddr)
      const needsPermit2Approval = permit2Allowance < adjustedAmount
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

      if (includePermit2Call) {
        permitCall = await buildPermit2Call(borrowAssetAddr, borrowVaultAddr, adjustedAmount, userAddr, permit2Address)
      }
    }
    else if (allowance < amount) {
      steps.push({
        type: 'approve',
        label: 'Approve asset for vault',
        to: borrowAssetAddr,
        abi: erc20ABI as Abi,
        functionName: 'approve',
        args: [borrowVaultAddr, adjustForInterest(amount)] as const,
        value: 0n,
      })
    }

    const collateralAddrs = collateralAddresses.map(addr => addr as Address)

    const hooks = new SaHooksBuilder()

    hooks.addContractInterface(borrowVaultAddr, [...vaultRepayAbi, ...evcDisableControllerAbi])
    hooks.addContractInterface(evcAddress, evcDisableCollateralAbi)

    for (const collateralAddr of collateralAddrs) {
      hooks.addContractInterface(collateralAddr, vaultTransferFromMaxAbi)
    }

    if (!hasSigned && enableTermsOfUseSignature) {
      hooks.addContractInterface(tosSignerAddress, tosSignerWriteAbi)
    }

    const evcCalls = []

    if (!hasSigned && enableTermsOfUseSignature) {
      const tosCall = {
        targetContract: tosSignerAddress,
        onBehalfOfAccount: userAddr,
        value: 0n,
        data: hooks.getDataForCall(tosSignerAddress, 'signTermsOfUse', [tosData.tosMessage, tosData.tosMessageHash]) as Hash,
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

    evcCalls.push(repayCall, disableControllerCall)

    const isMainAccount = subAccountAddr.toLowerCase() === userAddr.toLowerCase()

    for (const collateralAddr of collateralAddrs) {
      const disableCollateralCall = {
        targetContract: evcAddress,
        onBehalfOfAccount: '0x0000000000000000000000000000000000000000' as Address,
        value: 0n,
        data: hooks.getDataForCall(evcAddress, 'disableCollateral', [subAccountAddr, collateralAddr]) as Hash,
      }
      evcCalls.push(disableCollateralCall)

      if (!isMainAccount) {
        const transferCall = {
          targetContract: collateralAddr,
          onBehalfOfAccount: subAccountAddr,
          value: 0n,
          data: hooks.getDataForCall(collateralAddr, 'transferFromMax', [subAccountAddr, userAddr]) as Hash,
        }
        evcCalls.push(transferCall)
      }
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
    disableCollateral,
    liabilityVault,
    enabledCollaterals,
    isDebtSwap = false,
  }: {
    quote: SwapApiQuote
    swapperMode?: SwapperMode
    isRepay?: boolean
    targetDebt?: bigint
    currentDebt?: bigint
    enableCollateral?: boolean
    disableCollateral?: string
    liabilityVault?: string
    enabledCollaterals?: string[]
    isDebtSwap?: boolean
  }): Promise<TxPlan> => {
    const { evcCalls, evcAddress, totalValue } = await buildSwapEvcCalls({
      quote,
      swapperMode,
      isRepay,
      targetDebt,
      currentDebt,
      enableCollateral,
      disableCollateral,
      liabilityVault,
      enabledCollaterals,
      isDebtSwap,
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

  const buildSameAssetSwapPlan = async ({
    fromVaultAddress,
    toVaultAddress,
    amount,
    isMax = false,
    maxShares,
    subAccount,
    enableCollateral = false,
    disableCollateral = false,
    liabilityVault,
    enabledCollaterals,
  }: {
    fromVaultAddress: string
    toVaultAddress: string
    amount: bigint
    isMax?: boolean
    maxShares?: bigint
    subAccount?: string
    enableCollateral?: boolean
    disableCollateral?: boolean
    liabilityVault?: string
    enabledCollaterals?: string[]
  }): Promise<TxPlan> => {
    if (!address.value || !eulerCoreAddresses.value || !eulerPeripheryAddresses.value) {
      throw new Error('Wallet not connected or addresses not available')
    }

    const fromVaultAddr = fromVaultAddress as Address
    const toVaultAddr = toVaultAddress as Address
    const userAddr = address.value as Address
    const evcAddress = eulerCoreAddresses.value.evc as Address
    const tosSignerAddress = eulerPeripheryAddresses.value.termsOfUseSigner as Address
    const accountAddr = subAccount ? (subAccount as Address) : userAddr

    const hasSigned = await hasSignature(userAddr)
    const tosData = await getTosData()

    const hooks = new SaHooksBuilder()
    if (isMax) {
      hooks.addContractInterface(fromVaultAddr, vaultRedeemAbi)
    }
    else {
      hooks.addContractInterface(fromVaultAddr, vaultWithdrawAbi)
    }
    hooks.addContractInterface(toVaultAddr, vaultSkimAbi)

    const evcAbis = [
      ...(enableCollateral ? evcEnableCollateralAbi : []),
      ...(disableCollateral ? evcDisableCollateralAbi : []),
    ]
    if (evcAbis.length) {
      hooks.addContractInterface(evcAddress, evcAbis)
    }
    if (!hasSigned && enableTermsOfUseSignature) {
      hooks.addContractInterface(tosSignerAddress, tosSignerWriteAbi)
    }

    const evcCalls: EVCCall[] = []

    // Pyth updates for health check (when there's a liability vault)
    if (liabilityVault) {
      const effectiveCollaterals = resolveEffectiveCollaterals(
        enabledCollaterals,
        enableCollateral ? [toVaultAddr] : [],
        disableCollateral ? [fromVaultAddr] : [],
      )
      const { calls: pythCalls } = await preparePythUpdatesForHealthCheck(liabilityVault, effectiveCollaterals, userAddr)
      if (pythCalls.length) {
        evcCalls.push(...pythCalls as EVCCall[])
      }
    }

    // TOS signing
    if (!hasSigned && enableTermsOfUseSignature) {
      evcCalls.push({
        targetContract: tosSignerAddress,
        onBehalfOfAccount: userAddr,
        value: 0n,
        data: hooks.getDataForCall(tosSignerAddress, 'signTermsOfUse', [tosData.tosMessage, tosData.tosMessageHash]) as Hash,
      })
    }

    // Withdraw from old vault (sends underlying to new vault address)
    if (isMax && maxShares !== undefined) {
      evcCalls.push({
        targetContract: fromVaultAddr,
        onBehalfOfAccount: accountAddr,
        value: 0n,
        data: hooks.getDataForCall(fromVaultAddr, 'redeem', [maxShares, toVaultAddr, accountAddr]) as Hash,
      })
    }
    else if (isMax) {
      // Max without explicit shares: use maxUint256 to redeem all
      evcCalls.push({
        targetContract: fromVaultAddr,
        onBehalfOfAccount: accountAddr,
        value: 0n,
        data: hooks.getDataForCall(fromVaultAddr, 'redeem', [maxUint256, toVaultAddr, accountAddr]) as Hash,
      })
    }
    else {
      evcCalls.push({
        targetContract: fromVaultAddr,
        onBehalfOfAccount: accountAddr,
        value: 0n,
        data: hooks.getDataForCall(fromVaultAddr, 'withdraw', [amount, toVaultAddr, accountAddr]) as Hash,
      })
    }

    // Skim on new vault (converts arrived tokens to shares)
    // When isMax, pass 0n since the exact amount from redeem isn't known ahead of time
    // skim(0, receiver) converts all arrived tokens without a minimum check
    evcCalls.push({
      targetContract: toVaultAddr,
      onBehalfOfAccount: accountAddr,
      value: 0n,
      data: hooks.getDataForCall(toVaultAddr, 'skim', [amount, accountAddr]) as Hash,
    })

    // Enable new vault as collateral
    if (enableCollateral) {
      evcCalls.push({
        targetContract: evcAddress,
        onBehalfOfAccount: '0x0000000000000000000000000000000000000000' as Address,
        value: 0n,
        data: hooks.getDataForCall(evcAddress, 'enableCollateral', [accountAddr, toVaultAddr]) as Hash,
      })
    }

    // Disable old vault as collateral (max swap)
    if (disableCollateral) {
      evcCalls.push({
        targetContract: evcAddress,
        onBehalfOfAccount: '0x0000000000000000000000000000000000000000' as Address,
        value: 0n,
        data: hooks.getDataForCall(evcAddress, 'disableCollateral', [accountAddr, fromVaultAddr]) as Hash,
      })
    }

    const totalValue = sumCallValues(evcCalls)

    return {
      kind: 'same-asset-swap',
      steps: [
        {
          type: 'evc-batch',
          label: 'Transfer via EVC',
          to: evcAddress,
          abi: EVC_ABI,
          functionName: 'batch',
          args: [evcCalls as never],
          value: totalValue,
        },
      ],
    }
  }

  const buildSameAssetRepayPlan = async ({
    collateralVaultAddress,
    borrowVaultAddress,
    amount,
    subAccount,
    enabledCollaterals,
  }: {
    collateralVaultAddress: string
    borrowVaultAddress: string
    amount: bigint
    subAccount: string
    enabledCollaterals?: string[]
  }): Promise<TxPlan> => {
    if (!address.value || !eulerCoreAddresses.value || !eulerPeripheryAddresses.value) {
      throw new Error('Wallet not connected or addresses not available')
    }

    const collateralVaultAddr = collateralVaultAddress as Address
    const borrowVaultAddr = borrowVaultAddress as Address
    const userAddr = address.value as Address
    const evcAddress = eulerCoreAddresses.value.evc as Address
    const tosSignerAddress = eulerPeripheryAddresses.value.termsOfUseSigner as Address
    const subAccountAddr = subAccount as Address

    const hasSigned = await hasSignature(userAddr)
    const tosData = await getTosData()

    const hooks = new SaHooksBuilder()
    hooks.addContractInterface(collateralVaultAddr, vaultWithdrawAbi)
    hooks.addContractInterface(borrowVaultAddr, [...vaultSkimAbi, ...vaultRepayWithSharesAbi])
    if (!hasSigned && enableTermsOfUseSignature) {
      hooks.addContractInterface(tosSignerAddress, tosSignerWriteAbi)
    }

    const evcCalls: EVCCall[] = []

    // Pyth updates for health check
    const effectiveCollaterals = resolveEffectiveCollaterals(enabledCollaterals)
    const { calls: pythCalls } = await preparePythUpdatesForHealthCheck(borrowVaultAddress, effectiveCollaterals, userAddr)
    if (pythCalls.length) {
      evcCalls.push(...pythCalls as EVCCall[])
    }

    // TOS signing
    if (!hasSigned && enableTermsOfUseSignature) {
      evcCalls.push({
        targetContract: tosSignerAddress,
        onBehalfOfAccount: userAddr,
        value: 0n,
        data: hooks.getDataForCall(tosSignerAddress, 'signTermsOfUse', [tosData.tosMessage, tosData.tosMessageHash]) as Hash,
      })
    }

    // Withdraw from collateral vault, send underlying to borrow vault
    evcCalls.push({
      targetContract: collateralVaultAddr,
      onBehalfOfAccount: subAccountAddr,
      value: 0n,
      data: hooks.getDataForCall(collateralVaultAddr, 'withdraw', [amount, borrowVaultAddr, subAccountAddr]) as Hash,
    })

    // Skim on borrow vault (converts tokens to shares for subAccount)
    evcCalls.push({
      targetContract: borrowVaultAddr,
      onBehalfOfAccount: subAccountAddr,
      value: 0n,
      data: hooks.getDataForCall(borrowVaultAddr, 'skim', [amount, subAccountAddr]) as Hash,
    })

    // Burn shares to repay debt — use amount - 1n to avoid share rounding mismatch:
    // skim credits toSharesDown(amount) shares, but repayWithShares burns toSharesUp(amount),
    // which can be 1 share more. Reducing by 1 wei keeps it within the skimmed balance.
    evcCalls.push({
      targetContract: borrowVaultAddr,
      onBehalfOfAccount: subAccountAddr,
      value: 0n,
      data: hooks.getDataForCall(borrowVaultAddr, 'repayWithShares', [amount > 0n ? amount - 1n : 0n, subAccountAddr]) as Hash,
    })

    const totalValue = sumCallValues(evcCalls)

    return {
      kind: 'same-asset-repay',
      steps: [
        {
          type: 'evc-batch',
          label: 'Repay with collateral via EVC',
          to: evcAddress,
          abi: EVC_ABI,
          functionName: 'batch',
          args: [evcCalls as never],
          value: totalValue,
        },
      ],
    }
  }

  const buildSameAssetFullRepayPlan = async ({
    collateralVaultAddress,
    borrowVaultAddress,
    amount,
    subAccount,
    enabledCollaterals,
  }: {
    collateralVaultAddress: string
    borrowVaultAddress: string
    amount: bigint
    subAccount: string
    enabledCollaterals?: string[]
  }): Promise<TxPlan> => {
    if (!address.value || !eulerCoreAddresses.value || !eulerPeripheryAddresses.value) {
      throw new Error('Wallet not connected or addresses not available')
    }

    const collateralVaultAddr = collateralVaultAddress as Address
    const borrowVaultAddr = borrowVaultAddress as Address
    const userAddr = address.value as Address
    const evcAddress = eulerCoreAddresses.value.evc as Address
    const tosSignerAddress = eulerPeripheryAddresses.value.termsOfUseSigner as Address
    const subAccountAddr = subAccount as Address

    const hasSigned = await hasSignature(userAddr)
    const tosData = await getTosData()

    // Pre-flight: read pre-existing deposit in borrow vault
    let preExistingBorrowDeposit = 0n
    try {
      const balanceOfResult = await rpcProvider.readContract({
        address: borrowVaultAddr,
        abi: erc20BalanceOfAbi,
        functionName: 'balanceOf',
        args: [subAccountAddr],
      }) as bigint
      if (balanceOfResult > 0n) {
        const assetsResult = await rpcProvider.readContract({
          address: borrowVaultAddr,
          abi: vaultConvertToAssetsAbi,
          functionName: 'convertToAssets',
          args: [balanceOfResult],
        }) as bigint
        preExistingBorrowDeposit = assetsResult
      }
    }
    catch (err) {
      logWarn('buildSameAssetFullRepayPlan', err)
    }

    const hooks = new SaHooksBuilder()
    hooks.addContractInterface(collateralVaultAddr, [...vaultWithdrawAbi, ...vaultSkimAbi, ...vaultTransferFromMaxAbi])
    hooks.addContractInterface(borrowVaultAddr, [...vaultSkimAbi, ...vaultRepayWithSharesAbi, ...evcDisableControllerAbi, ...vaultRedeemAbi])
    hooks.addContractInterface(evcAddress, evcDisableCollateralAbi)
    if (!hasSigned && enableTermsOfUseSignature) {
      hooks.addContractInterface(tosSignerAddress, tosSignerWriteAbi)
    }

    const evcCalls: EVCCall[] = []

    // No Pyth updates needed — batch ends with disableController (no health check)

    // TOS signing
    if (!hasSigned && enableTermsOfUseSignature) {
      evcCalls.push({
        targetContract: tosSignerAddress,
        onBehalfOfAccount: userAddr,
        value: 0n,
        data: hooks.getDataForCall(tosSignerAddress, 'signTermsOfUse', [tosData.tosMessage, tosData.tosMessageHash]) as Hash,
      })
    }

    // 1. Withdraw from collateral vault (slightly more than debt for interest)
    const adjustedAmount = adjustForInterest(amount)
    evcCalls.push({
      targetContract: collateralVaultAddr,
      onBehalfOfAccount: subAccountAddr,
      value: 0n,
      data: hooks.getDataForCall(collateralVaultAddr, 'withdraw', [adjustedAmount, borrowVaultAddr, subAccountAddr]) as Hash,
    })

    // 2. Skim on borrow vault (convert tokens to shares)
    evcCalls.push({
      targetContract: borrowVaultAddr,
      onBehalfOfAccount: subAccountAddr,
      value: 0n,
      data: hooks.getDataForCall(borrowVaultAddr, 'skim', [adjustedAmount, subAccountAddr]) as Hash,
    })

    // 3. Repay ALL debt with shares
    evcCalls.push({
      targetContract: borrowVaultAddr,
      onBehalfOfAccount: subAccountAddr,
      value: 0n,
      data: hooks.getDataForCall(borrowVaultAddr, 'repayWithShares', [maxUint256, subAccountAddr]) as Hash,
    })

    // 4. Disable controller (no more debt)
    evcCalls.push({
      targetContract: borrowVaultAddr,
      onBehalfOfAccount: subAccountAddr,
      value: 0n,
      data: hooks.getDataForCall(borrowVaultAddr, 'disableController', []) as Hash,
    })

    // 5. Disable collateral (safe after disableController — no health check)
    const collateralAddresses = enabledCollaterals || [collateralVaultAddress]
    for (const collateralAddr of collateralAddresses) {
      evcCalls.push({
        targetContract: evcAddress,
        onBehalfOfAccount: '0x0000000000000000000000000000000000000000' as Address,
        value: 0n,
        data: hooks.getDataForCall(evcAddress, 'disableCollateral', [subAccountAddr, collateralAddr as Address]) as Hash,
      })
    }

    // 6. Redeem ALL remaining shares from borrow vault, send tokens to collateral vault
    evcCalls.push({
      targetContract: borrowVaultAddr,
      onBehalfOfAccount: subAccountAddr,
      value: 0n,
      data: hooks.getDataForCall(borrowVaultAddr, 'redeem', [maxUint256, collateralVaultAddr, subAccountAddr]) as Hash,
    })

    // 7. Skim on collateral vault (convert returned tokens back, with safety check)
    evcCalls.push({
      targetContract: collateralVaultAddr,
      onBehalfOfAccount: subAccountAddr,
      value: 0n,
      data: hooks.getDataForCall(collateralVaultAddr, 'skim', [preExistingBorrowDeposit, subAccountAddr]) as Hash,
    })

    // 8. Transfer remaining collateral back to main account
    const isMainAccount = subAccountAddr.toLowerCase() === userAddr.toLowerCase()
    if (!isMainAccount) {
      evcCalls.push({
        targetContract: collateralVaultAddr,
        onBehalfOfAccount: subAccountAddr,
        value: 0n,
        data: hooks.getDataForCall(collateralVaultAddr, 'transferFromMax', [subAccountAddr, userAddr]) as Hash,
      })
    }

    const totalValue = sumCallValues(evcCalls)

    return {
      kind: 'same-asset-full-repay',
      steps: [
        {
          type: 'evc-batch',
          label: 'Full repay with collateral via EVC',
          to: evcAddress,
          abi: EVC_ABI,
          functionName: 'batch',
          args: [evcCalls as never],
          value: totalValue,
        },
      ],
    }
  }

  const buildSameAssetDebtSwapPlan = async ({
    oldVaultAddress,
    newVaultAddress,
    amount,
    subAccount,
    enabledCollaterals,
  }: {
    oldVaultAddress: string
    newVaultAddress: string
    amount: bigint
    subAccount: string
    enabledCollaterals?: string[]
  }): Promise<TxPlan> => {
    if (!address.value || !eulerCoreAddresses.value || !eulerPeripheryAddresses.value) {
      throw new Error('Wallet not connected or addresses not available')
    }

    const oldVaultAddr = oldVaultAddress as Address
    const newVaultAddr = newVaultAddress as Address
    const userAddr = address.value as Address
    const evcAddress = eulerCoreAddresses.value.evc as Address
    const tosSignerAddress = eulerPeripheryAddresses.value.termsOfUseSigner as Address
    const subAccountAddr = subAccount as Address

    const hasSigned = await hasSignature(userAddr)
    const tosData = await getTosData()

    // Pre-flight: read pre-existing deposit in OLD vault
    let preExistingOldVaultDeposit = 0n
    try {
      const balanceOfResult = await rpcProvider.readContract({
        address: oldVaultAddr,
        abi: erc20BalanceOfAbi,
        functionName: 'balanceOf',
        args: [subAccountAddr],
      }) as bigint
      if (balanceOfResult > 0n) {
        const assetsResult = await rpcProvider.readContract({
          address: oldVaultAddr,
          abi: vaultConvertToAssetsAbi,
          functionName: 'convertToAssets',
          args: [balanceOfResult],
        }) as bigint
        preExistingOldVaultDeposit = assetsResult
      }
    }
    catch (err) {
      logWarn('buildSameAssetDebtSwapPlan', err)
    }

    const hooks = new SaHooksBuilder()
    hooks.addContractInterface(newVaultAddr, [...vaultBorrowAbi, ...vaultSkimAbi, ...vaultTransferFromMaxAbi])
    hooks.addContractInterface(oldVaultAddr, [...vaultSkimAbi, ...vaultRepayWithSharesAbi, ...evcDisableControllerAbi, ...vaultRedeemAbi])
    hooks.addContractInterface(evcAddress, evcEnableControllerAbi)
    if (!hasSigned && enableTermsOfUseSignature) {
      hooks.addContractInterface(tosSignerAddress, tosSignerWriteAbi)
    }

    const evcCalls: EVCCall[] = []

    // Pyth updates — batch ends with active debt in new vault, so health check IS needed
    const effectiveCollaterals = resolveEffectiveCollaterals(enabledCollaterals)
    const { calls: pythCalls } = await preparePythUpdatesForHealthCheck(newVaultAddress, effectiveCollaterals, userAddr)
    if (pythCalls.length) {
      evcCalls.push(...pythCalls as EVCCall[])
    }

    // TOS signing
    if (!hasSigned && enableTermsOfUseSignature) {
      evcCalls.push({
        targetContract: tosSignerAddress,
        onBehalfOfAccount: userAddr,
        value: 0n,
        data: hooks.getDataForCall(tosSignerAddress, 'signTermsOfUse', [tosData.tosMessage, tosData.tosMessageHash]) as Hash,
      })
    }

    // 1. Enable new vault as controller
    evcCalls.push({
      targetContract: evcAddress,
      onBehalfOfAccount: '0x0000000000000000000000000000000000000000' as Address,
      value: 0n,
      data: hooks.getDataForCall(evcAddress, 'enableController', [subAccountAddr, newVaultAddr]) as Hash,
    })

    // 2. Borrow from new vault, send tokens to old vault
    const adjustedAmount = adjustForInterest(amount)
    evcCalls.push({
      targetContract: newVaultAddr,
      onBehalfOfAccount: subAccountAddr,
      value: 0n,
      data: hooks.getDataForCall(newVaultAddr, 'borrow', [adjustedAmount, oldVaultAddr]) as Hash,
    })

    // 3. Skim on old vault (convert arrived tokens to shares)
    evcCalls.push({
      targetContract: oldVaultAddr,
      onBehalfOfAccount: subAccountAddr,
      value: 0n,
      data: hooks.getDataForCall(oldVaultAddr, 'skim', [adjustedAmount, subAccountAddr]) as Hash,
    })

    // 4. Repay ALL debt on old vault
    evcCalls.push({
      targetContract: oldVaultAddr,
      onBehalfOfAccount: subAccountAddr,
      value: 0n,
      data: hooks.getDataForCall(oldVaultAddr, 'repayWithShares', [maxUint256, subAccountAddr]) as Hash,
    })

    // 5. Disable controller on old vault (debt fully repaid)
    evcCalls.push({
      targetContract: oldVaultAddr,
      onBehalfOfAccount: subAccountAddr,
      value: 0n,
      data: hooks.getDataForCall(oldVaultAddr, 'disableController', []) as Hash,
    })

    // 6. Redeem ALL remaining shares from old vault, send tokens to new vault
    evcCalls.push({
      targetContract: oldVaultAddr,
      onBehalfOfAccount: subAccountAddr,
      value: 0n,
      data: hooks.getDataForCall(oldVaultAddr, 'redeem', [maxUint256, newVaultAddr, subAccountAddr]) as Hash,
    })

    // 7. Skim on new vault (convert returned tokens to deposit shares)
    evcCalls.push({
      targetContract: newVaultAddr,
      onBehalfOfAccount: subAccountAddr,
      value: 0n,
      data: hooks.getDataForCall(newVaultAddr, 'skim', [preExistingOldVaultDeposit, subAccountAddr]) as Hash,
    })

    // 8. Transfer all new vault shares from sub-account to main account
    const isMainAccount = subAccountAddr.toLowerCase() === userAddr.toLowerCase()
    if (!isMainAccount) {
      evcCalls.push({
        targetContract: newVaultAddr,
        onBehalfOfAccount: subAccountAddr,
        value: 0n,
        data: hooks.getDataForCall(newVaultAddr, 'transferFromMax', [subAccountAddr, userAddr]) as Hash,
      })
    }

    const totalValue = sumCallValues(evcCalls)

    return {
      kind: 'same-asset-debt-swap',
      steps: [
        {
          type: 'evc-batch',
          label: 'Debt swap via EVC',
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
    borrowVaultAddress?: string,
    enabledCollaterals?: string[],
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
    const tosData = await getTosData()

    const hooks = new SaHooksBuilder()

    hooks.addContractInterface(vaultAddr, vaultTransferFromMaxAbi)
    hooks.addContractInterface(evcAddress, evcDisableCollateralAbi)

    if (!hasSigned && enableTermsOfUseSignature) {
      hooks.addContractInterface(tosSignerAddress, tosSignerWriteAbi)
    }

    const evcCalls: EVCCall[] = []

    if (!hasSigned && enableTermsOfUseSignature) {
      const tosCall = {
        targetContract: tosSignerAddress,
        onBehalfOfAccount: userAddr,
        value: 0n,
        data: hooks.getDataForCall(tosSignerAddress, 'signTermsOfUse', [tosData.tosMessage, tosData.tosMessageHash]) as Hash,
      }
      evcCalls.push(tosCall)
    }

    const liabilityAddr = borrowVaultAddress || vaultAddr
    const effectiveCollaterals = resolveEffectiveCollaterals(enabledCollaterals, [], [vaultAddr])
    const { calls: pythCalls } = await preparePythUpdatesForHealthCheck(liabilityAddr, effectiveCollaterals, userAddr)
    if (pythCalls.length) {
      evcCalls.push(...pythCalls as EVCCall[])
    }

    if (subAccountAddr.toLowerCase() !== userAddr.toLowerCase()) {
      const transferCall = {
        targetContract: vaultAddr,
        onBehalfOfAccount: subAccountAddr,
        value: 0n,
        data: hooks.getDataForCall(vaultAddr, 'transferFromMax', [subAccountAddr, userAddr]) as Hash,
      }
      evcCalls.push(transferCall)
    }

    const disableCollateralCall = {
      targetContract: evcAddress,
      onBehalfOfAccount: '0x0000000000000000000000000000000000000000' as Address,
      value: 0n,
      data: hooks.getDataForCall(evcAddress, 'disableCollateral', [subAccountAddr, vaultAddr]) as Hash,
    }
    evcCalls.push(disableCollateralCall)

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

  /**
   * Repay debt using savings from a different sub-account (same underlying asset, partial).
   * Withdraws from the savings vault on savingsSubAccount, skims into borrow vault on borrowSubAccount,
   * then burns shares to repay debt.
   */
  const buildSavingsRepayPlan = async ({
    savingsVaultAddress,
    borrowVaultAddress,
    amount,
    savingsSubAccount,
    borrowSubAccount,
  }: {
    savingsVaultAddress: string
    borrowVaultAddress: string
    amount: bigint
    savingsSubAccount: string
    borrowSubAccount: string
  }): Promise<TxPlan> => {
    if (!address.value || !eulerCoreAddresses.value || !eulerPeripheryAddresses.value) {
      throw new Error('Wallet not connected or addresses not available')
    }

    const savingsVaultAddr = savingsVaultAddress as Address
    const borrowVaultAddr = borrowVaultAddress as Address
    const userAddr = address.value as Address
    const evcAddress = eulerCoreAddresses.value.evc as Address
    const tosSignerAddress = eulerPeripheryAddresses.value.termsOfUseSigner as Address
    const savingsSubAccountAddr = savingsSubAccount as Address
    const borrowSubAccountAddr = borrowSubAccount as Address

    const hasSigned = await hasSignature(userAddr)
    const tosData = await getTosData()

    const sameVault = savingsVaultAddr.toLowerCase() === borrowVaultAddr.toLowerCase()

    const hooks = new SaHooksBuilder()
    if (sameVault) {
      // Same vault: repayWithShares directly burns savings shares to repay borrow debt
      hooks.addContractInterface(savingsVaultAddr, vaultRepayWithSharesAbi)
    }
    else {
      hooks.addContractInterface(savingsVaultAddr, vaultWithdrawAbi)
      hooks.addContractInterface(borrowVaultAddr, [...vaultSkimAbi, ...vaultRepayWithSharesAbi])
    }
    if (!hasSigned && enableTermsOfUseSignature) {
      hooks.addContractInterface(tosSignerAddress, tosSignerWriteAbi)
    }

    const evcCalls: EVCCall[] = []

    // TOS signing
    if (!hasSigned && enableTermsOfUseSignature) {
      evcCalls.push({
        targetContract: tosSignerAddress,
        onBehalfOfAccount: userAddr,
        value: 0n,
        data: hooks.getDataForCall(tosSignerAddress, 'signTermsOfUse', [tosData.tosMessage, tosData.tosMessageHash]) as Hash,
      })
    }

    if (sameVault) {
      // Same vault: burn shares from savings sub-account, repay debt on borrow sub-account.
      // No withdraw/skim needed — avoids vault cash liquidity requirements.
      evcCalls.push({
        targetContract: savingsVaultAddr,
        onBehalfOfAccount: savingsSubAccountAddr,
        value: 0n,
        data: hooks.getDataForCall(savingsVaultAddr, 'repayWithShares', [amount, borrowSubAccountAddr]) as Hash,
      })
    }
    else {
      // Different vaults: withdraw underlying → skim → repayWithShares
      // repayWithShares uses amount - 1n to avoid share rounding mismatch:
      // skim credits toSharesDown(amount) shares, but repayWithShares burns toSharesUp(amount),
      // which can be 1 share more. Reducing by 1 wei keeps it within the skimmed balance.
      evcCalls.push({
        targetContract: savingsVaultAddr,
        onBehalfOfAccount: savingsSubAccountAddr,
        value: 0n,
        data: hooks.getDataForCall(savingsVaultAddr, 'withdraw', [amount, borrowVaultAddr, savingsSubAccountAddr]) as Hash,
      })
      evcCalls.push({
        targetContract: borrowVaultAddr,
        onBehalfOfAccount: borrowSubAccountAddr,
        value: 0n,
        data: hooks.getDataForCall(borrowVaultAddr, 'skim', [amount, borrowSubAccountAddr]) as Hash,
      })
      evcCalls.push({
        targetContract: borrowVaultAddr,
        onBehalfOfAccount: borrowSubAccountAddr,
        value: 0n,
        data: hooks.getDataForCall(borrowVaultAddr, 'repayWithShares', [amount > 0n ? amount - 1n : 0n, borrowSubAccountAddr]) as Hash,
      })
    }

    const totalValue = sumCallValues(evcCalls)

    return {
      kind: 'savings-repay',
      steps: [
        {
          type: 'evc-batch',
          label: 'Repay with savings via EVC',
          to: evcAddress,
          abi: EVC_ABI,
          functionName: 'batch',
          args: [evcCalls as never],
          value: totalValue,
        },
      ],
    }
  }

  /**
   * Full repay using savings from a different sub-account (same underlying asset).
   * Withdraws from savings, repays all debt, disables controller + collateral,
   * returns excess to savings vault, and transfers all positions back to main account.
   */
  const buildSavingsFullRepayPlan = async ({
    savingsVaultAddress,
    borrowVaultAddress,
    amount,
    savingsSubAccount,
    borrowSubAccount,
    enabledCollaterals,
  }: {
    savingsVaultAddress: string
    borrowVaultAddress: string
    amount: bigint
    savingsSubAccount: string
    borrowSubAccount: string
    enabledCollaterals?: string[]
  }): Promise<TxPlan> => {
    if (!address.value || !eulerCoreAddresses.value || !eulerPeripheryAddresses.value) {
      throw new Error('Wallet not connected or addresses not available')
    }

    const savingsVaultAddr = savingsVaultAddress as Address
    const borrowVaultAddr = borrowVaultAddress as Address
    const userAddr = address.value as Address
    const evcAddress = eulerCoreAddresses.value.evc as Address
    const tosSignerAddress = eulerPeripheryAddresses.value.termsOfUseSigner as Address
    const savingsSubAccountAddr = savingsSubAccount as Address
    const borrowSubAccountAddr = borrowSubAccount as Address

    const hasSigned = await hasSignature(userAddr)
    const tosData = await getTosData()

    // Pre-flight: read pre-existing deposit in borrow vault
    let preExistingBorrowDeposit = 0n
    try {
      const balanceOfResult = await rpcProvider.readContract({
        address: borrowVaultAddr,
        abi: erc20BalanceOfAbi,
        functionName: 'balanceOf',
        args: [borrowSubAccountAddr],
      }) as bigint
      if (balanceOfResult > 0n) {
        const assetsResult = await rpcProvider.readContract({
          address: borrowVaultAddr,
          abi: vaultConvertToAssetsAbi,
          functionName: 'convertToAssets',
          args: [balanceOfResult],
        }) as bigint
        preExistingBorrowDeposit = assetsResult
      }
    }
    catch (err) {
      logWarn('buildSavingsFullRepayPlan', err)
    }

    const sameVault = savingsVaultAddr.toLowerCase() === borrowVaultAddr.toLowerCase()
    const collateralAddresses = enabledCollaterals || []

    const hooks = new SaHooksBuilder()
    if (sameVault) {
      hooks.addContractInterface(savingsVaultAddr, [
        ...vaultRepayWithSharesAbi, ...evcDisableControllerAbi, ...vaultTransferFromMaxAbi,
      ])
    }
    else {
      hooks.addContractInterface(savingsVaultAddr, [...vaultWithdrawAbi, ...vaultSkimAbi, ...vaultTransferFromMaxAbi])
      hooks.addContractInterface(borrowVaultAddr, [...vaultSkimAbi, ...vaultRepayWithSharesAbi, ...evcDisableControllerAbi, ...vaultRedeemAbi])
    }
    hooks.addContractInterface(evcAddress, evcDisableCollateralAbi)
    if (!hasSigned && enableTermsOfUseSignature) {
      hooks.addContractInterface(tosSignerAddress, tosSignerWriteAbi)
    }
    for (const collateralAddr of collateralAddresses) {
      hooks.addContractInterface(collateralAddr as Address, vaultTransferFromMaxAbi)
    }

    const evcCalls: EVCCall[] = []

    // No Pyth updates needed — batch ends with disableController (no health check)

    // TOS signing
    if (!hasSigned && enableTermsOfUseSignature) {
      evcCalls.push({
        targetContract: tosSignerAddress,
        onBehalfOfAccount: userAddr,
        value: 0n,
        data: hooks.getDataForCall(tosSignerAddress, 'signTermsOfUse', [tosData.tosMessage, tosData.tosMessageHash]) as Hash,
      })
    }

    if (sameVault) {
      // Same vault: burn shares from savings sub-account to repay all debt on borrow sub-account.
      // No withdraw/skim/redeem needed — avoids vault cash liquidity requirements.
      evcCalls.push({
        targetContract: savingsVaultAddr,
        onBehalfOfAccount: savingsSubAccountAddr,
        value: 0n,
        data: hooks.getDataForCall(savingsVaultAddr, 'repayWithShares', [maxUint256, borrowSubAccountAddr]) as Hash,
      })
    }
    else {
      // Different vaults: withdraw → skim → repayWithShares → redeem excess → skim back
      const adjustedAmount = adjustForInterest(amount)
      evcCalls.push({
        targetContract: savingsVaultAddr,
        onBehalfOfAccount: savingsSubAccountAddr,
        value: 0n,
        data: hooks.getDataForCall(savingsVaultAddr, 'withdraw', [adjustedAmount, borrowVaultAddr, savingsSubAccountAddr]) as Hash,
      })
      evcCalls.push({
        targetContract: borrowVaultAddr,
        onBehalfOfAccount: borrowSubAccountAddr,
        value: 0n,
        data: hooks.getDataForCall(borrowVaultAddr, 'skim', [adjustedAmount, borrowSubAccountAddr]) as Hash,
      })
      evcCalls.push({
        targetContract: borrowVaultAddr,
        onBehalfOfAccount: borrowSubAccountAddr,
        value: 0n,
        data: hooks.getDataForCall(borrowVaultAddr, 'repayWithShares', [maxUint256, borrowSubAccountAddr]) as Hash,
      })
      // Redeem excess shares from borrow vault, return tokens to savings vault
      evcCalls.push({
        targetContract: borrowVaultAddr,
        onBehalfOfAccount: borrowSubAccountAddr,
        value: 0n,
        data: hooks.getDataForCall(borrowVaultAddr, 'redeem', [maxUint256, savingsVaultAddr, borrowSubAccountAddr]) as Hash,
      })
      // Re-deposit returned tokens into savings vault
      evcCalls.push({
        targetContract: savingsVaultAddr,
        onBehalfOfAccount: savingsSubAccountAddr,
        value: 0n,
        data: hooks.getDataForCall(savingsVaultAddr, 'skim', [preExistingBorrowDeposit, savingsSubAccountAddr]) as Hash,
      })
    }

    // Disable controller (no more debt)
    evcCalls.push({
      targetContract: sameVault ? savingsVaultAddr : borrowVaultAddr,
      onBehalfOfAccount: borrowSubAccountAddr,
      value: 0n,
      data: hooks.getDataForCall(sameVault ? savingsVaultAddr : borrowVaultAddr, 'disableController', []) as Hash,
    })

    // Disable collateral (safe after disableController — no health check)
    for (const collateralAddr of collateralAddresses) {
      evcCalls.push({
        targetContract: evcAddress,
        onBehalfOfAccount: '0x0000000000000000000000000000000000000000' as Address,
        value: 0n,
        data: hooks.getDataForCall(evcAddress, 'disableCollateral', [borrowSubAccountAddr, collateralAddr as Address]) as Hash,
      })
    }

    // Transfer collateral shares from borrow sub-account to main account
    const isMainAccount = borrowSubAccountAddr.toLowerCase() === userAddr.toLowerCase()
    if (!isMainAccount) {
      for (const collateralAddr of collateralAddresses) {
        evcCalls.push({
          targetContract: collateralAddr as Address,
          onBehalfOfAccount: borrowSubAccountAddr,
          value: 0n,
          data: hooks.getDataForCall(collateralAddr as Address, 'transferFromMax', [borrowSubAccountAddr, userAddr]) as Hash,
        })
      }
    }

    // Transfer remaining savings shares to main account
    const isSavingsMainAccount = savingsSubAccountAddr.toLowerCase() === userAddr.toLowerCase()
    if (!isSavingsMainAccount) {
      evcCalls.push({
        targetContract: savingsVaultAddr,
        onBehalfOfAccount: savingsSubAccountAddr,
        value: 0n,
        data: hooks.getDataForCall(savingsVaultAddr, 'transferFromMax', [savingsSubAccountAddr, userAddr]) as Hash,
      })
    }

    const totalValue = sumCallValues(evcCalls)

    return {
      kind: 'savings-full-repay',
      steps: [
        {
          type: 'evc-batch',
          label: 'Full repay with savings via EVC',
          to: evcAddress,
          abi: EVC_ABI,
          functionName: 'batch',
          args: [evcCalls as never],
          value: totalValue,
        },
      ],
    }
  }

  /**
   * Full repay using a cross-asset swap (from collateral or savings).
   * Builds the swap EVC calls, then appends position cleanup:
   * disableController, disableCollateral, transferFromMax for each collateral.
   *
   * For collateral swaps, the sub-account is quote.accountIn (source of collateral).
   * For savings swaps, the sub-account is quote.accountOut (borrow sub-account).
   */
  const buildSwapFullRepayPlan = async ({
    quote,
    swapperMode = SwapperMode.EXACT_IN,
    targetDebt = 0n,
    currentDebt = 0n,
    liabilityVault,
    enabledCollaterals,
    source,
  }: {
    quote: SwapApiQuote
    swapperMode?: SwapperMode
    targetDebt?: bigint
    currentDebt?: bigint
    liabilityVault?: string
    enabledCollaterals?: string[]
    source: 'collateral' | 'savings'
  }): Promise<TxPlan> => {
    if (!address.value || !eulerCoreAddresses.value) {
      throw new Error('Wallet not connected or addresses not available')
    }

    const userAddr = address.value as Address
    const evcAddress = eulerCoreAddresses.value.evc as Address
    const subAccountAddr = (source === 'collateral' ? quote.accountIn : quote.accountOut) as Address

    const { evcCalls } = await buildSwapEvcCalls({
      quote,
      swapperMode,
      isRepay: true,
      targetDebt,
      currentDebt,
      liabilityVault,
      enabledCollaterals,
    })

    // Append position cleanup calls
    const hooks = new SaHooksBuilder()
    const borrowVaultAddr = quote.receiver as Address
    hooks.addContractInterface(borrowVaultAddr, evcDisableControllerAbi)
    hooks.addContractInterface(evcAddress, evcDisableCollateralAbi)

    const collateralAddresses = enabledCollaterals || []
    for (const collateralAddr of collateralAddresses) {
      hooks.addContractInterface(collateralAddr as Address, vaultTransferFromMaxAbi)
    }

    // Disable controller (debt is fully repaid)
    evcCalls.push({
      targetContract: borrowVaultAddr,
      onBehalfOfAccount: subAccountAddr,
      value: 0n,
      data: hooks.getDataForCall(borrowVaultAddr, 'disableController', []) as Hash,
    })

    // Disable collateral
    for (const collateralAddr of collateralAddresses) {
      evcCalls.push({
        targetContract: evcAddress,
        onBehalfOfAccount: '0x0000000000000000000000000000000000000000' as Address,
        value: 0n,
        data: hooks.getDataForCall(evcAddress, 'disableCollateral', [subAccountAddr, collateralAddr as Address]) as Hash,
      })
    }

    // Transfer collateral shares to main account
    const isMainAccount = subAccountAddr.toLowerCase() === userAddr.toLowerCase()
    if (!isMainAccount) {
      for (const collateralAddr of collateralAddresses) {
        evcCalls.push({
          targetContract: collateralAddr as Address,
          onBehalfOfAccount: subAccountAddr,
          value: 0n,
          data: hooks.getDataForCall(collateralAddr as Address, 'transferFromMax', [subAccountAddr, userAddr]) as Hash,
        })
      }
    }

    const totalValue = sumCallValues(evcCalls)

    const label = source === 'collateral'
      ? 'Full repay with collateral swap via EVC'
      : 'Full repay with savings swap via EVC'

    return {
      kind: `swap-${source}-full-repay`,
      steps: [
        {
          type: 'evc-batch',
          label,
          to: evcAddress,
          abi: EVC_ABI,
          functionName: 'batch',
          args: [evcCalls as never],
          value: totalValue,
        },
      ],
    }
  }

  /**
   * Swap an arbitrary token from the user's wallet and deposit the output into a vault.
   * On-chain flow:
   *   1. [Pre-step] User approves SwapVerifier to spend inputToken
   *   2. [EVC Batch]:
   *      a. (ToS signature)
   *      b. SwapVerifier.transferFromSender(inputToken, amount, swapperAddress)
   *      c. Swapper.multicall([...swap calls])
   *      d. SwapVerifier.verify (from API quote.verify)
   */
  const buildSwapAndSupplyPlan = async ({
    inputTokenAddress,
    inputAmount,
    quote,
    includePermit2Call = true,
  }: {
    inputTokenAddress: Address
    inputAmount: bigint
    quote: SwapApiQuote
    includePermit2Call?: boolean
  }): Promise<TxPlan> => {
    if (!address.value || !eulerCoreAddresses.value || !eulerPeripheryAddresses.value) {
      throw new Error('Wallet not connected or addresses not available')
    }

    const userAddr = address.value as Address
    const evcAddress = eulerCoreAddresses.value.evc as Address
    const tosSignerAddress = eulerPeripheryAddresses.value.termsOfUseSigner as Address
    const swapVerifierAddress = eulerPeripheryAddresses.value.swapVerifier as Address

    const hasSigned = await hasSignature(userAddr)
    const tosData = await getTosData()
    const allowance = await checkAllowance(inputTokenAddress, swapVerifierAddress, userAddr)
    const permit2Address = resolvePermit2Address()
    const canUsePermit2 = !!chainId.value && !!permit2Address && permit2Enabled.value

    const steps: TxStep[] = []

    let permitCall: EVCCall | undefined
    const usesPermit2 = canUsePermit2 && allowance < inputAmount

    if (usesPermit2 && permit2Address) {
      const permit2Allowance = await checkAllowance(inputTokenAddress, permit2Address, userAddr)
      const needsPermit2Approval = permit2Allowance < inputAmount
      if (needsPermit2Approval) {
        steps.push({
          type: 'permit2-approve',
          label: 'Approve token for Permit2',
          to: inputTokenAddress,
          abi: erc20ABI as Abi,
          functionName: 'approve',
          args: [permit2Address, maxUint256] as const,
          value: 0n,
        })
      }

      if (includePermit2Call) {
        permitCall = await buildPermit2Call(inputTokenAddress, swapVerifierAddress, inputAmount, userAddr, permit2Address)
      }
    }
    else if (allowance < inputAmount) {
      steps.push({
        type: 'approve',
        label: 'Approve asset for swap',
        to: inputTokenAddress,
        abi: erc20ABI as Abi,
        functionName: 'approve',
        args: [swapVerifierAddress, inputAmount] as const,
        value: 0n,
      })
    }

    const hooks = new SaHooksBuilder()
    hooks.addContractInterface(swapVerifierAddress, [...transferFromSenderAbi, ...swapVerifierAbi])
    hooks.addContractInterface(quote.swap.swapperAddress, swapperAbi)

    if (!hasSigned && enableTermsOfUseSignature) {
      hooks.addContractInterface(tosSignerAddress, tosSignerWriteAbi)
    }

    const evcCalls: EVCCall[] = []

    // Permit2 call (if available)
    if (permitCall) {
      evcCalls.push(permitCall)
    }

    // ToS signature
    if (!hasSigned && enableTermsOfUseSignature) {
      evcCalls.push({
        targetContract: tosSignerAddress,
        onBehalfOfAccount: userAddr,
        value: 0n,
        data: hooks.getDataForCall(tosSignerAddress, 'signTermsOfUse', [tosData.tosMessage, tosData.tosMessageHash]) as Hash,
      })
    }

    // transferFromSender: pull tokens from wallet to swapper
    evcCalls.push({
      targetContract: swapVerifierAddress,
      onBehalfOfAccount: userAddr,
      value: 0n,
      data: hooks.getDataForCall(swapVerifierAddress, 'transferFromSender', [inputTokenAddress, inputAmount, quote.swap.swapperAddress]) as Hash,
    })

    // Swapper multicall
    evcCalls.push({
      targetContract: quote.swap.swapperAddress,
      onBehalfOfAccount: userAddr,
      value: 0n,
      data: encodeFunctionData({
        abi: swapperAbi,
        functionName: 'multicall',
        args: [quote.swap.multicallItems.map(item => item.data)],
      }),
    })

    // Verify min output and skim (deposit) into vault — use API-provided verify data
    evcCalls.push({
      targetContract: quote.verify.verifierAddress,
      onBehalfOfAccount: quote.verify.account,
      value: 0n,
      data: quote.verify.verifierData,
    })

    const totalValue = sumCallValues(evcCalls)

    steps.push({
      type: 'evc-batch',
      label: usesPermit2 ? 'Permit2 swap & supply via EVC' : 'Swap & supply via EVC',
      to: evcAddress,
      abi: EVC_ABI,
      functionName: 'batch',
      args: [evcCalls as never],
      value: totalValue,
    })

    return {
      kind: 'swap-supply',
      steps,
    }
  }

  /**
   * Swap an arbitrary token from the user's wallet to the collateral vault's underlying,
   * deposit as collateral, enable controller + collateral, and borrow.
   * On-chain flow:
   *   1. [Pre-step] User approves SwapVerifier (or Permit2) to spend inputToken
   *   2. [EVC Batch]:
   *      a. Pyth price updates (borrow triggers health check)
   *      a'. (Permit2 permit, if using Permit2)
   *      b. (ToS signature)
   *      c. SwapVerifier.transferFromSender(inputToken, amount, swapperAddress)
   *      d. Swapper.multicall([swap calls, output to collateral vault])
   *      e. SwapVerifier.verify (from API quote.verify)
   *      f. EVC.enableController(subAccount, borrowVault)
   *      g. EVC.enableCollateral(subAccount, collateralVault)
   *      h. borrowVault.borrow(borrowAmount, userAddress)
   */
  const buildSwapAndBorrowPlan = async ({
    inputTokenAddress,
    inputAmount,
    collateralVaultAddress,
    borrowVaultAddress,
    borrowAmount: borrowAmountParam,
    swapQuote,
    subAccount,
    enabledCollaterals,
    includePermit2Call = true,
  }: {
    inputTokenAddress: Address
    inputAmount: bigint
    collateralVaultAddress: Address
    borrowVaultAddress: Address
    borrowAmount: bigint
    swapQuote: SwapApiQuote
    subAccount?: string
    enabledCollaterals?: string[]
    includePermit2Call?: boolean
  }): Promise<TxPlan> => {
    if (!address.value || !eulerCoreAddresses.value || !eulerPeripheryAddresses.value) {
      throw new Error('Wallet not connected or addresses not available')
    }

    const userAddr = address.value as Address
    const evcAddress = eulerCoreAddresses.value.evc as Address
    const tosSignerAddress = eulerPeripheryAddresses.value.termsOfUseSigner as Address
    const swapVerifierAddress = eulerPeripheryAddresses.value.swapVerifier as Address

    const subAccountAddr = (subAccount || await getNewSubAccount(address.value)) as Address

    const hasSigned = await hasSignature(userAddr)
    const tosData = await getTosData()
    const allowance = await checkAllowance(inputTokenAddress, swapVerifierAddress, userAddr)
    const permit2Address = resolvePermit2Address()
    const canUsePermit2 = !!chainId.value && !!permit2Address && permit2Enabled.value

    const steps: TxStep[] = []

    let permitCall: EVCCall | undefined
    const usesPermit2 = canUsePermit2 && allowance < inputAmount

    if (usesPermit2 && permit2Address) {
      const permit2Allowance = await checkAllowance(inputTokenAddress, permit2Address, userAddr)
      const needsPermit2Approval = permit2Allowance < inputAmount
      if (needsPermit2Approval) {
        steps.push({
          type: 'permit2-approve',
          label: 'Approve token for Permit2',
          to: inputTokenAddress,
          abi: erc20ABI as Abi,
          functionName: 'approve',
          args: [permit2Address, maxUint256] as const,
          value: 0n,
        })
      }

      if (includePermit2Call) {
        permitCall = await buildPermit2Call(inputTokenAddress, swapVerifierAddress, inputAmount, userAddr, permit2Address)
      }
    }
    else if (allowance < inputAmount) {
      steps.push({
        type: 'approve',
        label: 'Approve asset for swap',
        to: inputTokenAddress,
        abi: erc20ABI as Abi,
        functionName: 'approve',
        args: [swapVerifierAddress, inputAmount] as const,
        value: 0n,
      })
    }

    const hooks = new SaHooksBuilder()
    hooks.addContractInterface(swapVerifierAddress, [...transferFromSenderAbi, ...swapVerifierAbi])
    hooks.addContractInterface(swapQuote.swap.swapperAddress, swapperAbi)
    hooks.addContractInterface(evcAddress, [...evcEnableControllerAbi, ...evcEnableCollateralAbi])
    hooks.addContractInterface(borrowVaultAddress, vaultBorrowAbi)

    if (!hasSigned && enableTermsOfUseSignature) {
      hooks.addContractInterface(tosSignerAddress, tosSignerWriteAbi)
    }

    const evcCalls: EVCCall[] = []

    // Permit2 call (if available)
    if (permitCall) {
      evcCalls.push(permitCall)
    }

    // ToS signature
    if (!hasSigned && enableTermsOfUseSignature) {
      evcCalls.push({
        targetContract: tosSignerAddress,
        onBehalfOfAccount: userAddr,
        value: 0n,
        data: hooks.getDataForCall(tosSignerAddress, 'signTermsOfUse', [tosData.tosMessage, tosData.tosMessageHash]) as Hash,
      })
    }

    // transferFromSender: pull tokens from wallet to swapper
    evcCalls.push({
      targetContract: swapVerifierAddress,
      onBehalfOfAccount: userAddr,
      value: 0n,
      data: hooks.getDataForCall(swapVerifierAddress, 'transferFromSender', [inputTokenAddress, inputAmount, swapQuote.swap.swapperAddress]) as Hash,
    })

    // Swapper multicall
    evcCalls.push({
      targetContract: swapQuote.swap.swapperAddress,
      onBehalfOfAccount: userAddr,
      value: 0n,
      data: encodeFunctionData({
        abi: swapperAbi,
        functionName: 'multicall',
        args: [swapQuote.swap.multicallItems.map(item => item.data)],
      }),
    })

    // Verify min output and skim (deposit) into collateral vault — use API-provided verify data
    evcCalls.push({
      targetContract: swapQuote.verify.verifierAddress,
      onBehalfOfAccount: swapQuote.verify.account,
      value: 0n,
      data: swapQuote.verify.verifierData,
    })

    // Enable controller
    evcCalls.push({
      targetContract: evcAddress,
      onBehalfOfAccount: '0x0000000000000000000000000000000000000000' as Address,
      value: 0n,
      data: hooks.getDataForCall(evcAddress, 'enableController', [subAccountAddr, borrowVaultAddress]) as Hash,
    })

    // Enable collateral
    evcCalls.push({
      targetContract: evcAddress,
      onBehalfOfAccount: '0x0000000000000000000000000000000000000000' as Address,
      value: 0n,
      data: hooks.getDataForCall(evcAddress, 'enableCollateral', [subAccountAddr, collateralVaultAddress]) as Hash,
    })

    // Borrow
    evcCalls.push({
      targetContract: borrowVaultAddress,
      onBehalfOfAccount: subAccountAddr,
      value: 0n,
      data: hooks.getDataForCall(borrowVaultAddress, 'borrow', [borrowAmountParam, userAddr]) as Hash,
    })

    // Collateral cleanup
    const cleanupCalls = await buildCollateralCleanupCalls({
      evcAddress,
      accountLensAddress: eulerLensAddresses.value!.accountLens as Address,
      subAccount: subAccountAddr,
      providerUrl: EVM_PROVIDER_URL,
      subgraphUrl: SUBGRAPH_URL,
    })
    if (cleanupCalls.length) {
      // Insert cleanup before the borrow-related calls
      evcCalls.splice(evcCalls.length - 3, 0, ...cleanupCalls)
    }

    // Pyth updates for health check (borrow triggers account status check)
    const effectiveCollaterals = resolveEffectiveCollaterals(enabledCollaterals, [collateralVaultAddress])
    const { calls: pythCalls } = await preparePythUpdatesForHealthCheck(borrowVaultAddress, effectiveCollaterals, userAddr)
    if (pythCalls.length) {
      evcCalls.unshift(...pythCalls as EVCCall[])
    }

    const totalValue = sumCallValues(evcCalls)

    steps.push({
      type: 'evc-batch',
      label: usesPermit2 ? 'Permit2 swap & borrow via EVC' : 'Swap & borrow via EVC',
      to: evcAddress,
      abi: EVC_ABI,
      functionName: 'batch',
      args: [evcCalls as never],
      value: totalValue,
    })

    return {
      kind: 'swap-borrow',
      steps,
    }
  }

  const buildWithdrawAndSwapPlan = async ({
    vaultAddress: vaultAddr,
    assetsAmount,
    quote,
    subAccount,
    options = {},
  }: {
    vaultAddress: Address
    assetsAmount: bigint
    quote: SwapApiQuote
    subAccount?: string
    options?: { includePythUpdate?: boolean; liabilityVault?: string; enabledCollaterals?: string[] }
  }): Promise<TxPlan> => {
    if (!address.value || !eulerCoreAddresses.value || !eulerPeripheryAddresses.value) {
      throw new Error('Wallet not connected or addresses not available')
    }

    const userAddr = address.value as Address
    const evcAddress = eulerCoreAddresses.value.evc as Address
    const tosSignerAddress = eulerPeripheryAddresses.value.termsOfUseSigner as Address
    const withdrawFromAddr = subAccount ? (subAccount as Address) : userAddr
    const swapperAddress = quote.swap.swapperAddress as Address

    const hasSigned = await hasSignature(userAddr)
    const tosData = await getTosData()

    const hooks = new SaHooksBuilder()
    hooks.addContractInterface(vaultAddr, vaultWithdrawAbi)
    hooks.addContractInterface(swapperAddress, swapperAbi)

    if (!hasSigned && enableTermsOfUseSignature) {
      hooks.addContractInterface(tosSignerAddress, tosSignerWriteAbi)
    }

    // Withdraw to swapper (not to user wallet)
    if (subAccount) {
      hooks.setMainCallHookCallFromSA(vaultAddr, 'withdraw', [assetsAmount, swapperAddress, withdrawFromAddr])
    }
    else {
      hooks.setMainCallHookCallFromSelf(vaultAddr, 'withdraw', [assetsAmount, swapperAddress, withdrawFromAddr])
    }

    const saHooks = hooks.build()
    const evcCalls = convertSaHooksToEVCCalls(saHooks, userAddr, withdrawFromAddr)

    // ToS signature
    if (!hasSigned && enableTermsOfUseSignature) {
      const tosCall = {
        targetContract: tosSignerAddress,
        onBehalfOfAccount: userAddr,
        value: 0n,
        data: hooks.getDataForCall(tosSignerAddress, 'signTermsOfUse', [tosData.tosMessage, tosData.tosMessageHash]) as Hash,
      }
      evcCalls.unshift(tosCall)
    }

    // Swapper multicall — use quote.accountIn (matches buildSwapEvcCalls pattern)
    evcCalls.push({
      targetContract: swapperAddress,
      onBehalfOfAccount: quote.accountIn as Address,
      value: 0n,
      data: encodeFunctionData({
        abi: swapperAbi,
        functionName: 'multicall',
        args: [quote.swap.multicallItems.map(item => item.data)],
      }),
    })

    // Verify min output and transfer to receiver (output goes to wallet)
    evcCalls.push({
      targetContract: quote.verify.verifierAddress,
      onBehalfOfAccount: userAddr,
      value: 0n,
      data: quote.verify.verifierData,
    })

    // Pyth price updates (when position has borrows)
    if (options.includePythUpdate) {
      const liabilityAddr = options.liabilityVault || vaultAddr
      const effectiveCollaterals = resolveEffectiveCollaterals(options.enabledCollaterals)
      const { calls: pythCalls } = await preparePythUpdatesForHealthCheck(liabilityAddr, effectiveCollaterals, userAddr)
      if (pythCalls.length) {
        evcCalls.unshift(...pythCalls as EVCCall[])
      }
    }

    const totalValue = sumCallValues(evcCalls)

    return {
      kind: 'swap-withdraw',
      steps: [
        {
          type: 'evc-batch',
          label: 'Withdraw & swap via EVC',
          to: evcAddress,
          abi: EVC_ABI,
          functionName: 'batch',
          args: [evcCalls] as const,
          value: totalValue,
        },
      ],
    }
  }

  /**
   * Redeem all shares from a vault and swap the underlying to an arbitrary output token.
   * Used for "withdraw all" + swap. Same as buildWithdrawAndSwapPlan but uses
   * vault.redeem(shares, swapperAddress, account) instead of vault.withdraw.
   */
  const buildRedeemAndSwapPlan = async ({
    vaultAddress: vaultAddr,
    sharesAmount,
    quote,
    subAccount,
    options = {},
  }: {
    vaultAddress: Address
    sharesAmount: bigint
    quote: SwapApiQuote
    subAccount?: string
    options?: { includePythUpdate?: boolean; liabilityVault?: string; enabledCollaterals?: string[] }
  }): Promise<TxPlan> => {
    if (!address.value || !eulerCoreAddresses.value || !eulerPeripheryAddresses.value) {
      throw new Error('Wallet not connected or addresses not available')
    }

    const userAddr = address.value as Address
    const evcAddress = eulerCoreAddresses.value.evc as Address
    const tosSignerAddress = eulerPeripheryAddresses.value.termsOfUseSigner as Address
    const redeemFromAddr = subAccount ? (subAccount as Address) : userAddr
    const swapperAddress = quote.swap.swapperAddress as Address

    const hasSigned = await hasSignature(userAddr)
    const tosData = await getTosData()

    const hooks = new SaHooksBuilder()
    hooks.addContractInterface(vaultAddr, vaultRedeemAbi)
    hooks.addContractInterface(swapperAddress, swapperAbi)

    if (!hasSigned && enableTermsOfUseSignature) {
      hooks.addContractInterface(tosSignerAddress, tosSignerWriteAbi)
    }

    // Redeem shares to swapper (not to user wallet)
    if (subAccount) {
      hooks.setMainCallHookCallFromSA(vaultAddr, 'redeem', [sharesAmount, swapperAddress, redeemFromAddr])
    }
    else {
      hooks.setMainCallHookCallFromSelf(vaultAddr, 'redeem', [sharesAmount, swapperAddress, redeemFromAddr])
    }

    const saHooks = hooks.build()
    const evcCalls = convertSaHooksToEVCCalls(saHooks, userAddr, redeemFromAddr)

    // ToS signature
    if (!hasSigned && enableTermsOfUseSignature) {
      const tosCall = {
        targetContract: tosSignerAddress,
        onBehalfOfAccount: userAddr,
        value: 0n,
        data: hooks.getDataForCall(tosSignerAddress, 'signTermsOfUse', [tosData.tosMessage, tosData.tosMessageHash]) as Hash,
      }
      evcCalls.unshift(tosCall)
    }

    // Swapper multicall — use quote.accountIn (matches buildSwapEvcCalls pattern)
    evcCalls.push({
      targetContract: swapperAddress,
      onBehalfOfAccount: quote.accountIn as Address,
      value: 0n,
      data: encodeFunctionData({
        abi: swapperAbi,
        functionName: 'multicall',
        args: [quote.swap.multicallItems.map(item => item.data)],
      }),
    })

    // Verify min output and transfer to receiver (output goes to wallet)
    evcCalls.push({
      targetContract: quote.verify.verifierAddress,
      onBehalfOfAccount: userAddr,
      value: 0n,
      data: quote.verify.verifierData,
    })

    // Pyth price updates (when position has borrows)
    if (options.includePythUpdate) {
      const liabilityAddr = options.liabilityVault || vaultAddr
      const effectiveCollaterals = resolveEffectiveCollaterals(options.enabledCollaterals)
      const { calls: pythCalls } = await preparePythUpdatesForHealthCheck(liabilityAddr, effectiveCollaterals, userAddr)
      if (pythCalls.length) {
        evcCalls.unshift(...pythCalls as EVCCall[])
      }
    }

    const totalValue = sumCallValues(evcCalls)

    return {
      kind: 'swap-withdraw',
      steps: [
        {
          type: 'evc-batch',
          label: 'Withdraw & swap via EVC',
          to: evcAddress,
          abi: EVC_ABI,
          functionName: 'batch',
          args: [evcCalls] as const,
          value: totalValue,
        },
      ],
    }
  }

  return {
    executeTxPlan,
    simulateTxPlan,
    buildSimulationStateOverride,
    buildSupplyPlan,
    buildWithdrawPlan,
    buildRedeemPlan,
    buildBorrowPlan,
    buildBorrowBySavingPlan,
    buildMultiplyPlan,
    buildRepayPlan,
    buildFullRepayPlan,
    buildSwapPlan,
    buildSameAssetSwapPlan,
    buildSameAssetRepayPlan,
    buildSameAssetFullRepayPlan,
    buildSameAssetDebtSwapPlan,
    buildDisableCollateralPlan,
    buildSwapFullRepayPlan,
    buildSavingsRepayPlan,
    buildSavingsFullRepayPlan,
    buildSwapAndSupplyPlan,
    buildSwapAndBorrowPlan,
    buildWithdrawAndSwapPlan,
    buildRedeemAndSwapPlan,
  }
}
