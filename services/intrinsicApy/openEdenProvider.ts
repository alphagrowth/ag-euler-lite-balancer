import { createSimpleProvider } from './createSimpleProvider'
import type { IntrinsicApySourceConfig } from '~/entities/custom'
import type { IntrinsicApyProvider } from '~/entities/intrinsic-apy'

export const createOpenEdenProvider = (sources: readonly IntrinsicApySourceConfig[]): IntrinsicApyProvider =>
  createSimpleProvider({
    providerName: 'OpenEden',
    providerKey: 'openeden',
    extractApy: data => Number((data as { apy?: number }).apy ?? 0),
    sourceUrl: 'https://openeden.com',
  }, sources)
