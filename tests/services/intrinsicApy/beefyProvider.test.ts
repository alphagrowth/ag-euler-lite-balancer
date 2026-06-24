import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBeefyProvider } from '~/services/intrinsicApy/beefyProvider'
import type { IntrinsicApySourceConfig } from '~/entities/custom'

const WRAPPED_BEEFY = '0x6e58131ea11ed990d4b62476529cf2502fe0ec5f'
const BEEFY_VAULT_ID = 'balancerv3-monad-usdt0-ausd-usdc'

const source: IntrinsicApySourceConfig = {
  provider: 'beefy',
  chainId: 143,
  address: WRAPPED_BEEFY,
  beefyVaultId: BEEFY_VAULT_ID,
}

const stubFetch = (data: unknown) => {
  vi.stubGlobal('$fetch', vi.fn().mockResolvedValue(data))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createBeefyProvider', () => {
  it('converts Beefy total APY fractions to percentage points', async () => {
    stubFetch({
      [BEEFY_VAULT_ID]: {
        totalApy: 0.08553784725085263,
      },
    })

    const result = await createBeefyProvider([source]).fetch(143)

    expect(result).toEqual([{
      address: WRAPPED_BEEFY,
      info: {
        apy: 8.553784725085263,
        provider: 'Beefy',
        source: `https://app.beefy.com/vault/${BEEFY_VAULT_ID}`,
      },
    }])
  })

  it('returns no result when the configured Beefy vault id is absent', async () => {
    stubFetch({
      'other-vault': {
        totalApy: 0.08553784725085263,
      },
    })

    const result = await createBeefyProvider([source]).fetch(143)

    expect(result).toEqual([])
  })

  it.each([
    undefined,
    null,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    0,
    -0.01,
  ])('returns no result for invalid Beefy total APY: %s', async (totalApy) => {
    stubFetch({
      [BEEFY_VAULT_ID]: {
        totalApy,
      },
    })

    const result = await createBeefyProvider([source]).fetch(143)

    expect(result).toEqual([])
  })

  it('does not fetch when no Beefy source exists for the active chain', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('$fetch', fetchMock)

    const result = await createBeefyProvider([source]).fetch(1)

    expect(result).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
