import {
  decodeAbiParameters,
  decodeFunctionData,
  encodeFunctionData,
  getAddress,
  toFunctionSelector,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem'
import { describe, expect, it } from 'vitest'
import type { VaultAsset } from '~/entities/vault'
import {
  applySlippage,
  buildWrapperDepositQuote,
  buildWrapperWithdrawalQuote,
  clearWrapperRouteValidationCache,
  getWrapperDefaultAsset,
  getWrapperRoute,
  getWrapperRouteTokens,
  isWrapperDepositPair,
  isWrapperWithdrawalPair,
  validateWrapperRoute,
  wrapperAbi,
  wrapperRouteSwapAbi,
  wrapperRouteSweepAbi,
  WRAPPER_ROUTE_LABEL,
} from '~/entities/wrapperRoutes'
import { swapperAbi, swapVerifierAbi, transferFromSenderAbi } from '~/entities/euler/abis'
import { buildDisplaySteps } from '~/utils/stepDecoding'
import type { TxPlan } from '~/entities/txPlan'

const VAULT = getAddress('0xf18f3bc9440ad7940e6e2a86fd0c724add2dd0aa')
const WRAPPER = getAddress('0x6e58131ea11ed990d4b62476529cf2502fe0ec5f')
const RAW = getAddress('0xd0331a023c35514c2ef99eb34ed868737e9dcea3')
const SWAPPER = getAddress('0x41b8ec27c640dbd0299a0083fac8fe0099648bdb')
const VERIFIER = getAddress('0x392812023a2ef4f20de5aa9f7b7e2f02e9692ba7')
const ACCOUNT = getAddress('0x08334b4118f57ef2fbb547e4040e2eeee0b0ad05')
const PERMIT2 = getAddress('0x000000000022d473030f116ddee9f6b43ac78ba3')
const EVC = getAddress('0x7a9324e8f270413fa2e458f5831226d99c7477cd')

const wrappedAsset: VaultAsset = {
  name: 'Wrapped Beefy mooToken',
  symbol: 'wmooBalancerMonadwnUSDT0-wnAUSD-wnUSDC',
  address: WRAPPER,
  decimals: 18n,
}

const route = getWrapperRoute(143, VAULT)!

const decodeGenericTargetAndPayload = (swapData: Hex) => {
  const decodedSwap = decodeFunctionData({
    abi: wrapperRouteSwapAbi,
    data: swapData,
  })
  const params = decodedSwap.args[0]
  const [target, payload] = decodeAbiParameters(
    [{ type: 'address' }, { type: 'bytes' }],
    params.data,
  )
  return { params, target, payload }
}

describe('wrapper route registry', () => {
  it('matches only the configured Monad vault', () => {
    expect(route.wrapper).toBe(WRAPPER)
    expect(route.rawToken.address).toBe(RAW)
    expect(getWrapperRoute(1, VAULT)).toBeNull()
    expect(getWrapperRoute(143, zeroAddress)).toBeNull()
    expect(getWrapperRouteTokens(143)).toEqual([route.rawToken])
    expect(getWrapperRouteTokens(1)).toEqual([])
  })

  it('recognizes only the configured wrap and unwrap pairs', () => {
    expect(isWrapperDepositPair(route, RAW, WRAPPER)).toBe(true)
    expect(isWrapperDepositPair(route, WRAPPER, RAW)).toBe(false)
    expect(isWrapperWithdrawalPair(route, WRAPPER, RAW)).toBe(true)
    expect(isWrapperWithdrawalPair(route, RAW, WRAPPER)).toBe(false)
  })

  it('defaults to raw mooToken without replacing a manual selection', () => {
    const manual = { ...wrappedAsset, symbol: 'manual' }
    expect(getWrapperDefaultAsset(undefined, route)).toEqual(route.rawToken)
    expect(getWrapperDefaultAsset(manual, route)).toBe(manual)
  })
})

describe('wrapper deposit quote', () => {
  it('encodes wrap, sweep to collateral vault, and exact skim verification', () => {
    const amount = 123456789n
    const quote = buildWrapperDepositQuote({
      route,
      wrappedAsset,
      swapperAddress: SWAPPER,
      swapVerifierAddress: VERIFIER,
      accountOut: ACCOUNT,
      amount,
      deadline: 2_000_000_000,
    })

    expect(quote.amountIn).toBe(amount.toString())
    expect(quote.amountOutMin).toBe(amount.toString())
    expect(quote.route).toEqual([{ providerName: WRAPPER_ROUTE_LABEL }])

    const { params, target, payload: wrapperPayload } = decodeGenericTargetAndPayload(quote.swap.multicallItems[0].data)
    expect(target).toBe(WRAPPER)
    expect(params.tokenIn).toBe(RAW)
    expect(params.tokenOut).toBe(WRAPPER)
    expect(params.account).toBe(ACCOUNT)
    expect(params.accountIn).toBe(zeroAddress)
    expect(decodeFunctionData({ abi: wrapperAbi, data: wrapperPayload })).toEqual({
      functionName: 'wrap',
      args: [amount],
    })

    const sweep = decodeFunctionData({
      abi: wrapperRouteSweepAbi,
      data: quote.swap.multicallItems[1].data,
    })
    expect(sweep.args).toEqual([WRAPPER, amount, VAULT])

    const verify = decodeFunctionData({ abi: swapVerifierAbi, data: quote.verify.verifierData })
    expect(verify.functionName).toBe('verifyAmountMinAndSkim')
    expect(verify.args).toEqual([VAULT, ACCOUNT, amount, 2_000_000_000n])
  })
})

describe('wrapper withdrawal quote', () => {
  it('encodes exact partial unwrap and transfer verification', () => {
    const amount = 500n
    const quote = buildWrapperWithdrawalQuote({
      route,
      wrappedAsset,
      swapperAddress: SWAPPER,
      swapVerifierAddress: VERIFIER,
      accountIn: ACCOUNT,
      receiver: ACCOUNT,
      expectedAmount: amount,
      minAmountOut: amount,
      deadline: 2_000_000_000,
    })

    const { params, target, payload: wrapperPayload } = decodeGenericTargetAndPayload(quote.swap.multicallItems[0].data)
    expect(target).toBe(WRAPPER)
    expect(params.tokenIn).toBe(WRAPPER)
    expect(params.tokenOut).toBe(RAW)
    expect(params.accountIn).toBe(ACCOUNT)
    expect(decodeFunctionData({ abi: wrapperAbi, data: wrapperPayload })).toEqual({
      functionName: 'unwrap',
      args: [amount],
    })

    const sweep = decodeFunctionData({
      abi: wrapperRouteSweepAbi,
      data: quote.swap.multicallItems[1].data,
    })
    expect(sweep.args).toEqual([RAW, amount, VERIFIER])

    const verify = decodeFunctionData({ abi: swapVerifierAbi, data: quote.verify.verifierData })
    expect(verify.functionName).toBe('verifyAmountMinAndTransfer')
    expect(verify.args).toEqual([RAW, ACCOUNT, amount, 2_000_000_000n])
  })

  it('uses unwrapAll and a slippage-adjusted minimum for full redemption', () => {
    const expectedAmount = 10_000n
    const minAmountOut = applySlippage(expectedAmount, 0.5)
    const quote = buildWrapperWithdrawalQuote({
      route,
      wrappedAsset,
      swapperAddress: SWAPPER,
      swapVerifierAddress: VERIFIER,
      accountIn: ACCOUNT,
      receiver: ACCOUNT,
      expectedAmount,
      minAmountOut,
      deadline: 2_000_000_000,
      unwrapAll: true,
    })

    const { payload: wrapperPayload } = decodeGenericTargetAndPayload(quote.swap.multicallItems[0].data)
    expect(decodeFunctionData({ abi: wrapperAbi, data: wrapperPayload })).toEqual({
      functionName: 'unwrapAll',
    })
    expect(quote.amountOutMin).toBe('9950')
  })
})

describe('wrapper route validation', () => {
  it('validates on-chain relationships and SwapVerifier support', async () => {
    clearWrapperRouteValidationCache()
    const selector = toFunctionSelector('function transferFromSender(address,uint256,address)').slice(2)
    const client = {
      readContract: async ({ functionName, address }: { functionName: string, address: Address }) => {
        if (functionName === 'asset') return WRAPPER
        if (functionName === 'vault') return RAW
        if (functionName === 'decimals' && address === RAW) return 18
        if (functionName === 'decimals' && address === WRAPPER) return 18
        throw new Error('unexpected call')
      },
      getBytecode: async () => `0x6000${selector}6000` as Hex,
    } as unknown as PublicClient

    await expect(validateWrapperRoute(client, route, wrappedAsset, {
      swapper: SWAPPER,
      swapVerifier: VERIFIER,
      permit2: PERMIT2,
      evc: EVC,
    })).resolves.toBe(true)
  })

  it('fails closed when required Euler addresses are missing', async () => {
    clearWrapperRouteValidationCache()
    const client = {} as PublicClient
    await expect(validateWrapperRoute(client, route, wrappedAsset, {
      swapper: SWAPPER,
      swapVerifier: VERIFIER,
      permit2: zeroAddress,
      evc: EVC,
    })).resolves.toBe(false)
  })
})

describe('wrapper transaction review', () => {
  it('labels wrapper and non-wrapper Swapper multicalls independently', () => {
    const quote = buildWrapperDepositQuote({
      route,
      wrappedAsset,
      swapperAddress: SWAPPER,
      swapVerifierAddress: VERIFIER,
      accountOut: ACCOUNT,
      amount: 10n,
      deadline: 2_000_000_000,
    })
    const multicall = encodeFunctionData({
      abi: swapperAbi,
      functionName: 'multicall',
      args: [quote.swap.multicallItems.map(item => item.data)],
    })
    const ensoLikeMulticall = encodeFunctionData({
      abi: swapperAbi,
      functionName: 'multicall',
      args: [['0x12345678']],
    })
    const plan = {
      kind: 'multiply',
      steps: [{
        type: 'evc-batch',
        to: EVC,
        abi: [],
        functionName: 'batch',
        args: [[{
          targetContract: SWAPPER,
          onBehalfOfAccount: ACCOUNT,
          value: 0n,
          data: multicall,
        }, {
          targetContract: SWAPPER,
          onBehalfOfAccount: ACCOUNT,
          value: 0n,
          data: ensoLikeMulticall,
        }]],
      }],
    } as TxPlan

    const steps = buildDisplaySteps(plan, {
      type: 'borrow',
      asset: { symbol: 'AUSD', address: getAddress('0x438cedce647491b1d93a73d4fd757d86c6a8dbad'), decimals: 18n },
      amount: '1',
      supplyingAssetForBorrow: route.rawToken,
      supplyingAmount: '0.00000000000000001',
      swapToAsset: wrappedAsset,
      swapToAmount: '0.95',
    }, () => undefined, () => '', false)

    expect(steps).toHaveLength(2)
    expect(steps[0].label).toBe('Wrap')
    expect(steps[0].assetInfo?.symbol).toBe(route.rawToken.symbol)
    expect(steps[0].toAssetInfo?.symbol).toBe(wrappedAsset.symbol)
    expect(steps[1].label).toBe('Swap')
    expect(steps[1].assetInfo?.symbol).toBe('AUSD')
  })

  it('shows the actual transferFromSender token instead of the borrow asset', () => {
    const transferFromSender = encodeFunctionData({
      abi: transferFromSenderAbi,
      functionName: 'transferFromSender',
      args: [RAW, 1_000_000_000_000_000n, SWAPPER],
    })
    const plan = {
      kind: 'multiply',
      steps: [{
        type: 'evc-batch',
        to: EVC,
        abi: [],
        functionName: 'batch',
        args: [[{
          targetContract: VERIFIER,
          onBehalfOfAccount: ACCOUNT,
          value: 0n,
          data: transferFromSender,
        }]],
      }],
    } as TxPlan

    const steps = buildDisplaySteps(plan, {
      type: 'borrow',
      asset: { symbol: 'AUSD', address: getAddress('0x438cedce647491b1d93a73d4fd757d86c6a8dbad'), decimals: 18n },
      amount: '0.007357',
      supplyingAssetForBorrow: route.rawToken,
      supplyingAmount: '0.001',
      swapToAsset: wrappedAsset,
      swapToAmount: '0.00699468',
    }, () => undefined, () => '', false)

    expect(steps).toHaveLength(1)
    expect(steps[0].label).toBe('Transfer from wallet')
    expect(steps[0].assetInfo).toEqual({
      symbol: route.rawToken.symbol,
      address: route.rawToken.address,
      amount: '0.001',
    })
  })
})
