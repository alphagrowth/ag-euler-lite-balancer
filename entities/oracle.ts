import { decodeAbiParameters, type Address, type Hex, isHex, toHex } from 'viem'

export type OracleDetailedInfo = {
  oracle: Address
  name: string
  oracleInfo: Hex
}

export type EulerRouterInfo = {
  governor: Address
  fallbackOracle: Address
  fallbackOracleInfo: OracleDetailedInfo
  bases: Address[]
  quotes: Address[]
  resolvedAssets: Address[][]
  resolvedOracles: Address[]
  resolvedOraclesInfo: OracleDetailedInfo[]
}

export type CrossAdapterInfo = {
  base: Address
  cross: Address
  quote: Address
  oracleBaseCross: Address
  oracleCrossQuote: Address
  oracleBaseCrossInfo: OracleDetailedInfo
  oracleCrossQuoteInfo: OracleDetailedInfo
}

export type PythOracleInfo = {
  pyth: Address
  base: Address
  quote: Address
  feedId: Hex
  maxStaleness: bigint
  maxConfWidth: bigint
}

export type PythFeed = {
  pythAddress: Address
  feedId: Hex
}

const ORACLE_DETAILED_INFO_COMPONENTS = [
  { name: 'oracle', type: 'address' },
  { name: 'name', type: 'string' },
  { name: 'oracleInfo', type: 'bytes' },
] as const

const EULER_ROUTER_COMPONENTS = [
  { name: 'governor', type: 'address' },
  { name: 'fallbackOracle', type: 'address' },
  { name: 'fallbackOracleInfo', type: 'tuple', components: ORACLE_DETAILED_INFO_COMPONENTS },
  { name: 'bases', type: 'address[]' },
  { name: 'quotes', type: 'address[]' },
  { name: 'resolvedAssets', type: 'address[][]' },
  { name: 'resolvedOracles', type: 'address[]' },
  { name: 'resolvedOraclesInfo', type: 'tuple[]', components: ORACLE_DETAILED_INFO_COMPONENTS },
] as const

const CROSS_ADAPTER_COMPONENTS = [
  { name: 'base', type: 'address' },
  { name: 'cross', type: 'address' },
  { name: 'quote', type: 'address' },
  { name: 'oracleBaseCross', type: 'address' },
  { name: 'oracleCrossQuote', type: 'address' },
  { name: 'oracleBaseCrossInfo', type: 'tuple', components: ORACLE_DETAILED_INFO_COMPONENTS },
  { name: 'oracleCrossQuoteInfo', type: 'tuple', components: ORACLE_DETAILED_INFO_COMPONENTS },
] as const

const PYTH_ORACLE_COMPONENTS = [
  { name: 'pyth', type: 'address' },
  { name: 'base', type: 'address' },
  { name: 'quote', type: 'address' },
  { name: 'feedId', type: 'bytes32' },
  { name: 'maxStaleness', type: 'uint256' },
  { name: 'maxConfWidth', type: 'uint256' },
] as const

const normalizeHex = (value: Hex | string | Uint8Array): Hex => {
  if (typeof value === 'string') {
    return (isHex(value) ? value : `0x${value}`) as Hex
  }
  return toHex(value)
}

export const decodeEulerRouterInfo = (oracleInfo: Hex | string | Uint8Array): EulerRouterInfo | null => {
  try {
    const [decoded] = decodeAbiParameters(
      [{ type: 'tuple', components: EULER_ROUTER_COMPONENTS }],
      normalizeHex(oracleInfo),
    )
    return decoded as EulerRouterInfo
  }
  catch {
    return null
  }
}

export const decodeCrossAdapterInfo = (oracleInfo: Hex | string | Uint8Array): CrossAdapterInfo | null => {
  try {
    const [decoded] = decodeAbiParameters(
      [{ type: 'tuple', components: CROSS_ADAPTER_COMPONENTS }],
      normalizeHex(oracleInfo),
    )
    return decoded as CrossAdapterInfo
  }
  catch {
    return null
  }
}

export const decodePythOracleInfo = (oracleInfo: Hex | string | Uint8Array): PythOracleInfo | null => {
  try {
    const [decoded] = decodeAbiParameters(
      [{ type: 'tuple', components: PYTH_ORACLE_COMPONENTS }],
      normalizeHex(oracleInfo),
    )
    return decoded as PythOracleInfo
  }
  catch {
    return null
  }
}

export const collectPythFeedIds = (
  oracleInfo: OracleDetailedInfo | null | undefined,
  maxDepth = 3,
): PythFeed[] => {
  const feeds: PythFeed[] = []
  const visited = new Set<string>()

  const visit = (info: OracleDetailedInfo | null | undefined, depth: number) => {
    if (!info || depth > maxDepth) return
    const key = `${info.oracle}-${info.name}-${info.oracleInfo}`
    if (visited.has(key)) return
    visited.add(key)

    if (info.name === 'PythOracle') {
      const decoded = decodePythOracleInfo(info.oracleInfo)
      if (decoded) {
        feeds.push({
          pythAddress: decoded.pyth,
          feedId: normalizeHex(decoded.feedId),
        })
      }
      return
    }

    if (info.name === 'EulerRouter') {
      const decoded = decodeEulerRouterInfo(info.oracleInfo)
      if (!decoded) return
      visit(decoded.fallbackOracleInfo, depth + 1)
      decoded.resolvedOraclesInfo?.forEach(child => visit(child, depth + 1))
      return
    }

    if (info.name === 'CrossAdapter') {
      const decoded = decodeCrossAdapterInfo(info.oracleInfo)
      if (!decoded) return
      visit(decoded.oracleBaseCrossInfo, depth + 1)
      visit(decoded.oracleCrossQuoteInfo, depth + 1)
    }
  }

  visit(oracleInfo, 0)

  const deduped = new Map<string, PythFeed>()
  feeds.forEach((feed) => {
    const key = `${feed.pythAddress.toLowerCase()}:${feed.feedId.toLowerCase()}`
    if (!deduped.has(key)) {
      deduped.set(key, feed)
    }
  })

  return [...deduped.values()]
}
