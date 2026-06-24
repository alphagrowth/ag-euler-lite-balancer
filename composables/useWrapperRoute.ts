import { getAddress, type Address } from 'viem'
import type { VaultAsset } from '~/entities/vault'
import {
  applySlippage,
  buildWrapperDepositQuote,
  buildWrapperWithdrawalQuote,
  getWrapperRoute,
  isWrapperDepositPair,
  isWrapperWithdrawalPair,
  validateWrapperRoute,
  type WrapperRouteConfig,
} from '~/entities/wrapperRoutes'

export const useWrapperRoute = () => {
  const {
    chainId,
    eulerCoreAddresses,
    eulerPeripheryAddresses,
    isReady,
    loadEulerConfig,
  } = useEulerAddresses()
  const { client } = useRpcClient()

  const getConfiguredRoute = (vaultAddress?: string) =>
    getWrapperRoute(chainId.value, vaultAddress)

  const getValidatedRoute = async (
    vaultAddress: string | undefined,
    wrappedAsset: VaultAsset | undefined,
  ): Promise<WrapperRouteConfig | null> => {
    const route = getConfiguredRoute(vaultAddress)
    if (!route || !wrappedAsset) return null

    if (!isReady.value) {
      await loadEulerConfig()
    }
    if (!client.value || !eulerCoreAddresses.value || !eulerPeripheryAddresses.value) return null

    const valid = await validateWrapperRoute(client.value, route, wrappedAsset, {
      swapper: eulerPeripheryAddresses.value.swapper,
      swapVerifier: eulerPeripheryAddresses.value.swapVerifier,
      permit2: eulerCoreAddresses.value.permit2,
      evc: eulerCoreAddresses.value.evc,
    })
    return valid ? route : null
  }

  const buildDepositQuote = (params: {
    route: WrapperRouteConfig
    wrappedAsset: VaultAsset
    accountOut: Address
    amount: bigint
    deadline: number
  }) => {
    if (!eulerPeripheryAddresses.value?.swapper || !eulerPeripheryAddresses.value?.swapVerifier) {
      throw new Error('Euler swap addresses are unavailable')
    }
    return buildWrapperDepositQuote({
      ...params,
      swapperAddress: getAddress(eulerPeripheryAddresses.value.swapper),
      swapVerifierAddress: getAddress(eulerPeripheryAddresses.value.swapVerifier),
    })
  }

  const buildWithdrawalQuote = (params: {
    route: WrapperRouteConfig
    wrappedAsset: VaultAsset
    accountIn: Address
    receiver: Address
    expectedAmount: bigint
    slippage: number
    deadline: number
    unwrapAll?: boolean
  }) => {
    if (!eulerPeripheryAddresses.value?.swapper || !eulerPeripheryAddresses.value?.swapVerifier) {
      throw new Error('Euler swap addresses are unavailable')
    }
    const minAmountOut = params.unwrapAll
      ? applySlippage(params.expectedAmount, params.slippage)
      : params.expectedAmount
    return buildWrapperWithdrawalQuote({
      ...params,
      minAmountOut,
      swapperAddress: getAddress(eulerPeripheryAddresses.value.swapper),
      swapVerifierAddress: getAddress(eulerPeripheryAddresses.value.swapVerifier),
    })
  }

  return {
    getConfiguredRoute,
    getValidatedRoute,
    isWrapperDepositPair,
    isWrapperWithdrawalPair,
    buildDepositQuote,
    buildWithdrawalQuote,
  }
}
