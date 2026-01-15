import axios from 'axios'
import { zeroAddress, type Address } from 'viem'
import {
  type RoutingConfig,
  type SwapApiQuote,
  type SwapApiResponse,
  SwapperMode,
} from '~/entities/swap'

const SWAP_DEFAULT_DEADLINE_SECONDS = 1800

export interface SwapApiRequestInput {
  chainId?: number
  tokenIn: Address
  tokenOut: Address
  accountIn: Address
  accountOut: Address
  amount: bigint
  vaultIn: Address
  receiver: Address
  origin?: Address
  slippage?: number
  swapperMode?: SwapperMode
  isRepay?: boolean
  targetDebt?: bigint
  currentDebt?: bigint
  deadline?: number
  dustAccount?: Address
  routingOverride?: RoutingConfig
}

const buildRequestParams = (
  chainId: number | undefined,
  origin: Address,
  params: SwapApiRequestInput,
  deadline: number,
) => {
  const requestParams: Record<string, string | number | undefined> = {
    chainId,
    tokenIn: params.tokenIn,
    tokenOut: params.tokenOut,
    amount: params.amount?.toString(),
    targetDebt: params.targetDebt?.toString() || '0',
    currentDebt: params.currentDebt?.toString() || '0',
    receiver: params.receiver,
    vaultIn: params.vaultIn,
    origin,
    accountIn: params.accountIn,
    accountOut: params.accountOut,
    slippage: params.slippage?.toString() || '0',
    deadline,
    swapperMode: params.swapperMode ?? SwapperMode.EXACT_IN,
    isRepay: String(params.isRepay ?? false),
    dustAccount: params.dustAccount || origin,
    routingOverride: params.routingOverride ? JSON.stringify(params.routingOverride) : undefined,
  }

  return Object.fromEntries(
    Object.entries(requestParams).filter(([, value]) => value !== undefined && value !== null),
  )
}

const parseSwapApiResponse = (payload: SwapApiResponse | { data?: SwapApiQuote[] }) => {
  if ('success' in payload && payload.success === false) {
    throw new Error('Swap API returned success=false')
  }
  if ('data' in payload && Array.isArray(payload.data)) {
    return payload.data
  }
  return []
}

export const useSwapApi = () => {
  const { SWAP_API_URL } = useEulerConfig()
  const { chainId } = useEulerAddresses()
  const { address } = useWagmi()

  const baseUrl = SWAP_API_URL || 'https://swap.euler.finance/swap'

  const getSwapQuotes = async (
    params: SwapApiRequestInput,
    options?: { signal?: AbortSignal },
  ): Promise<SwapApiQuote[]> => {
    if (!params.tokenIn || !params.tokenOut) {
      return []
    }

    const origin = params.origin || address.value || zeroAddress
    const deadline = params.deadline || (Math.floor(Date.now() / 1000) + SWAP_DEFAULT_DEADLINE_SECONDS)
    const requestParams = buildRequestParams(chainId.value, origin, params, deadline)

    const response = await axios.get<SwapApiResponse>(
      `${baseUrl}/swaps`,
      {
        params: requestParams,
        signal: options?.signal,
      },
    )

    return parseSwapApiResponse(response.data)
  }

  const getSwapQuote = async (
    params: SwapApiRequestInput,
    options?: { signal?: AbortSignal },
  ): Promise<SwapApiQuote | null> => {
    const quotes = await getSwapQuotes(params, options)
    return quotes[0] || null
  }

  const logSwapFailure = async (payload: unknown) => {
    try {
      await axios.post(`${baseUrl}/log`, payload)
    }
    catch (error) {
      console.warn('[useSwapApi] log failed', error)
    }
  }

  return {
    baseUrl,
    getSwapQuote,
    getSwapQuotes,
    logSwapFailure,
  }
}
