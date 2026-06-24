import { computed, ref } from 'vue'
import { decodeFunctionData, encodeFunctionData, getAddress, type Address, type Hex } from 'viem'
import { describe, expect, it, vi } from 'vitest'
import { createVaultBuilders } from '~/composables/useEulerOperations/vault'
import type { OperationsContext, OperationHelpers } from '~/composables/useEulerOperations/types'
import { SwapperMode, SwapVerificationType, type SwapApiQuote } from '~/entities/swap'
import type { VaultAsset } from '~/entities/vault'
import { buildWrapperDepositQuote, getWrapperRoute } from '~/entities/wrapperRoutes'
import { swapVerifierAbi, transferFromSenderAbi } from '~/entities/euler/abis'
import { vaultBorrowAbi, vaultDepositAbi } from '~/abis/vault'
import { evcEnableCollateralAbi, evcEnableControllerAbi } from '~/abis/evc'
import { decodeSwapperMulticallAction } from '~/utils/stepDecoding'
import type { EVCCall } from '~/utils/evc-converter'

vi.mock('~/utils/collateral-cleanup', () => ({
  buildCollateralCleanupCalls: vi.fn(async () => []),
}))

const VAULT = getAddress('0xf18f3bc9440ad7940e6e2a86fd0c724add2dd0aa')
const WRAPPER = getAddress('0x6e58131ea11ed990d4b62476529cf2502fe0ec5f')
const RAW = getAddress('0xd0331a023c35514c2ef99eb34ed868737e9dcea3')
const SWAPPER = getAddress('0x41b8ec27c640dbd0299a0083fac8fe0099648bdb')
const VERIFIER = getAddress('0x392812023a2ef4f20de5aa9f7b7e2f02e9692ba7')
const EVC = getAddress('0x7a9324e8f270413fa2e458f5831226d99c7477cd')
const USER = getAddress('0x08334b4118f57ef2fbb547e4040e2eeee0b0ad05')
const SUB_ACCOUNT = getAddress('0x1111111111111111111111111111111111111111')
const AUSD_VAULT = getAddress('0x438cedce647491b1d93a73d4fd757d86c6a8dbad')
const AUSD = getAddress('0x2222222222222222222222222222222222222222')
const ACCOUNT_LENS = getAddress('0x3333333333333333333333333333333333333333')

const wrappedAsset: VaultAsset = {
  name: 'Wrapped Beefy mooToken',
  symbol: 'wmooBalancerMonadwnUSDT0-wnAUSD-wnUSDC',
  address: WRAPPER,
  decimals: 18n,
}

const emptyToken = (address: Address) => ({
  address,
  chainId: 143,
  decimals: 18,
  logoURI: '',
  name: '',
  symbol: '',
})

const buildLoopQuote = (amountIn: bigint, minAmountOut: bigint): SwapApiQuote => {
  const deadline = 2_000_000_000
  const verifierData = encodeFunctionData({
    abi: swapVerifierAbi,
    functionName: 'verifyAmountMinAndSkim',
    args: [VAULT, SUB_ACCOUNT, minAmountOut, BigInt(deadline)],
  })

  return {
    amountIn: amountIn.toString(),
    amountInMax: amountIn.toString(),
    amountOut: minAmountOut.toString(),
    amountOutMin: minAmountOut.toString(),
    accountIn: SUB_ACCOUNT,
    accountOut: SUB_ACCOUNT,
    vaultIn: AUSD_VAULT,
    receiver: VAULT,
    tokenIn: emptyToken(AUSD),
    tokenOut: emptyToken(WRAPPER),
    slippage: 0.5,
    swap: {
      swapperAddress: SWAPPER,
      swapperData: '0x',
      multicallItems: [{ functionName: 'swap', args: [], data: '0x12345678' }],
    },
    verify: {
      verifierAddress: VERIFIER,
      verifierData,
      type: SwapVerificationType.SkimMin,
      vault: VAULT,
      account: SUB_ACCOUNT,
      amount: minAmountOut.toString(),
      deadline,
    },
    route: [{ providerName: 'enso' }],
  }
}

const buildTestBuilders = () => {
  const ctx = {
    address: ref(USER),
    chainId: ref(143),
    eulerCoreAddresses: computed(() => ({ evc: EVC })),
    eulerPeripheryAddresses: computed(() => ({ swapper: SWAPPER, swapVerifier: VERIFIER })),
    eulerLensAddresses: computed(() => ({ accountLens: ACCOUNT_LENS })),
    rpcUrl: 'http://localhost',
    SUBGRAPH_URL: 'http://localhost/subgraph',
  } as unknown as OperationsContext

  const helpers = {
    prepareTokenApproval: vi.fn(async () => ({ steps: [], permitCall: undefined, usesPermit2: false })),
    injectPythHealthCheckUpdates: vi.fn(async () => undefined),
    buildEvcBatchStep: ({ evcCalls, label }: { evcCalls: EVCCall[], label: string }) => ({
      type: 'evc-batch',
      label,
      to: EVC,
      abi: [],
      functionName: 'batch',
      args: [evcCalls],
      value: 0n,
    }),
    adjustForInterest: (amount: bigint) => amount,
  } as unknown as OperationHelpers

  return { builders: createVaultBuilders(ctx, helpers, {} as never, {} as never), helpers }
}

