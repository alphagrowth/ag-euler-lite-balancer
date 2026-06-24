import type { IntrinsicApySourceConfig } from '~/entities/custom'
import type { IntrinsicApyProvider, IntrinsicApyResult } from '~/entities/intrinsic-apy'

type BeefySource = Extract<IntrinsicApySourceConfig, { provider: 'beefy' }>

type BeefyApyBreakdown = Record<string, {
  totalApy?: number | null
}>

const normalize = (value?: string) => value?.toLowerCase() || ''

const buildSourceUrl = (vaultId: string) =>
  `https://app.beefy.com/vault/${vaultId}`

export const createBeefyProvider = (sources: readonly IntrinsicApySourceConfig[]): IntrinsicApyProvider => {
  const beefySources = sources.filter(
    (s): s is BeefySource => s.provider === 'beefy',
  )

  return {
    name: 'Beefy',

    async fetch(chainId: number): Promise<IntrinsicApyResult[]> {
      const chainSources = beefySources.filter(s => s.chainId === chainId)
      if (!chainSources.length) return []

      const data = await $fetch<BeefyApyBreakdown>('/api/intrinsic-apy/beefy')

      return chainSources.flatMap((source) => {
        const totalApy = data[source.beefyVaultId]?.totalApy
        if (typeof totalApy !== 'number' || !Number.isFinite(totalApy) || totalApy <= 0) return []

        return [{
          address: normalize(source.address),
          info: {
            apy: totalApy * 100,
            provider: 'Beefy',
            source: buildSourceUrl(source.beefyVaultId),
          },
        }]
      })
    },
  }
}
