import { getAddress } from 'viem'
import { describe, expect, it } from 'vitest'
import { ZAP_POOLS } from '~/composables/useLoopZap'

const AUSD = getAddress('0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a')
const BEEFY_VAULT = getAddress('0xf18f3bc9440ad7940e6e2a86fd0c724add2dd0aa')
const RAW_MOO_TOKEN = getAddress('0xd0331a023c35514c2ef99eb34ed868737e9dcea3')
const WRAPPED_MOO_TOKEN = getAddress('0x6e58131ea11ed990d4b62476529cf2502fe0ec5f')

describe('zap collateral routes', () => {
  it('adds Beefy AUSD to raw mooToken through Enso', () => {
    const route = ZAP_POOLS.find(pool => pool.id === 'beefy-usdt0-ausd-usdc')

    expect(route).toBeDefined()
    expect(route?.routeType).toBe('enso')
    expect(getAddress(route!.collateralVault)).toBe(BEEFY_VAULT)
    expect(route?.inputTokens).toHaveLength(1)
    expect(getAddress(route!.inputTokens[0].address)).toBe(AUSD)
    expect(route?.inputTokens[0].symbol).toBe('AUSD')
    expect(route?.inputTokens[0].decimals).toBe(6)
    expect(getAddress(route!.outputToken.address)).toBe(RAW_MOO_TOKEN)
    expect(getAddress(route!.outputToken.address)).not.toBe(WRAPPED_MOO_TOKEN)
    expect(route?.outputToken.decimals).toBe(18)
  })

  it('keeps the existing Balancer routes targeting BPT outputs', () => {
    const expectedOutputs = new Map([
      ['pool1', getAddress('0x2DAA146dfB7EAef0038F9F15B2EC1e4DE003f72b')],
      ['pool2', getAddress('0x02b34a02db24179Ac2D77Ae20AA6215C7153E7f8')],
      ['pool3', getAddress('0x340Fa62AE58e90473da64b0af622cdd6113106Cb')],
    ])

    for (const [id, output] of expectedOutputs) {
      const route = ZAP_POOLS.find(pool => pool.id === id)

      expect(route).toBeDefined()
      expect(route?.routeType).toBe('enso')
      expect(getAddress(route!.outputToken.address)).toBe(output)
      expect(route?.outputToken.symbol).toBe('BPT')
      expect(route?.outputToken.decimals).toBe(18)
    }
  })
})