describe('multiply wrapper supply leg', () => {
  it('wraps raw collateral before enablement, borrowing, and the Enso loop', async () => {
    const route = getWrapperRoute(143, VAULT)!
    const supplyAmount = 10n
    const debtAmount = 7n
    const supplyQuote = buildWrapperDepositQuote({
      route,
      wrappedAsset,
      swapperAddress: SWAPPER,
      swapVerifierAddress: VERIFIER,
      accountOut: SUB_ACCOUNT,
      amount: supplyAmount,
      deadline: 2_000_000_000,
    })
    const loopQuote = buildLoopQuote(debtAmount, 6n)
    const { builders, helpers } = buildTestBuilders()

    const plan = await builders.buildMultiplyPlan({
      supplyVaultAddress: VAULT,
      supplyAssetAddress: RAW,
      supplyAmount,
      supplyQuote,
      longVaultAddress: VAULT,
      longAssetAddress: WRAPPER,
      borrowVaultAddress: AUSD_VAULT,
      debtAmount,
      quote: loopQuote,
      swapperMode: SwapperMode.EXACT_IN,
      subAccount: SUB_ACCOUNT,
      includePermit2Call: false,
    })

    expect(helpers.prepareTokenApproval).toHaveBeenCalledWith(expect.objectContaining({
      assetAddr: RAW,
      spenderAddr: VERIFIER,
      amount: supplyAmount,
    }))

    const calls = plan.steps[0].args?.[0] as Array<{ targetContract: Address, data: Hex }>
    const labels = calls.map((call) => {
      if (call.targetContract === VERIFIER) {
        try {
          if (decodeFunctionData({ abi: transferFromSenderAbi, data: call.data }).functionName === 'transferFromSender') return 'transferFromSender'
        }
        catch { /* ignore */ }
        try {
          if (decodeFunctionData({ abi: swapVerifierAbi, data: call.data }).functionName === 'verifyAmountMinAndSkim') return 'verifySkim'
        }
        catch { /* ignore */ }
      }
      if (call.targetContract === SWAPPER) return decodeSwapperMulticallAction(call.data) === 'wrap' ? 'wrapMulticall' : 'loopMulticall'
      if (call.targetContract === EVC) {
        try {
          const decoded = decodeFunctionData({ abi: [...evcEnableControllerAbi, ...evcEnableCollateralAbi], data: call.data })
          return decoded.functionName
        }
        catch { /* ignore */ }
      }
      if (call.targetContract === AUSD_VAULT) {
        try {
          if (decodeFunctionData({ abi: vaultBorrowAbi, data: call.data }).functionName === 'borrow') return 'borrow'
        }
        catch { /* ignore */ }
      }
      return 'other'
    })

    expect(labels).toEqual([
      'transferFromSender',
      'wrapMulticall',
      'verifySkim',
      'enableController',
      'enableCollateral',
      'borrow',
      'loopMulticall',
      'verifySkim',
    ])

    const transfer = decodeFunctionData({ abi: transferFromSenderAbi, data: calls[0].data })
    expect(transfer.args).toEqual([RAW, supplyAmount, SWAPPER])

    const supplyVerify = decodeFunctionData({ abi: swapVerifierAbi, data: calls[2].data })
    expect(supplyVerify.args).toEqual([VAULT, SUB_ACCOUNT, supplyAmount, 2_000_000_000n])

    const borrow = decodeFunctionData({ abi: vaultBorrowAbi, data: calls[5].data })
    expect(borrow.args).toEqual([debtAmount, SWAPPER])
  })

  it('keeps the direct wrapped-token multiply path as a vault deposit', async () => {
    const { builders, helpers } = buildTestBuilders()
    const plan = await builders.buildMultiplyPlan({
      supplyVaultAddress: VAULT,
      supplyAssetAddress: WRAPPER,
      supplyAmount: 10n,
      longVaultAddress: VAULT,
      longAssetAddress: WRAPPER,
      borrowVaultAddress: AUSD_VAULT,
      debtAmount: 7n,
      quote: buildLoopQuote(7n, 6n),
      swapperMode: SwapperMode.EXACT_IN,
      subAccount: SUB_ACCOUNT,
      includePermit2Call: false,
    })

    expect(helpers.prepareTokenApproval).toHaveBeenCalledWith(expect.objectContaining({
      assetAddr: WRAPPER,
      spenderAddr: VAULT,
      amount: 10n,
    }))

    const calls = plan.steps[0].args?.[0] as Array<{ targetContract: Address, data: Hex }>
    const depositCall = calls.find(call => call.targetContract === VAULT && call.data.startsWith('0x6e553f65'))
    expect(depositCall).toBeTruthy()
    const deposit = decodeFunctionData({ abi: vaultDepositAbi, data: depositCall!.data })
    expect(deposit.args).toEqual([10n, SUB_ACCOUNT])
  })
})
