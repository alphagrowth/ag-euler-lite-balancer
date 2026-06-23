import {
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  isAddressEqual,
  toFunctionSelector,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem'
import type { VaultAsset } from '~/entities/vault'
import {
  type SwapApiQuote,
  type SwapApiToken,
  type SwapApiVerify,
  SwapVerificationType,
} from '~/entities/swap'
import { swapVerifierAbi } from '~/entities/euler/abis'

export const WRAPPER_ROUTE_PROVIDER = 'beefy-wrapper'
export const WRAPPER_ROUTE_LABEL = 'Beefy Wrapper'

export interface WrapperRouteConfig {
  chainId: number
  collateralVault: Address
  wrapper: Address
  rawToken: VaultAsset
  conversion: 'one-to-one'
  provider: string
  providerLabel: string
}

export interface WrapperRouteAddresses {
  swapper?: string
  swapVerifier?: string
  permit2?: string
  evc?: string
}

const HANDLER_GENERIC: Hex = '0x47656e6572696300000000000000000000000000000000000000000000000000'
const TRANSFER_FROM_SENDER_SELECTOR = toFunctionSelector('function transferFromSender(address,uint256,address)')

export const wrapperAbi = [
  {
    type: 'function',
    name: 'vault',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'wrap',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'unwrap',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'unwrapAll',
    inputs: [],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const

export const wrapperRouteSwapAbi = [{
  type: 'function',
  name: 'swap',
  inputs: [{
    name: 'params',
    type: 'tuple',
    components: [
      { name: 'handler', type: 'bytes32' },
      { name: 'mode', type: 'uint256' },
      { name: 'account', type: 'address' },
      { name: 'tokenIn', type: 'address' },
      { name: 'tokenOut', type: 'address' },
      { name: 'vaultIn', type: 'address' },
      { name: 'accountIn', type: 'address' },
      { name: 'receiver', type: 'address' },
      { name: 'amountOut', type: 'uint256' },
      { name: 'data', type: 'bytes' },
    ],
  }],
  outputs: [],
  stateMutability: 'nonpayable',
}] as const

export const wrapperRouteSweepAbi = [{
  type: 'function',
  name: 'sweep',
  inputs: [
    { name: 'token', type: 'address' },
    { name: 'amountMin', type: 'uint256' },
    { name: 'to', type: 'address' },
  ],
  outputs: [],
  stateMutability: 'nonpayable',
}] as const

const erc4626AssetAbi = [{
  type: 'function',
  name: 'asset',
  inputs: [],
  outputs: [{ name: '', type: 'address' }],
  stateMutability: 'view',
}] as const

const decimalsAbi = [{
  type: 'function',
  name: 'decimals',
  inputs: [],
  outputs: [{ name: '', type: 'uint8' }],
  stateMutability: 'view',
}] as const

const WRAPPER_ROUTES: WrapperRouteConfig[] = [{
  chainId: 143,
  collateralVault: getAddress('0xf18f3bc9440ad7940e6e2a86fd0c724add2dd0aa'),
  wrapper: getAddress('0x6e58131ea11ed990d4b62476529cf2502fe0ec5f'),
  rawToken: {
    name: 'Beefy Balancer Monad wnUSDT0-wnAUSD-wnUSDC',
    symbol: 'mooBalancerMonadwnUSDT0-wnAUSD-wnUSDC',
    address: getAddress('0xd0331a023c35514c2ef99eb34ed868737e9dcea3'),
    decimals: 18n,
  },
  conversion: 'one-to-one',
  provider: WRAPPER_ROUTE_PROVIDER,
  providerLabel: WRAPPER_ROUTE_LABEL,
}]

export const getWrapperRouteTokens = (chainId: number | undefined) =>
  chainId
    ? WRAPPER_ROUTES.filter(route => route.chainId === chainId).map(route => route.rawToken)
    : []

const validationCache = new Map<string, boolean>()

const asSwapToken = (chainId: number, asset: VaultAsset): SwapApiToken => ({
  chainId,
  address: getAddress(asset.address),
  decimals: Number(asset.decimals),
  logoURI: '',
  name: asset.name,
  symbol: asset.symbol,
})

const buildGenericSwap = (params: {
  route: WrapperRouteConfig
  account: Address
  tokenIn: Address
  tokenOut: Address
  vaultIn: Address
  accountIn: Address
  swapperAddress: Address
  wrapperData: Hex
}) => {
  const genericHandlerData = encodeAbiParameters(
    [{ type: 'address' }, { type: 'bytes' }],
    [params.route.wrapper, params.wrapperData],
  )

  return encodeFunctionData({
    abi: wrapperRouteSwapAbi,
    functionName: 'swap',
    args: [{
      handler: HANDLER_GENERIC,
      mode: 0n,
      account: params.account,
      tokenIn: params.tokenIn,
      tokenOut: params.tokenOut,
      vaultIn: params.vaultIn,
      accountIn: params.accountIn,
      receiver: params.swapperAddress,
      amountOut: 0n,
      data: genericHandlerData,
    }],
  })
}

export const getWrapperRoute = (chainId: number | undefined, collateralVault: string | undefined) => {
  if (!chainId || !collateralVault) return null
  try {
    const normalizedVault = getAddress(collateralVault)
    return WRAPPER_ROUTES.find(route =>
      route.chainId === chainId && isAddressEqual(route.collateralVault, normalizedVault),
    ) || null
  }
  catch {
    return null
  }
}

export const getWrapperDefaultAsset = (
  currentAsset: VaultAsset | undefined,
  route: WrapperRouteConfig | null,
) => currentAsset || route?.rawToken

export const isWrapperDepositPair = (
  route: WrapperRouteConfig | null,
  tokenIn: string | undefined,
  tokenOut: string | undefined,
) => {
  if (!route || !tokenIn || !tokenOut) return false
  try {
    return isAddressEqual(getAddress(tokenIn), getAddress(route.rawToken.address))
      && isAddressEqual(getAddress(tokenOut), route.wrapper)
  }
  catch {
    return false
  }
}

export const isWrapperWithdrawalPair = (
  route: WrapperRouteConfig | null,
  tokenIn: string | undefined,
  tokenOut: string | undefined,
) => {
  if (!route || !tokenIn || !tokenOut) return false
  try {
    return isAddressEqual(getAddress(tokenIn), route.wrapper)
      && isAddressEqual(getAddress(tokenOut), getAddress(route.rawToken.address))
  }
  catch {
    return false
  }
}

export const isWrapperQuote = (quote: SwapApiQuote) =>
  quote.route?.some(item => item.providerName === WRAPPER_ROUTE_LABEL || item.providerName === WRAPPER_ROUTE_PROVIDER) ?? false

export const applySlippage = (amount: bigint, slippagePercent: number) => {
  const slippageBps = Math.max(0, Math.min(10_000, Math.round(slippagePercent * 100)))
  return amount * BigInt(10_000 - slippageBps) / 10_000n
}

export const buildWrapperDepositQuote = (params: {
  route: WrapperRouteConfig
  wrappedAsset: VaultAsset
  swapperAddress: Address
  swapVerifierAddress: Address
  accountOut: Address
  amount: bigint
  deadline: number
}): SwapApiQuote => {
  const { route, amount } = params
  const wrapperData = encodeFunctionData({
    abi: wrapperAbi,
    functionName: 'wrap',
    args: [amount],
  })
  const swapData = buildGenericSwap({
    route,
    account: params.accountOut,
    tokenIn: getAddress(route.rawToken.address),
    tokenOut: route.wrapper,
    vaultIn: zeroAddress,
    accountIn: zeroAddress,
    swapperAddress: params.swapperAddress,
    wrapperData,
  })
  const sweepData = encodeFunctionData({
    abi: wrapperRouteSweepAbi,
    functionName: 'sweep',
    args: [route.wrapper, amount, route.collateralVault],
  })
  const verifierData = encodeFunctionData({
    abi: swapVerifierAbi,
    functionName: 'verifyAmountMinAndSkim',
    args: [route.collateralVault, params.accountOut, amount, BigInt(params.deadline)],
  })
  const verify: SwapApiVerify = {
    verifierAddress: params.swapVerifierAddress,
    verifierData,
    type: SwapVerificationType.SkimMin,
    vault: route.collateralVault,
    account: params.accountOut,
    amount: amount.toString(),
    deadline: params.deadline,
  }

  return {
    amountIn: amount.toString(),
    amountInMax: amount.toString(),
    amountOut: amount.toString(),
    amountOutMin: amount.toString(),
    accountIn: zeroAddress,
    accountOut: params.accountOut,
    vaultIn: zeroAddress,
    receiver: route.collateralVault,
    tokenIn: asSwapToken(route.chainId, route.rawToken),
    tokenOut: asSwapToken(route.chainId, params.wrappedAsset),
    slippage: 0,
    swap: {
      swapperAddress: params.swapperAddress,
      swapperData: '0x',
      multicallItems: [
        { functionName: 'wrap', args: [amount], data: swapData },
        { functionName: 'sweep', args: [route.wrapper, amount, route.collateralVault], data: sweepData },
      ],
    },
    verify,
    route: [{ providerName: route.providerLabel }],
  }
}

export const buildWrapperWithdrawalQuote = (params: {
  route: WrapperRouteConfig
  wrappedAsset: VaultAsset
  swapperAddress: Address
  swapVerifierAddress: Address
  accountIn: Address
  receiver: Address
  expectedAmount: bigint
  minAmountOut: bigint
  deadline: number
  unwrapAll?: boolean
}): SwapApiQuote => {
  const wrapperData = params.unwrapAll
    ? encodeFunctionData({ abi: wrapperAbi, functionName: 'unwrapAll' })
    : encodeFunctionData({ abi: wrapperAbi, functionName: 'unwrap', args: [params.expectedAmount] })
  const swapData = buildGenericSwap({
    route: params.route,
    account: params.accountIn,
    tokenIn: params.route.wrapper,
    tokenOut: getAddress(params.route.rawToken.address),
    vaultIn: params.route.collateralVault,
    accountIn: params.accountIn,
    swapperAddress: params.swapperAddress,
    wrapperData,
  })
  const sweepData = encodeFunctionData({
    abi: wrapperRouteSweepAbi,
    functionName: 'sweep',
    args: [getAddress(params.route.rawToken.address), params.minAmountOut, params.swapVerifierAddress],
  })
  const verifierData = encodeFunctionData({
    abi: swapVerifierAbi,
    functionName: 'verifyAmountMinAndTransfer',
    args: [
      getAddress(params.route.rawToken.address),
      params.receiver,
      params.minAmountOut,
      BigInt(params.deadline),
    ],
  })
  const verify: SwapApiVerify = {
    verifierAddress: params.swapVerifierAddress,
    verifierData,
    type: SwapVerificationType.TransferMin,
    vault: params.receiver,
    account: params.accountIn,
    amount: params.minAmountOut.toString(),
    deadline: params.deadline,
  }

  return {
    amountIn: params.expectedAmount.toString(),
    amountInMax: params.expectedAmount.toString(),
    amountOut: params.expectedAmount.toString(),
    amountOutMin: params.minAmountOut.toString(),
    accountIn: params.accountIn,
    accountOut: zeroAddress,
    vaultIn: params.route.collateralVault,
    receiver: params.receiver,
    tokenIn: asSwapToken(params.route.chainId, params.wrappedAsset),
    tokenOut: asSwapToken(params.route.chainId, params.route.rawToken),
    slippage: params.expectedAmount > 0n
      ? Number((params.expectedAmount - params.minAmountOut) * 10_000n / params.expectedAmount) / 100
      : 0,
    swap: {
      swapperAddress: params.swapperAddress,
      swapperData: '0x',
      multicallItems: [
        {
          functionName: params.unwrapAll ? 'unwrapAll' : 'unwrap',
          args: params.unwrapAll ? [] : [params.expectedAmount],
          data: swapData,
        },
        {
          functionName: 'sweep',
          args: [getAddress(params.route.rawToken.address), params.minAmountOut, params.swapVerifierAddress],
          data: sweepData,
        },
      ],
    },
    verify,
    route: [{ providerName: params.route.providerLabel }],
  }
}

export const validateWrapperRoute = async (
  client: PublicClient,
  route: WrapperRouteConfig,
  wrappedAsset: VaultAsset,
  addresses: WrapperRouteAddresses,
) => {
  const requiredAddresses = [addresses.swapper, addresses.swapVerifier, addresses.permit2, addresses.evc]
  if (requiredAddresses.some(address => !address || address === zeroAddress)) return false

  const cacheKey = [
    route.chainId,
    route.collateralVault,
    route.wrapper,
    route.rawToken.address,
    addresses.swapVerifier,
  ].join(':').toLowerCase()
  if (validationCache.has(cacheKey)) return validationCache.get(cacheKey)!

  try {
    if (!isAddressEqual(getAddress(wrappedAsset.address), route.wrapper)) return false

    const [vaultAsset, wrapperVault, rawDecimals, wrappedDecimals, verifierBytecode] = await Promise.all([
      client.readContract({
        address: route.collateralVault,
        abi: erc4626AssetAbi,
        functionName: 'asset',
      }),
      client.readContract({
        address: route.wrapper,
        abi: wrapperAbi,
        functionName: 'vault',
      }),
      client.readContract({
        address: getAddress(route.rawToken.address),
        abi: decimalsAbi,
        functionName: 'decimals',
      }),
      client.readContract({
        address: route.wrapper,
        abi: decimalsAbi,
        functionName: 'decimals',
      }),
      client.getBytecode({ address: getAddress(addresses.swapVerifier!) }),
    ])

    const valid = isAddressEqual(vaultAsset as Address, route.wrapper)
      && isAddressEqual(wrapperVault as Address, getAddress(route.rawToken.address))
      && Number(rawDecimals) === Number(wrappedDecimals)
      && Number(rawDecimals) === Number(route.rawToken.decimals)
      && !!verifierBytecode?.toLowerCase().includes(TRANSFER_FROM_SENDER_SELECTOR.slice(2).toLowerCase())

    validationCache.set(cacheKey, valid)
    return valid
  }
  catch {
    validationCache.set(cacheKey, false)
    return false
  }
}

export const clearWrapperRouteValidationCache = () => validationCache.clear()
