import type { Address, Hash, Hex, Abi } from 'viem'
import { encodeFunctionData, getAddress, maxUint256 } from 'viem'
import { evcDisableCollateralAbi, evcDisableControllerAbi, evcEnableCollateralAbi, evcEnableControllerAbi } from '~/abis/evc'
import { erc20BalanceOfAbi } from '~/abis/erc20'
import { vaultBorrowAbi, vaultConvertToAssetsAbi, vaultRedeemAbi, vaultRepayWithSharesAbi, vaultSkimAbi, vaultTransferFromMaxAbi, vaultWithdrawAbi } from '~/abis/vault'
import { SaHooksBuilder } from '~/entities/saHooksSDK'
import { erc20ABI, swapperAbi, swapVerifierAbi, transferFromSenderAbi } from '~/entities/euler/abis'
import { convertSaHooksToEVCCalls, type EVCCall } from '~/utils/evc-converter'
import { getNewSubAccount } from '~/entities/account'
import { buildCollateralCleanupCalls } from '~/utils/collateral-cleanup'
import { sumCallValues } from '~/utils/pyth'
import { logWarn } from '~/utils/errorHandling'
import type { TxPlan, TxStep } from '~/entities/txPlan'
import { type SwapApiQuote, SwapperMode, SwapVerificationType } from '~/entities/swap'
import { adjustForInterest } from './helpers'
import type { OperationsContext, OperationHelpers, Permit2Helpers, AllowanceHelpers } from './types'

const getSwapInputAmount = (quote: SwapApiQuote, swapperMode: SwapperMode) => {
  const amountIn = BigInt(quote.amountIn || 0)
  const amountInMax = BigInt(quote.amountInMax || 0)
  if (swapperMode === SwapperMode.EXACT_IN) return amountIn
  return amountInMax > 0n ? amountInMax : amountIn
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
      if (amount < 0n) amount = 0n
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
    args: [quote.verify.vault, quote.verify.account, amount, BigInt(quote.verify.deadline || 0)],
  })
}

