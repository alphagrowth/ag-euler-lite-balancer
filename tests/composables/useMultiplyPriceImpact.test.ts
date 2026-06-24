import { computed, effectScope, ref, type EffectScope } from 'vue'
import { describe, expect, afterEach, it, vi } from 'vitest'
import { useMultiplyPriceImpact } from '~/composables/borrow/useMultiplyPriceImpact'
import type { Vault } from '~/entities/vault'
import { getAssetUsdValue, getCollateralUsdValue } from '~/services/pricing/priceProvider'

vi.mock('~/services/pricing/priceProvider', () => ({
  getAssetUsdValue: vi.fn(),
  getCollateralUsdValue: vi.fn(),
}))

const mockedGetAssetUsdValue = vi.mocked(getAssetUsdValue)
const mockedGetCollateralUsdValue = vi.mocked(getCollateralUsdValue)

const BEEFY_VAULT = '0xf18f3bc9440ad7940e6e2a86fd0c724add2dd0aa'
const BPT_VAULT = '0x5795130BFb9232C7500C6E57A96Fdd18bFA60436'
const SHORT_VAULT = '0x438cedce647491b1d93a73d4fd757d86c6a8dbad'
const NORMAL_LONG_VAULT = '0x1111111111111111111111111111111111111111'

const vault = (address: string): Vault => ({
  address,
  decimals: 18n,
  asset: {
    address: `${address.slice(0, -1)}2`,
    name: 'Token',
    symbol: 'TKN',
    decimals: 18n,
  },
}) as Vault

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

let scope: EffectScope | undefined

afterEach(() => {
  scope?.stop()
  scope = undefined
  vi.resetAllMocks()
})

const mountComposable = (params: {
  longVaultAddress?: string
  chainId?: number
  swapAmountIn?: bigint
  swapAmountOut?: bigint
  multiplier?: number
  isLoading?: boolean
  isSwapReady?: boolean
} = {}) => {
  const isLoading = ref(params.isLoading ?? false)
  const isSwapReady = ref(params.isSwapReady ?? true)
  const swapAmountIn = ref(params.swapAmountIn ?? 100n)
  const swapAmountOut = ref(params.swapAmountOut ?? 90n)
  const shortVault = ref(vault(SHORT_VAULT))
  const longVault = ref(vault(params.longVaultAddress ?? NORMAL_LONG_VAULT))
  const multiplier = ref(params.multiplier ?? 2)
  const chainId = ref(params.chainId ?? 143)

  scope = effectScope()
  const result = scope.run(() => useMultiplyPriceImpact({
    isLoading,
    isSwapReady,
    swapAmountIn,
    swapAmountOut,
    shortVault: computed(() => shortVault.value),
    longVault: computed(() => longVault.value),
    multiplier,
    chainId,
  }))

  if (!result) throw new Error('Failed to mount composable')
  return result
}

describe('useMultiplyPriceImpact', () => {
  it('suppresses direct and multiplied impact for Beefy wrapper collateral', async () => {
    mockedGetAssetUsdValue.mockResolvedValue(100)
    mockedGetCollateralUsdValue.mockResolvedValue(90)

    const result = mountComposable({ longVaultAddress: BEEFY_VAULT, multiplier: 3 })
    await flush()

    expect(result.multiplyPriceImpact.value).toBeNull()
    expect(result.multipliedPriceImpact.value).toBeNull()
    expect(mockedGetAssetUsdValue).not.toHaveBeenCalled()
    expect(mockedGetCollateralUsdValue).not.toHaveBeenCalled()
  })

  it('suppresses direct and multiplied impact for BPT collateral vaults', async () => {
    const result = mountComposable({ longVaultAddress: BPT_VAULT, multiplier: 3 })
    await flush()

    expect(result.multiplyPriceImpact.value).toBeNull()
    expect(result.multipliedPriceImpact.value).toBeNull()
    expect(mockedGetAssetUsdValue).not.toHaveBeenCalled()
    expect(mockedGetCollateralUsdValue).not.toHaveBeenCalled()
  })

  it('computes impact for normal collateral', async () => {
    mockedGetAssetUsdValue.mockResolvedValue(100)
    mockedGetCollateralUsdValue.mockResolvedValue(95)

    const result = mountComposable({ multiplier: 2 })
    await flush()

    expect(result.multiplyPriceImpact.value).toBeCloseTo(-5)
    expect(result.multipliedPriceImpact.value).toBeCloseTo(-10)
  })

  it('prefers collateral-context output pricing over asset-level output pricing', async () => {
    mockedGetAssetUsdValue.mockResolvedValueOnce(100).mockResolvedValueOnce(1)
    mockedGetCollateralUsdValue.mockResolvedValue(95)

    const result = mountComposable()
    await flush()

    expect(result.multiplyPriceImpact.value).toBeCloseTo(-5)
    expect(mockedGetAssetUsdValue).toHaveBeenCalledTimes(1)
    expect(mockedGetCollateralUsdValue).toHaveBeenCalledTimes(1)
  })

  it('falls back to asset-level output pricing when collateral-context pricing is unavailable', async () => {
    mockedGetAssetUsdValue.mockResolvedValueOnce(100).mockResolvedValueOnce(98)
    mockedGetCollateralUsdValue.mockResolvedValue(undefined)

    const result = mountComposable()
    await flush()

    expect(result.multiplyPriceImpact.value).toBeCloseTo(-2)
    expect(mockedGetAssetUsdValue).toHaveBeenCalledTimes(2)
  })

  it('returns null for zero or missing USD values', async () => {
    mockedGetAssetUsdValue.mockResolvedValue(100)
    mockedGetCollateralUsdValue.mockResolvedValue(0)

    const result = mountComposable()
    await flush()

    expect(result.multiplyPriceImpact.value).toBeNull()
    expect(result.multipliedPriceImpact.value).toBeNull()
  })

  it('returns null for missing or non-finite computed impacts', async () => {
    mockedGetAssetUsdValue.mockResolvedValue(undefined)
    mockedGetCollateralUsdValue.mockResolvedValue(Infinity)

    const result = mountComposable()
    await flush()

    expect(result.multiplyPriceImpact.value).toBeNull()
    expect(result.multipliedPriceImpact.value).toBeNull()
  })
})