export const createSwapBuilders = (
  ctx: OperationsContext,
  helpers: OperationHelpers,
  permit2: Permit2Helpers,
  allowanceHelpers: AllowanceHelpers,
) => {
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
    isDebtSwap?: boolean
  }) => {
    if (!ctx.address.value || !ctx.eulerCoreAddresses.value || !ctx.eulerPeripheryAddresses.value) {
      throw new Error('Wallet not connected or addresses not available')
    }

    const userAddr = ctx.address.value as Address
    const evcAddress = ctx.eulerCoreAddresses.value.evc as Address

    const tos = await helpers.prepareTos(userAddr)

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

    const verifierData = buildSwapVerifierData({ quote, swapperMode, isRepay, targetDebt, currentDebt })

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

    tos.addTosInterface(hooks)

    const evcCalls: EVCCall[] = []

    tos.injectTosCall(evcCalls, hooks)

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
        data: hooks.getDataForCall(quote.vaultIn, 'borrow', [inputAmount, quote.swap.swapperAddress]) as Hash,
      })
    }
    else {
      evcCalls.push({
        targetContract: quote.vaultIn,
        onBehalfOfAccount: quote.accountIn,
        value: 0n,
        data: hooks.getDataForCall(quote.vaultIn, 'withdraw', [inputAmount, quote.swap.swapperAddress, quote.accountIn]) as Hash,
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
      const effectiveCollaterals = helpers.resolveEffectiveCollaterals(enabledCollaterals, enableCollateral ? [quote.receiver] : [], removingCollaterals)
      pythResult = await helpers.preparePythUpdatesForHealthCheck(liabilityVault, effectiveCollaterals, userAddr)
    }
    else {
      pythResult = await helpers.preparePythUpdates([quote.vaultIn, quote.receiver], userAddr)
    }
    const { calls: pythCalls } = pythResult
    if (pythCalls.length) {
      evcCalls.unshift(...pythCalls as EVCCall[])
    }

    const totalValue = sumCallValues(evcCalls)

    return { evcCalls, evcAddress, totalValue }
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
      quote, swapperMode, isRepay, targetDebt, currentDebt,
      enableCollateral, disableCollateral, liabilityVault, enabledCollaterals, isDebtSwap,
    })

    return {
      kind: 'swap',
      steps: [helpers.buildEvcBatchStep({ evcCalls, label: 'Swap via EVC' })],
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
    if (!ctx.address.value || !ctx.eulerCoreAddresses.value || !ctx.eulerPeripheryAddresses.value) {
      throw new Error('Wallet not connected or addresses not available')
    }

    const fromVaultAddr = fromVaultAddress as Address
    const toVaultAddr = toVaultAddress as Address
    const userAddr = ctx.address.value as Address
    const evcAddress = ctx.eulerCoreAddresses.value.evc as Address
    const accountAddr = subAccount ? (subAccount as Address) : userAddr

    const tos = await helpers.prepareTos(userAddr)

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
    tos.addTosInterface(hooks)

    const evcCalls: EVCCall[] = []

    // Pyth updates for health check (when there's a liability vault)
    if (liabilityVault) {
      await helpers.injectPythHealthCheckUpdates({
        evcCalls,
        liabilityVaultAddr: liabilityVault,
        enabledCollaterals,
        additionalCollaterals: enableCollateral ? [toVaultAddr] : [],
        removingCollaterals: disableCollateral ? [fromVaultAddr] : [],
        userAddr,
      })
    }

    tos.injectTosCall(evcCalls, hooks)

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

    // Skim on new vault
    evcCalls.push({
      targetContract: toVaultAddr,
      onBehalfOfAccount: accountAddr,
      value: 0n,
      data: hooks.getDataForCall(toVaultAddr, 'skim', [amount, accountAddr]) as Hash,
    })

    if (enableCollateral) {
      evcCalls.push({
        targetContract: evcAddress,
        onBehalfOfAccount: '0x0000000000000000000000000000000000000000' as Address,
        value: 0n,
        data: hooks.getDataForCall(evcAddress, 'enableCollateral', [accountAddr, toVaultAddr]) as Hash,
      })
    }

    if (disableCollateral) {
      evcCalls.push({
        targetContract: evcAddress,
        onBehalfOfAccount: '0x0000000000000000000000000000000000000000' as Address,
        value: 0n,
        data: hooks.getDataForCall(evcAddress, 'disableCollateral', [accountAddr, fromVaultAddr]) as Hash,
      })
    }

    return {
      kind: 'same-asset-swap',
      steps: [helpers.buildEvcBatchStep({ evcCalls, label: 'Transfer via EVC' })],
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
    if (!ctx.address.value || !ctx.eulerCoreAddresses.value || !ctx.eulerPeripheryAddresses.value) {
      throw new Error('Wallet not connected or addresses not available')
    }

    const collateralVaultAddr = collateralVaultAddress as Address
    const borrowVaultAddr = borrowVaultAddress as Address
    const userAddr = ctx.address.value as Address
    const subAccountAddr = subAccount as Address

    const tos = await helpers.prepareTos(userAddr)

    const hooks = new SaHooksBuilder()
    hooks.addContractInterface(collateralVaultAddr, vaultWithdrawAbi)
    hooks.addContractInterface(borrowVaultAddr, [...vaultSkimAbi, ...vaultRepayWithSharesAbi])
    tos.addTosInterface(hooks)

    const evcCalls: EVCCall[] = []

    // Pyth updates for health check
    await helpers.injectPythHealthCheckUpdates({
      evcCalls,
      liabilityVaultAddr: borrowVaultAddress,
      enabledCollaterals,
      userAddr,
    })

    tos.injectTosCall(evcCalls, hooks)

    // Withdraw from collateral vault, send underlying to borrow vault
    evcCalls.push({
      targetContract: collateralVaultAddr,
      onBehalfOfAccount: subAccountAddr,
      value: 0n,
      data: hooks.getDataForCall(collateralVaultAddr, 'withdraw', [amount, borrowVaultAddr, subAccountAddr]) as Hash,
    })

    // Skim on borrow vault
    evcCalls.push({
      targetContract: borrowVaultAddr,
      onBehalfOfAccount: subAccountAddr,
      value: 0n,
      data: hooks.getDataForCall(borrowVaultAddr, 'skim', [amount, subAccountAddr]) as Hash,
    })

    // Burn shares to repay debt — use amount - 1n to avoid share rounding mismatch
    evcCalls.push({
      targetContract: borrowVaultAddr,
      onBehalfOfAccount: subAccountAddr,
      value: 0n,
      data: hooks.getDataForCall(borrowVaultAddr, 'repayWithShares', [amount > 0n ? amount - 1n : 0n, subAccountAddr]) as Hash,
    })

    return {
      kind: 'same-asset-repay',
      steps: [helpers.buildEvcBatchStep({ evcCalls, label: 'Repay with collateral via EVC' })],
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
    if (!ctx.address.value || !ctx.eulerCoreAddresses.value || !ctx.eulerPeripheryAddresses.value) {
      throw new Error('Wallet not connected or addresses not available')
    }

    const collateralVaultAddr = collateralVaultAddress as Address
    const borrowVaultAddr = borrowVaultAddress as Address
    const userAddr = ctx.address.value as Address
    const evcAddress = ctx.eulerCoreAddresses.value.evc as Address
    const subAccountAddr = subAccount as Address

    const tos = await helpers.prepareTos(userAddr)

    // Pre-flight: read pre-existing deposit in borrow vault
    let preExistingBorrowDeposit = 0n
    try {
      const balanceOfResult = await ctx.rpcProvider.readContract({
        address: borrowVaultAddr,
        abi: erc20BalanceOfAbi,
        functionName: 'balanceOf',
        args: [subAccountAddr],
      }) as bigint
      if (balanceOfResult > 0n) {
        const assetsResult = await ctx.rpcProvider.readContract({
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
    tos.addTosInterface(hooks)

    const evcCalls: EVCCall[] = []

    // No Pyth updates needed — batch ends with disableController (no health check)

    tos.injectTosCall(evcCalls, hooks)

    // 1. Withdraw from collateral vault (slightly more than debt for interest)
    const adjustedAmount = adjustForInterest(amount)
    evcCalls.push({
      targetContract: collateralVaultAddr,
      onBehalfOfAccount: subAccountAddr,
      value: 0n,
      data: hooks.getDataForCall(collateralVaultAddr, 'withdraw', [adjustedAmount, borrowVaultAddr, subAccountAddr]) as Hash,
    })

    // 2. Skim on borrow vault
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

    // 4. Disable controller
    evcCalls.push({
      targetContract: borrowVaultAddr,
      onBehalfOfAccount: subAccountAddr,
      value: 0n,
      data: hooks.getDataForCall(borrowVaultAddr, 'disableController', []) as Hash,
    })

    // 5. Disable collateral
    const collateralAddresses = enabledCollaterals || [collateralVaultAddress]
    for (const collateralAddr of collateralAddresses) {
      evcCalls.push({
        targetContract: evcAddress,
        onBehalfOfAccount: '0x0000000000000000000000000000000000000000' as Address,
        value: 0n,
        data: hooks.getDataForCall(evcAddress, 'disableCollateral', [subAccountAddr, collateralAddr as Address]) as Hash,
      })
    }

    // 6. Redeem ALL remaining shares from borrow vault
    evcCalls.push({
      targetContract: borrowVaultAddr,
      onBehalfOfAccount: subAccountAddr,
      value: 0n,
      data: hooks.getDataForCall(borrowVaultAddr, 'redeem', [maxUint256, collateralVaultAddr, subAccountAddr]) as Hash,
    })

    // 7. Skim on collateral vault
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

    return {
      kind: 'same-asset-full-repay',
      steps: [helpers.buildEvcBatchStep({ evcCalls, label: 'Full repay with collateral via EVC' })],
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
    if (!ctx.address.value || !ctx.eulerCoreAddresses.value || !ctx.eulerPeripheryAddresses.value) {
      throw new Error('Wallet not connected or addresses not available')
    }

    const oldVaultAddr = oldVaultAddress as Address
    const newVaultAddr = newVaultAddress as Address
    const userAddr = ctx.address.value as Address
    const evcAddress = ctx.eulerCoreAddresses.value.evc as Address
    const subAccountAddr = subAccount as Address

    const tos = await helpers.prepareTos(userAddr)

    // Pre-flight: read pre-existing deposit in OLD vault
    let preExistingOldVaultDeposit = 0n
    try {
      const balanceOfResult = await ctx.rpcProvider.readContract({
        address: oldVaultAddr,
        abi: erc20BalanceOfAbi,
        functionName: 'balanceOf',
        args: [subAccountAddr],
      }) as bigint
      if (balanceOfResult > 0n) {
        const assetsResult = await ctx.rpcProvider.readContract({
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
    tos.addTosInterface(hooks)

    const evcCalls: EVCCall[] = []

    // Pyth updates — batch ends with active debt in new vault, so health check IS needed
    await helpers.injectPythHealthCheckUpdates({
      evcCalls,
      liabilityVaultAddr: newVaultAddress,
      enabledCollaterals,
      userAddr,
    })

    tos.injectTosCall(evcCalls, hooks)

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

    // 3. Skim on old vault
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

    // 5. Disable controller on old vault
    evcCalls.push({
      targetContract: oldVaultAddr,
      onBehalfOfAccount: subAccountAddr,
      value: 0n,
      data: hooks.getDataForCall(oldVaultAddr, 'disableController', []) as Hash,
    })

    // 6. Redeem ALL remaining shares from old vault
    evcCalls.push({
      targetContract: oldVaultAddr,
      onBehalfOfAccount: subAccountAddr,
      value: 0n,
      data: hooks.getDataForCall(oldVaultAddr, 'redeem', [maxUint256, newVaultAddr, subAccountAddr]) as Hash,
    })

    // 7. Skim on new vault
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

    return {
      kind: 'same-asset-debt-swap',
      steps: [helpers.buildEvcBatchStep({ evcCalls, label: 'Debt swap via EVC' })],
    }
  }

  /**
   * Full repay using a cross-asset swap (from collateral or savings).
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
    if (!ctx.address.value || !ctx.eulerCoreAddresses.value) {
      throw new Error('Wallet not connected or addresses not available')
    }

    const userAddr = ctx.address.value as Address
    const evcAddress = ctx.eulerCoreAddresses.value.evc as Address
    const subAccountAddr = (source === 'collateral' ? quote.accountIn : quote.accountOut) as Address

    const { evcCalls } = await buildSwapEvcCalls({
      quote, swapperMode, isRepay: true, targetDebt, currentDebt,
      liabilityVault, enabledCollaterals,
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

    // Disable controller
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

    const label = source === 'collateral'
      ? 'Full repay with collateral swap via EVC'
      : 'Full repay with savings swap via EVC'

    return {
      kind: `swap-${source}-full-repay`,
      steps: [helpers.buildEvcBatchStep({ evcCalls, label })],
    }
  }

  /**
   * Swap an arbitrary token from the user's wallet and deposit the output into a vault.
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
    if (!ctx.address.value || !ctx.eulerCoreAddresses.value || !ctx.eulerPeripheryAddresses.value) {
      throw new Error('Wallet not connected or addresses not available')
    }

    const userAddr = ctx.address.value as Address
    const swapVerifierAddress = ctx.eulerPeripheryAddresses.value.swapVerifier as Address

    const { steps, permitCall, usesPermit2 } = await helpers.prepareTokenApproval({
      assetAddr: inputTokenAddress,
      spenderAddr: swapVerifierAddress,
      userAddr,
      amount: inputAmount,
      includePermit2Call,
    })

    const tos = await helpers.prepareTos(userAddr)

    const hooks = new SaHooksBuilder()
    hooks.addContractInterface(swapVerifierAddress, [...transferFromSenderAbi, ...swapVerifierAbi])
    hooks.addContractInterface(quote.swap.swapperAddress, swapperAbi)
    tos.addTosInterface(hooks)

    const evcCalls: EVCCall[] = []

    if (permitCall) {
      evcCalls.push(permitCall)
    }

    tos.injectTosCall(evcCalls, hooks)

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

    // Verify min output and skim into vault
    evcCalls.push({
      targetContract: quote.verify.verifierAddress,
      onBehalfOfAccount: quote.verify.account,
      value: 0n,
      data: quote.verify.verifierData,
    })

    steps.push(helpers.buildEvcBatchStep({
      evcCalls,
      label: usesPermit2 ? 'Permit2 swap & supply via EVC' : 'Swap & supply via EVC',
    }))

    return { kind: 'swap-supply', steps }
  }

  /**
   * Swap an arbitrary token from the user's wallet to the collateral vault's underlying,
   * deposit as collateral, enable controller + collateral, and borrow.
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
    if (!ctx.address.value || !ctx.eulerCoreAddresses.value || !ctx.eulerPeripheryAddresses.value) {
      throw new Error('Wallet not connected or addresses not available')
    }

    const userAddr = ctx.address.value as Address
    const evcAddress = ctx.eulerCoreAddresses.value.evc as Address
    const swapVerifierAddress = ctx.eulerPeripheryAddresses.value.swapVerifier as Address

    const subAccountAddr = (subAccount || await getNewSubAccount(ctx.address.value)) as Address

    const { steps, permitCall, usesPermit2 } = await helpers.prepareTokenApproval({
      assetAddr: inputTokenAddress,
      spenderAddr: swapVerifierAddress,
      userAddr,
      amount: inputAmount,
      includePermit2Call,
    })

    const tos = await helpers.prepareTos(userAddr)

    const hooks = new SaHooksBuilder()
    hooks.addContractInterface(swapVerifierAddress, [...transferFromSenderAbi, ...swapVerifierAbi])
    hooks.addContractInterface(swapQuote.swap.swapperAddress, swapperAbi)
    hooks.addContractInterface(evcAddress, [...evcEnableControllerAbi, ...evcEnableCollateralAbi])
    hooks.addContractInterface(borrowVaultAddress, vaultBorrowAbi)
    tos.addTosInterface(hooks)

    const evcCalls: EVCCall[] = []

    if (permitCall) {
      evcCalls.push(permitCall)
    }

    tos.injectTosCall(evcCalls, hooks)

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

    // Verify min output and skim into collateral vault
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
      accountLensAddress: ctx.eulerLensAddresses.value!.accountLens as Address,
      subAccount: subAccountAddr,
      providerUrl: ctx.EVM_PROVIDER_URL,
      subgraphUrl: ctx.SUBGRAPH_URL,
    })
    if (cleanupCalls.length) {
      // Insert cleanup before the borrow-related calls
      evcCalls.splice(evcCalls.length - 3, 0, ...cleanupCalls)
    }

    // Pyth updates for health check
    await helpers.injectPythHealthCheckUpdates({
      evcCalls,
      liabilityVaultAddr: borrowVaultAddress,
      enabledCollaterals,
      additionalCollaterals: [collateralVaultAddress],
      userAddr,
    })

    steps.push(helpers.buildEvcBatchStep({
      evcCalls,
      label: usesPermit2 ? 'Permit2 swap & borrow via EVC' : 'Swap & borrow via EVC',
    }))

    return { kind: 'swap-borrow', steps }
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
    if (!ctx.address.value || !ctx.eulerCoreAddresses.value || !ctx.eulerPeripheryAddresses.value) {
      throw new Error('Wallet not connected or addresses not available')
    }

    const userAddr = ctx.address.value as Address
    const withdrawFromAddr = subAccount ? (subAccount as Address) : userAddr
    const swapperAddress = quote.swap.swapperAddress as Address

    const tos = await helpers.prepareTos(userAddr)

    const hooks = new SaHooksBuilder()
    hooks.addContractInterface(vaultAddr, vaultWithdrawAbi)
    hooks.addContractInterface(swapperAddress, swapperAbi)
    tos.addTosInterface(hooks)

    // Withdraw to swapper (not to user wallet)
    if (subAccount) {
      hooks.setMainCallHookCallFromSA(vaultAddr, 'withdraw', [assetsAmount, swapperAddress, withdrawFromAddr])
    }
    else {
      hooks.setMainCallHookCallFromSelf(vaultAddr, 'withdraw', [assetsAmount, swapperAddress, withdrawFromAddr])
    }

    const saHooks = hooks.build()
    const evcCalls = convertSaHooksToEVCCalls(saHooks, userAddr, withdrawFromAddr)

    tos.injectTosCall(evcCalls, hooks)

    // Swapper multicall
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

    // Verify min output
    evcCalls.push({
      targetContract: quote.verify.verifierAddress,
      onBehalfOfAccount: userAddr,
      value: 0n,
      data: quote.verify.verifierData,
    })

    // Pyth price updates (when position has borrows)
    if (options.includePythUpdate) {
      const liabilityAddr = options.liabilityVault || vaultAddr
      await helpers.injectPythHealthCheckUpdates({
        evcCalls,
        liabilityVaultAddr: liabilityAddr,
        enabledCollaterals: options.enabledCollaterals,
        userAddr,
      })
    }

    return {
      kind: 'swap-withdraw',
      steps: [helpers.buildEvcBatchStep({ evcCalls, label: 'Withdraw & swap via EVC' })],
    }
  }

  /**
   * Redeem all shares from a vault and swap the underlying to an arbitrary output token.
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
    if (!ctx.address.value || !ctx.eulerCoreAddresses.value || !ctx.eulerPeripheryAddresses.value) {
      throw new Error('Wallet not connected or addresses not available')
    }

    const userAddr = ctx.address.value as Address
    const redeemFromAddr = subAccount ? (subAccount as Address) : userAddr
    const swapperAddress = quote.swap.swapperAddress as Address

    const tos = await helpers.prepareTos(userAddr)

    const hooks = new SaHooksBuilder()
    hooks.addContractInterface(vaultAddr, vaultRedeemAbi)
    hooks.addContractInterface(swapperAddress, swapperAbi)
    tos.addTosInterface(hooks)

    // Redeem shares to swapper (not to user wallet)
    if (subAccount) {
      hooks.setMainCallHookCallFromSA(vaultAddr, 'redeem', [sharesAmount, swapperAddress, redeemFromAddr])
    }
    else {
      hooks.setMainCallHookCallFromSelf(vaultAddr, 'redeem', [sharesAmount, swapperAddress, redeemFromAddr])
    }

    const saHooks = hooks.build()
    const evcCalls = convertSaHooksToEVCCalls(saHooks, userAddr, redeemFromAddr)

    tos.injectTosCall(evcCalls, hooks)

    // Swapper multicall
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

    // Verify min output
    evcCalls.push({
      targetContract: quote.verify.verifierAddress,
      onBehalfOfAccount: userAddr,
      value: 0n,
      data: quote.verify.verifierData,
    })

    // Pyth price updates
    if (options.includePythUpdate) {
      const liabilityAddr = options.liabilityVault || vaultAddr
      await helpers.injectPythHealthCheckUpdates({
        evcCalls,
        liabilityVaultAddr: liabilityAddr,
        enabledCollaterals: options.enabledCollaterals,
        userAddr,
      })
    }

    return {
      kind: 'swap-withdraw',
      steps: [helpers.buildEvcBatchStep({ evcCalls, label: 'Withdraw & swap via EVC' })],
    }
  }

  return {
    buildSwapPlan,
    buildSameAssetSwapPlan,
    buildSameAssetRepayPlan,
    buildSameAssetFullRepayPlan,
    buildSameAssetDebtSwapPlan,
    buildSwapFullRepayPlan,
    buildSwapAndSupplyPlan,
    buildSwapAndBorrowPlan,
    buildWithdrawAndSwapPlan,
    buildRedeemAndSwapPlan,
  }
}
