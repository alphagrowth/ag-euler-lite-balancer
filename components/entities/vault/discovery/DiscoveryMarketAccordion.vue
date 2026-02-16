<script setup lang="ts">
import type { MarketGroup, MiniDiagramData, MiniNode, MiniEdge } from '~/entities/lend-discovery'
import type { Vault, BorrowVaultPair } from '~/entities/vault'
import type { AnyVault } from '~/composables/useVaultRegistry'
import { getCurrentLiquidationLTV, isLiquidationLTVRamping, getVaultUtilization } from '~/entities/vault'
import type { VaultCollateralLTV } from '~/entities/vault'
import { getMaxMultiplier, getMaxRoe } from '~/utils/leverage'
import { getEulerLabelEntityLogo, type EulerLabelEntity } from '~/entities/euler/labels'
import { getEntitiesByVault } from '~/composables/useEulerLabels'
import { getAssetLogoUrl } from '~/composables/useTokens'
import { formatCompactUsdValue, formatNumber } from '~/utils/string-utils'
import { nanoToValue } from '~/utils/crypto-utils'
import { formatAssetValue } from '~/services/pricing/priceProvider'

const props = defineProps<{
  markets: MarketGroup[]
}>()

const { withIntrinsicSupplyApy, withIntrinsicBorrowApy } = useIntrinsicApy()
const { getBorrowRewardApy, getSupplyRewardApy, hasSupplyRewards, hasBorrowRewards } = useRewardsApy()
const { products } = useEulerLabels()

const getProductDescription = (market: MarketGroup): string => {
  if (market.source !== 'product') return ''
  return products[market.id]?.description ?? ''
}

// -- Market-level entity display (all risk managers across vaults, deduped) --

const getMarketEntities = (market: MarketGroup): { name: string, logos: string[] } => {
  const seen = new Set<string>()
  const all: EulerLabelEntity[] = []
  for (const v of market.vaults) {
    if (!isVaultType(v)) continue
    for (const entity of getEntitiesByVault(v)) {
      if (seen.has(entity.name)) continue
      seen.add(entity.name)
      all.push(entity)
    }
  }
  if (all.length === 0) return { name: '', logos: [] }
  const name = all.length === 1
    ? all[0].name
    : all.length === 2
      ? `${all[0].name} & ${all[1].name}`
      : `${all[0].name} & others`
  return { name, logos: all.map(e => getEulerLabelEntityLogo(e.logo)) }
}

// -- Type guards --

const isVaultType = (vault: AnyVault): vault is Vault =>
  !('type' in vault) || (vault as { type?: string }).type === undefined

const getVaultAddress = (vault: AnyVault): string =>
  isVaultType(vault) ? vault.address : ('address' in vault ? (vault as { address: string }).address : '')

const getVaultAssetSymbol = (vault: AnyVault): string => {
  if (isVaultType(vault)) return vault.asset.symbol
  if ('asset' in vault && vault.asset && typeof vault.asset === 'object') {
    const asset = vault.asset as unknown as Record<string, unknown>
    if ('symbol' in asset && typeof asset.symbol === 'string') return asset.symbol
  }
  return '?'
}

const getVaultAssetAddress = (vault: AnyVault): string => {
  if (isVaultType(vault)) return vault.asset.address
  if ('asset' in vault && vault.asset && typeof vault.asset === 'object') {
    const asset = vault.asset as unknown as Record<string, unknown>
    if ('address' in asset && typeof asset.address === 'string') return asset.address
  }
  return ''
}

// -- Accordion expand state --

const expandedMarkets = ref<Set<string>>(new Set())

const toggleExpand = (marketId: string) => {
  const next = new Set(expandedMarkets.value)
  if (next.has(marketId)) {
    next.delete(marketId)
    if (selectedCell.value?.marketId === marketId) {
      selectedCell.value = null
    }
    if (selectedMatrixHeader.value?.marketId === marketId) {
      selectedMatrixHeader.value = null
    }
    if (selectedGraphNode.value?.marketId === marketId) {
      selectedGraphNode.value = null
    }
  }
  else {
    next.add(marketId)
  }
  expandedMarkets.value = next
}

const isExpanded = (marketId: string) => expandedMarkets.value.has(marketId)

// -- Expanded view mode (graph vs matrix) --

type ExpandedViewMode = 'graph' | 'matrix'
const expandedViewModes = ref<Map<string, ExpandedViewMode>>(new Map())

const getExpandedView = (marketId: string): ExpandedViewMode =>
  expandedViewModes.value.get(marketId) ?? 'graph'

const setExpandedView = (marketId: string, mode: ExpandedViewMode) => {
  const next = new Map(expandedViewModes.value)
  next.set(marketId, mode)
  expandedViewModes.value = next
  // Clear selections when switching views
  if (mode === 'graph') {
    if (selectedCell.value?.marketId === marketId) {
      selectedCell.value = null
    }
    if (selectedMatrixHeader.value?.marketId === marketId) {
      selectedMatrixHeader.value = null
    }
  }
  else {
    if (selectedGraphNode.value?.marketId === marketId) {
      selectedGraphNode.value = null
    }
  }
}

// -- Per-vault USD values (loaded on expand) --

const vaultUsdCache = ref<Map<string, { supply: string, liquidity: string, supplyUsd: number }>>(new Map())

const loadVaultUsdValues = async (market: MarketGroup) => {
  const vaults = market.vaults.filter(isVaultType)
  const newEntries = new Map(vaultUsdCache.value)

  await Promise.all(
    vaults.map(async (vault) => {
      if (newEntries.has(vault.address)) return
      const supplyPrice = await formatAssetValue(vault.totalAssets, vault, 'off-chain')
      const liquidity = vault.supply >= vault.borrow ? vault.supply - vault.borrow : 0n
      const liquidityPrice = await formatAssetValue(liquidity, vault, 'off-chain')
      newEntries.set(vault.address, {
        supply: supplyPrice.hasPrice ? formatCompactUsdValue(supplyPrice.usdValue) : supplyPrice.display,
        liquidity: liquidityPrice.hasPrice ? formatCompactUsdValue(liquidityPrice.usdValue) : liquidityPrice.display,
        supplyUsd: supplyPrice.hasPrice ? supplyPrice.usdValue : 0,
      })
    }),
  )

  vaultUsdCache.value = newEntries
}

const onToggle = (market: MarketGroup) => {
  const wasExpanded = isExpanded(market.id)
  toggleExpand(market.id)
  if (!wasExpanded) loadVaultUsdValues(market)
}

// -- Vault categorization --

const getBorrowableVaults = (market: MarketGroup): Vault[] =>
  market.vaults.filter(isVaultType).filter(v => v.vaultCategory !== 'escrow' && v.borrowCap > 0n)

const getNonBorrowableMemberVaults = (market: MarketGroup): Vault[] =>
  market.vaults.filter(isVaultType).filter(v => v.vaultCategory === 'escrow' || v.borrowCap === 0n)

const isExternalCollateral = (market: MarketGroup, address: string): boolean => {
  const normalized = address.toLowerCase()
  return market.externalCollateral.some(v => getVaultAddress(v).toLowerCase() === normalized)
}

const getActiveExternalCollateral = (market: MarketGroup): AnyVault[] => {
  const borrowableVaults = getBorrowableVaults(market)
  return market.externalCollateral.filter((ext) => {
    const extAddr = getVaultAddress(ext).toLowerCase()
    return borrowableVaults.some(v =>
      v.collateralLTVs.some(ltv =>
        ltv.collateral.toLowerCase() === extAddr && ltv.liquidationLTV > 0n,
      ),
    )
  })
}

// -- Collateral matrix --

interface MatrixCell {
  ltv: VaultCollateralLTV
}

interface CollateralMatrixData {
  rows: Array<{ address: string, symbol: string, assetAddress: string, category: 'escrow' | 'external' | 'borrowable' }>
  columns: Array<{ address: string, symbol: string, assetAddress: string }>
  cells: Map<string, Map<string, MatrixCell>>
  pairCount: number
}

// -- Mini relationship graph --

const getMiniDiagram = (market: MarketGroup): MiniDiagramData => {
  const vaultByAddr = new Map<string, AnyVault>()
  for (const v of [...market.vaults, ...market.externalCollateral]) {
    const addr = getVaultAddress(v).toLowerCase()
    if (addr) vaultByAddr.set(addr, v)
  }

  const directedEdges = new Set<string>()
  const connectedAddresses = new Set<string>()

  for (const vault of market.vaults) {
    if (!isVaultType(vault)) continue
    for (const ltv of vault.collateralLTVs) {
      if (ltv.borrowLTV <= 0n) continue
      const colAddr = ltv.collateral.toLowerCase()
      if (!vaultByAddr.has(colAddr)) continue
      const liabAddr = vault.address.toLowerCase()
      directedEdges.add(`${colAddr}:${liabAddr}`)
      connectedAddresses.add(colAddr)
      connectedAddresses.add(liabAddr)
    }
  }

  const empty: MiniDiagramData = { nodes: [], edges: [], pairCount: 0, assetCount: 0, viewWidth: 0 }
  if (connectedAddresses.size === 0) return empty

  const connectedVaults = [...connectedAddresses]
  const count = connectedVaults.length
  const baseR = Math.min(24, 10 + count * 2)
  const stretch = count > 6 ? 1.6 : count > 3 ? 1.3 : 1.0
  const rx = baseR * stretch
  const ry = baseR
  const cx = rx + 8
  const cy = 30
  const assetSymbols = new Set<string>()

  const nodes: MiniNode[] = connectedVaults.map((address, i) => {
    const angle = (Math.PI * 2 * i) / Math.max(count, 1) - Math.PI / 2
    const vault = vaultByAddr.get(address)
    const assetSymbol = vault ? getVaultAssetSymbol(vault) : '?'
    const assetAddress = vault ? getVaultAssetAddress(vault) : ''
    assetSymbols.add(assetSymbol)
    return { address, assetAddress, assetSymbol, x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle) }
  })
  const nodeMap = new Map(nodes.map(n => [n.address, n]))

  const seenPairs = new Set<string>()
  const edges: MiniEdge[] = []

  for (const key of directedEdges) {
    const [fromAddr, toAddr] = key.split(':')
    const pairKey = [fromAddr, toAddr].sort().join(':')
    if (seenPairs.has(pairKey)) continue
    seenPairs.add(pairKey)

    const fromNode = nodeMap.get(fromAddr)
    const toNode = nodeMap.get(toAddr)
    if (!fromNode || !toNode) continue

    const reverseExists = directedEdges.has(`${toAddr}:${fromAddr}`)
    edges.push({ from: fromNode, to: toNode, mutual: reverseExists })
  }

  const viewWidth = (cx + rx + 8)
  return { nodes, edges, pairCount: directedEdges.size, assetCount: assetSymbols.size, viewWidth }
}

// -- Metric selector (pair-level metrics, for matrix view) --

type DotMetric = 'bltv' | 'lltv' | 'net-apy' | 'roe' | 'multiplier'

interface DotMetricOption {
  id: DotMetric
  label: string
  higherIsBetter: boolean
}

const DOT_METRIC_OPTIONS: DotMetricOption[] = [
  { id: 'bltv', label: 'Borrow LTV', higherIsBetter: false },
  { id: 'lltv', label: 'Liquidation LTV', higherIsBetter: false },
  { id: 'multiplier', label: 'Multiplier', higherIsBetter: false },
  { id: 'net-apy', label: 'Net APY', higherIsBetter: true },
  { id: 'roe', label: 'Max ROE', higherIsBetter: true },
]

const dotMetric = ref<DotMetric>('bltv')
const metricDropdownOpen = ref(false)

const formatMetricValue = (value: number, metric: DotMetric): string => {
  switch (metric) {
    case 'multiplier':
      return `${formatNumber(value, 1, 1)}x`
    default:
      return `${formatNumber(value, 1, 1)}%`
  }
}

const getCollateralMatrix = (market: MarketGroup): CollateralMatrixData | null => {
  const borrowable = getBorrowableVaults(market)
  const nonBorrowable = getNonBorrowableMemberVaults(market)
  const external = getActiveExternalCollateral(market)

  const knownAddresses = new Set<string>()
  for (const v of [...market.vaults, ...market.externalCollateral]) {
    const addr = getVaultAddress(v).toLowerCase()
    if (addr) knownAddresses.add(addr)
  }

  const cells = new Map<string, Map<string, MatrixCell>>()
  const referencedCollateral = new Set<string>()
  const connectedBorrowable = new Set<string>()
  let pairCount = 0

  for (const vault of borrowable) {
    for (const ltv of vault.collateralLTVs) {
      if (getCurrentLiquidationLTV(ltv) <= 0n) continue
      const colAddr = ltv.collateral.toLowerCase()
      if (!knownAddresses.has(colAddr)) continue

      referencedCollateral.add(colAddr)
      connectedBorrowable.add(vault.address.toLowerCase())
      if (ltv.borrowLTV > 0n) pairCount++

      const colMap = cells.get(colAddr) ?? new Map<string, MatrixCell>()
      colMap.set(vault.address.toLowerCase(), { ltv })
      cells.set(colAddr, colMap)
    }
  }

  if (cells.size === 0) return null

  const rowAvgLTV = (addr: string): number => {
    const rowCells = cells.get(addr)
    if (!rowCells || rowCells.size === 0) return 0
    let sum = 0
    for (const cell of rowCells.values()) sum += Number(nanoToValue(cell.ltv.borrowLTV, 2))
    return sum / rowCells.size
  }

  const colAvgLTV = (addr: string): number => {
    let sum = 0
    let count = 0
    for (const [, rowCells] of cells) {
      const cell = rowCells.get(addr)
      if (cell) {
        sum += Number(nanoToValue(cell.ltv.borrowLTV, 2))
        count++
      }
    }
    return count > 0 ? sum / count : 0
  }

  const combinedAvgLTV = (addr: string): number => (rowAvgLTV(addr) + colAvgLTV(addr)) / 2

  const inBothAxes: Vault[] = []
  const rowOnlyBorrowable: Vault[] = []
  const colOnlyBorrowable: Vault[] = []

  for (const v of borrowable) {
    const addr = v.address.toLowerCase()
    const inRows = referencedCollateral.has(addr)
    const inCols = connectedBorrowable.has(addr)
    if (inRows && inCols) inBothAxes.push(v)
    else if (inRows) rowOnlyBorrowable.push(v)
    else if (inCols) colOnlyBorrowable.push(v)
  }

  const sortedDiagonal = [...inBothAxes].sort((a, b) =>
    combinedAvgLTV(b.address.toLowerCase()) - combinedAvgLTV(a.address.toLowerCase()),
  )
  const sortedRowOnly = [...rowOnlyBorrowable].sort((a, b) =>
    rowAvgLTV(b.address.toLowerCase()) - rowAvgLTV(a.address.toLowerCase()),
  )
  const sortedColOnly = [...colOnlyBorrowable].sort((a, b) =>
    colAvgLTV(b.address.toLowerCase()) - colAvgLTV(a.address.toLowerCase()),
  )

  const rows: CollateralMatrixData['rows'] = []
  const seenRows = new Set<string>()

  const addRow = (addr: string, symbol: string, assetAddress: string, category: CollateralMatrixData['rows'][0]['category']) => {
    if (referencedCollateral.has(addr) && !seenRows.has(addr)) {
      seenRows.add(addr)
      rows.push({ address: addr, symbol, assetAddress, category })
    }
  }

  for (const v of sortedDiagonal) addRow(v.address.toLowerCase(), v.asset.symbol, v.asset.address, 'borrowable')
  for (const v of sortedRowOnly) addRow(v.address.toLowerCase(), v.asset.symbol, v.asset.address, 'borrowable')

  const sortedNonBorrowable = [...nonBorrowable]
    .filter(v => referencedCollateral.has(v.address.toLowerCase()))
    .sort((a, b) => rowAvgLTV(b.address.toLowerCase()) - rowAvgLTV(a.address.toLowerCase()))
  for (const v of sortedNonBorrowable) addRow(v.address.toLowerCase(), v.asset.symbol, v.asset.address, 'escrow')

  const sortedExternal = [...external]
    .filter(v => referencedCollateral.has(getVaultAddress(v).toLowerCase()))
    .sort((a, b) => rowAvgLTV(getVaultAddress(b).toLowerCase()) - rowAvgLTV(getVaultAddress(a).toLowerCase()))
  for (const v of sortedExternal) addRow(getVaultAddress(v).toLowerCase(), getVaultAssetSymbol(v), getVaultAssetAddress(v), 'external')

  const columns: CollateralMatrixData['columns'] = [
    ...sortedDiagonal.map(v => ({ address: v.address.toLowerCase(), symbol: v.asset.symbol, assetAddress: v.asset.address })),
    ...sortedColOnly.map(v => ({ address: v.address.toLowerCase(), symbol: v.asset.symbol, assetAddress: v.asset.address })),
  ]

  return { rows, columns, cells, pairCount }
}

// -- Precomputed matrix map --

const matrixMap = computed((): Map<string, CollateralMatrixData | null> => {
  const result = new Map<string, CollateralMatrixData | null>()
  for (const market of props.markets) {
    result.set(market.id, getCollateralMatrix(market))
  }
  return result
})

// -- Metric range per market (for relative color scales) --

const getMetricRange = (
  matrix: CollateralMatrixData,
  market: MarketGroup,
): { min: number; max: number } => {
  let min = Infinity
  let max = -Infinity
  for (const [rowAddr, cols] of matrix.cells) {
    for (const [colAddr, cell] of cols) {
      const v = getCellMetricValue(cell, rowAddr, colAddr, market)
      if (Number.isFinite(v)) {
        if (v < min) min = v
        if (v > max) max = v
      }
    }
  }
  return Number.isFinite(min) ? { min, max } : { min: 0, max: 0 }
}

const metricRangeMap = computed((): Map<string, { min: number; max: number }> => {
  const result = new Map<string, { min: number; max: number }>()
  for (const market of props.markets) {
    const matrix = matrixMap.value.get(market.id)
    if (matrix) {
      result.set(market.id, getMetricRange(matrix, market))
    }
  }
  return result
})

// -- Vault lookup --

const findVault = (market: MarketGroup, address: string): Vault | null => {
  const normalized = address.toLowerCase()
  for (const v of market.vaults) {
    if (isVaultType(v) && v.address.toLowerCase() === normalized) return v
  }
  for (const v of market.externalCollateral) {
    if (isVaultType(v) && v.address.toLowerCase() === normalized) return v
  }
  return null
}

// -- Enhanced APY computation --

interface EnhancedCellApys {
  supplyApy: number
  borrowApy: number
  netApy: number
  roe: number
  utilization: number
}

const computeEnhancedApys = (cell: MatrixCell, collateralAddr: string, liabilityAddr: string, market: MarketGroup): EnhancedCellApys => {
  const collateral = findVault(market, collateralAddr)
  const liability = findVault(market, liabilityAddr)

  let supplyApy = 0
  let supplyRewards = 0
  if (collateral) {
    const base = nanoToValue(collateral.interestRateInfo.supplyAPY, 25)
    supplyApy = withIntrinsicSupplyApy(base, collateral.asset.symbol)
    supplyRewards = getSupplyRewardApy(collateral.address)
  }

  let borrowApy = 0
  let utilization = 0
  let borrowRewards = 0
  if (liability) {
    const base = nanoToValue(liability.interestRateInfo.borrowAPY, 25)
    borrowApy = withIntrinsicBorrowApy(base, liability.asset.symbol)
    borrowRewards = getBorrowRewardApy(liability.address, collateral?.address)
    utilization = getVaultUtilization(liability)
  }

  const supplyFinal = supplyApy + supplyRewards
  const borrowFinal = borrowApy - borrowRewards
  const netApy = supplyFinal - borrowFinal
  const multiplier = getMaxMultiplier(cell.ltv.borrowLTV)
  const roe = getMaxRoe(multiplier, supplyFinal, borrowFinal)

  return { supplyApy: supplyFinal, borrowApy: borrowFinal, netApy, roe, utilization }
}

// -- Cell metric computation --

const getCellMetricValue = (cell: MatrixCell, collateralAddr: string, liabilityAddr: string, market: MarketGroup): number => {
  const metric = dotMetric.value
  switch (metric) {
    case 'bltv':
      return Number(nanoToValue(cell.ltv.borrowLTV, 2))
    case 'lltv':
      return Number(nanoToValue(getCurrentLiquidationLTV(cell.ltv), 2))
    case 'multiplier':
      return getMaxMultiplier(cell.ltv.borrowLTV)
    case 'net-apy':
      return computeEnhancedApys(cell, collateralAddr, liabilityAddr, market).netApy
    case 'roe':
      return computeEnhancedApys(cell, collateralAddr, liabilityAddr, market).roe
    default:
      return 0
  }
}

// -- Whether a cell should show sparkles (reward-boosted net-apy/roe only) --

const shouldShowSparkles = (market: MarketGroup, collateralAddr: string, liabilityAddr: string): boolean => {
  if (dotMetric.value !== 'net-apy' && dotMetric.value !== 'roe') return false
  const collateral = findVault(market, collateralAddr)
  const liability = findVault(market, liabilityAddr)
  const hasSupplyRewardsForCell = collateral ? hasSupplyRewards(collateral.address) : false
  const hasBorrowRewardsForCell = liability ? hasBorrowRewards(liability.address, collateral?.address) : false
  return hasSupplyRewardsForCell || hasBorrowRewardsForCell
}

// -- Cell gradient coloring --

const getLtvColor = (pct: number): string => {
  const t = Math.max(0, Math.min(100, pct)) / 100
  const alpha = 0.1 + t * 0.2
  if (t < 0.75) {
    const hue = 145 - (t / 0.75) * 100 // green(145) → yellow(45)
    return `hsla(${hue}, 70%, 45%, ${alpha})`
  }
  const hue = 45 - ((t - 0.75) / 0.25) * 45 // yellow(45) → red(0)
  return `hsla(${hue}, 75%, 45%, ${alpha})`
}

const getDivergingColor = (value: number, min: number, max: number): string => {
  if (min >= max || Math.abs(value) < 0.01) return 'transparent'
  if (value > 0) {
    const t = Math.min(value / (max || 1), 1)
    return `hsla(145, 70%, 45%, ${0.08 + t * 0.22})`
  }
  const t = Math.min(Math.abs(value) / (Math.abs(min) || 1), 1)
  return `hsla(0, 75%, 48%, ${0.08 + t * 0.22})`
}

const getCellBgColor = (value: number, metric: DotMetric, min: number, max: number): string => {
  switch (metric) {
    case 'bltv':
    case 'lltv':
      return getLtvColor(value)
    case 'multiplier': {
      // Convert multiplier back to equivalent LTV%: ltv = (1 - 1/multiplier) * 100
      const equivalentLtv = value > 1 ? (1 - 1 / value) * 100 : 0
      return getLtvColor(equivalentLtv)
    }
    case 'net-apy':
    case 'roe':
      return getDivergingColor(value, min, max)
  }
}

// -- Cell selection and hover state (matrix view) --

const hoveredCell = ref<{
  collateralAddr: string
  liabilityAddr: string
} | null>(null)


const selectedCell = ref<{
  marketId: string
  collateralAddr: string
  liabilityAddr: string
} | null>(null)

// -- Matrix header selection state (row = collateral, column = liability) --

const selectedMatrixHeader = ref<{
  marketId: string
  address: string
  axis: 'row' | 'column'
} | null>(null)

const toggleMatrixHeader = (marketId: string, address: string, axis: 'row' | 'column') => {
  if (
    selectedMatrixHeader.value?.marketId === marketId
    && selectedMatrixHeader.value?.address === address
    && selectedMatrixHeader.value?.axis === axis
  ) {
    selectedMatrixHeader.value = null
    return
  }
  selectedMatrixHeader.value = { marketId, address, axis }
  selectedCell.value = null
}

// -- Graph node selection state --

const selectedGraphNode = ref<{
  marketId: string
  address: string
} | null>(null)

const toggleGraphNode = (marketId: string, address: string) => {
  if (selectedGraphNode.value?.marketId === marketId && selectedGraphNode.value?.address === address) {
    selectedGraphNode.value = null
  }
  else {
    selectedGraphNode.value = { marketId, address }
  }
}

// -- Graph: connected addresses for highlighting --

const getGraphConnectedAddresses = (diagram: MiniDiagramData, address: string): Set<string> => {
  const connected = new Set<string>()
  for (const edge of diagram.edges) {
    if (edge.from.address === address) connected.add(edge.to.address)
    if (edge.to.address === address) connected.add(edge.from.address)
  }
  return connected
}

const isGraphNodeHighlighted = (diagram: MiniDiagramData, marketId: string, address: string): boolean => {
  if (!selectedGraphNode.value || selectedGraphNode.value.marketId !== marketId) return true
  const sel = selectedGraphNode.value.address
  return address === sel || getGraphConnectedAddresses(diagram, sel).has(address)
}

const isGraphEdgeHighlighted = (marketId: string, fromAddr: string, toAddr: string): boolean => {
  if (!selectedGraphNode.value || selectedGraphNode.value.marketId !== marketId) return true
  return fromAddr === selectedGraphNode.value.address || toAddr === selectedGraphNode.value.address
}

// -- Enlarged diagram computation (for inline graph view) --

const estimateLabelWidth = (symbol: string): number => symbol.length * 7

const getEnlargedDiagram = (diagram: MiniDiagramData) => {
  const { nodes, edges } = diagram
  const count = nodes.length
  const baseR = Math.min(120, 40 + count * 12)

  // Elliptical layout: wider horizontally to match container aspect ratio
  const stretch = count > 6 ? 1.6 : count > 3 ? 1.3 : 1.0
  const rx = baseR * stretch
  const ry = baseR

  const labelOffset = 20
  const maxLabelWidth = Math.max(...nodes.map(n => estimateLabelWidth(n.assetSymbol)), 0)
  const marginX = rx + labelOffset + maxLabelWidth + 12
  const marginY = ry + labelOffset + 16 + 12

  const cx = marginX
  const cy = marginY
  const viewWidth = marginX * 2
  const viewHeight = marginY * 2
  const nodeRadius = 12

  const enlargedNodes = nodes.map((node, i) => {
    const angle = (Math.PI * 2 * i) / Math.max(count, 1) - Math.PI / 2
    return {
      ...node,
      x: cx + rx * Math.cos(angle),
      y: cy + ry * Math.sin(angle),
    }
  })

  const nodeMap = new Map(enlargedNodes.map(n => [n.address, n]))

  const enlargedEdges = edges.map(edge => ({
    ...edge,
    from: nodeMap.get(edge.from.address)!,
    to: nodeMap.get(edge.to.address)!,
  }))

  return { nodes: enlargedNodes, edges: enlargedEdges, viewWidth, viewHeight, cx, cy, nodeRadius }
}

// -- Arrow helpers (for graph view) --

const ARROW_SIZE = 6

const getArrow = (fromX: number, fromY: number, toX: number, toY: number, nodeR: number) => {
  const dx = toX - fromX
  const dy = toY - fromY
  const dist = Math.sqrt(dx * dx + dy * dy)
  if (dist === 0) return { lineX2: toX, lineY2: toY, triangle: '' }
  const ux = dx / dist
  const uy = dy / dist
  const tipX = toX - ux * nodeR
  const tipY = toY - uy * nodeR
  const baseX = tipX - ux * ARROW_SIZE
  const baseY = tipY - uy * ARROW_SIZE
  const px = -uy * (ARROW_SIZE * 0.5)
  const py = ux * (ARROW_SIZE * 0.5)
  const triangle = `${tipX},${tipY} ${baseX + px},${baseY + py} ${baseX - px},${baseY - py}`
  return { lineX2: baseX, lineY2: baseY, triangle }
}

const getLabelPosition = (node: { x: number, y: number }, cx: number, cy: number) => {
  const dx = node.x - cx
  const dy = node.y - cy
  const dist = Math.sqrt(dx * dx + dy * dy)
  if (dist === 0) return { x: node.x, y: node.y - 22, anchor: 'middle' as const }
  const nx = dx / dist
  const ny = dy / dist
  const offset = 20
  const anchor = nx < -0.3 ? 'end' as const : nx > 0.3 ? 'start' as const : 'middle' as const
  return { x: node.x + nx * offset, y: node.y + ny * offset + 4, anchor }
}

// -- Cell click (matrix view) --

const onCellClick = (marketId: string, collateralAddr: string, liabilityAddr: string) => {
  if (
    selectedCell.value?.marketId === marketId
    && selectedCell.value?.collateralAddr === collateralAddr
    && selectedCell.value?.liabilityAddr === liabilityAddr
  ) {
    selectedCell.value = null
    return
  }

  selectedCell.value = { marketId, collateralAddr, liabilityAddr }
  selectedMatrixHeader.value = null
}

// -- Selected cell vault lookup (matrix view) --

const getSelectedLendVault = (market: MarketGroup): Vault | null => {
  if (!selectedCell.value || selectedCell.value.marketId !== market.id) return null
  return findVault(market, selectedCell.value.liabilityAddr)
}

const getSelectedBorrowPair = (market: MarketGroup): BorrowVaultPair | null => {
  if (!selectedCell.value || selectedCell.value.marketId !== market.id) return null
  const matrix = matrixMap.value.get(market.id)
  if (!matrix) return null
  const cell = matrix.cells.get(selectedCell.value.collateralAddr)?.get(selectedCell.value.liabilityAddr)
  if (!cell) return null
  const collateral = findVault(market, selectedCell.value.collateralAddr)
  const borrow = findVault(market, selectedCell.value.liabilityAddr)
  if (!collateral || !borrow) return null
  return {
    borrow,
    collateral,
    borrowLTV: cell.ltv.borrowLTV,
    liquidationLTV: cell.ltv.liquidationLTV,
    initialLiquidationLTV: cell.ltv.initialLiquidationLTV,
    targetTimestamp: cell.ltv.targetTimestamp,
    rampDuration: cell.ltv.rampDuration,
  }
}

// -- Matrix header → vault cards --

const getMatrixHeaderVault = (market: MarketGroup): Vault | null => {
  if (!selectedMatrixHeader.value || selectedMatrixHeader.value.marketId !== market.id) return null
  return findVault(market, selectedMatrixHeader.value.address)
}

const getMatrixHeaderBorrowPairs = (market: MarketGroup): BorrowVaultPair[] => {
  if (!selectedMatrixHeader.value || selectedMatrixHeader.value.marketId !== market.id) return []
  const matrix = matrixMap.value.get(market.id)
  if (!matrix) return []

  const addr = selectedMatrixHeader.value.address.toLowerCase()
  const pairs: BorrowVaultPair[] = []

  if (selectedMatrixHeader.value.axis === 'column') {
    // Column = liability: find all cells where this vault is the liability
    for (const [collateralAddr, rowCells] of matrix.cells) {
      const cell = rowCells.get(addr)
      if (!cell || cell.ltv.borrowLTV <= 0n) continue
      const collateral = findVault(market, collateralAddr)
      const borrow = findVault(market, addr)
      if (!collateral || !borrow) continue
      pairs.push({
        borrow,
        collateral,
        borrowLTV: cell.ltv.borrowLTV,
        liquidationLTV: cell.ltv.liquidationLTV,
        initialLiquidationLTV: cell.ltv.initialLiquidationLTV,
        targetTimestamp: cell.ltv.targetTimestamp,
        rampDuration: cell.ltv.rampDuration,
      })
    }
  }
  else {
    // Row = collateral: find all cells where this vault is the collateral
    const rowCells = matrix.cells.get(addr)
    if (!rowCells) return []
    for (const [liabilityAddr, cell] of rowCells) {
      if (cell.ltv.borrowLTV <= 0n) continue
      const collateral = findVault(market, addr)
      const borrow = findVault(market, liabilityAddr)
      if (!collateral || !borrow) continue
      pairs.push({
        borrow,
        collateral,
        borrowLTV: cell.ltv.borrowLTV,
        liquidationLTV: cell.ltv.liquidationLTV,
        initialLiquidationLTV: cell.ltv.initialLiquidationLTV,
        targetTimestamp: cell.ltv.targetTimestamp,
        rampDuration: cell.ltv.rampDuration,
      })
    }
  }

  return pairs
}

// -- Graph node → vault cards --

const getGraphSelectedVault = (market: MarketGroup): Vault | null => {
  if (!selectedGraphNode.value || selectedGraphNode.value.marketId !== market.id) return null
  return findVault(market, selectedGraphNode.value.address)
}

const getGraphBorrowPairs = (market: MarketGroup): BorrowVaultPair[] => {
  if (!selectedGraphNode.value || selectedGraphNode.value.marketId !== market.id) return []
  const matrix = matrixMap.value.get(market.id)
  if (!matrix) return []

  const selectedAddr = selectedGraphNode.value.address.toLowerCase()
  const pairs: BorrowVaultPair[] = []

  // Find all cells where the selected node is the liability (column)
  for (const [collateralAddr, rowCells] of matrix.cells) {
    const cell = rowCells.get(selectedAddr)
    if (!cell || cell.ltv.borrowLTV <= 0n) continue
    const collateral = findVault(market, collateralAddr)
    const borrow = findVault(market, selectedAddr)
    if (!collateral || !borrow) continue
    pairs.push({
      borrow,
      collateral,
      borrowLTV: cell.ltv.borrowLTV,
      liquidationLTV: cell.ltv.liquidationLTV,
      initialLiquidationLTV: cell.ltv.initialLiquidationLTV,
      targetTimestamp: cell.ltv.targetTimestamp,
      rampDuration: cell.ltv.rampDuration,
    })
  }

  return pairs
}

// -- Has any selection for a market (drives card section visibility) --

const hasSelection = (market: MarketGroup): boolean => {
  const view = getExpandedView(market.id)
  if (view === 'matrix') {
    return (!!selectedCell.value && selectedCell.value.marketId === market.id)
      || (!!selectedMatrixHeader.value && selectedMatrixHeader.value.marketId === market.id)
  }
  return !!selectedGraphNode.value && selectedGraphNode.value.marketId === market.id
}

// -- Global event handlers --

onMounted(() => {
  const onClick = () => {
    metricDropdownOpen.value = false
  }
  window.addEventListener('click', onClick)
  onUnmounted(() => {
    window.removeEventListener('click', onClick)
  })
})
</script>

<template>
  <div class="flex flex-col gap-8">
    <article
      v-for="market in markets"
      :key="market.id"
      class="bg-surface rounded-12 border border-line-default shadow-card transition-all"
      :class="isExpanded(market.id) ? 'shadow-card-hover border-line-emphasis' : 'hover:shadow-card-hover hover:border-line-emphasis'"
    >
      <!-- Collapsed Row Card -->
      <button
        class="w-full text-left cursor-pointer p-16"
        @click="onToggle(market)"
      >
        <div class="flex pb-12 border-b border-line-subtle">
          <template v-for="marketEntities in [getMarketEntities(market)]" :key="'entities-' + market.id">
            <BaseAvatar
              v-if="marketEntities.logos.length > 0"
              class="icon--40 shrink-0"
              :src="marketEntities.logos"
              :label="marketEntities.name"
            />
            <div
              class="flex-grow min-w-0"
              :class="marketEntities.logos.length > 0 ? 'ml-12' : ''"
            >
              <div class="text-content-tertiary text-p3 mb-4 flex items-center gap-8">
                <template v-if="marketEntities.name">{{ marketEntities.name }}</template>
                <template v-else-if="market.curator">{{ market.curator.name }}</template>
                <template v-else>Ungrouped</template>
              <span
                v-if="market.metrics.hasFeatured"
                class="inline-flex items-center gap-4 rounded-8 px-8 py-2 bg-accent-100 text-accent-600 text-p5"
              >
                <SvgIcon name="star" class="!w-14 !h-14" />
                Featured
              </span>
            </div>
            <div class="text-h5 text-content-primary">
              {{ market.name }}
            </div>
            </div>
          </template>
          <template v-for="diagram in [getMiniDiagram(market)]" :key="'counts-' + market.id">
            <div class="flex flex-col items-end shrink-0 ml-12 text-content-tertiary text-p3">
              <span>{{ diagram.assetCount }} assets</span>
              <span class="text-content-muted">{{ diagram.pairCount }} pairs</span>
            </div>
          </template>
        </div>

        <div class="flex pt-12 items-center gap-32 mobile:flex-wrap mobile:gap-y-12">
          <div class="flex-1 flex justify-between gap-12 mobile:flex-wrap mobile:gap-y-12">
            <div>
              <div class="text-content-tertiary text-p3 mb-4">Total supply</div>
              <div class="text-p2 text-content-primary">
                {{ formatCompactUsdValue(market.metrics.totalTVL) }}
              </div>
            </div>
            <div>
              <div class="text-content-tertiary text-p3 mb-4">Total borrowed</div>
              <div class="text-p2 text-content-primary">
                {{ formatCompactUsdValue(market.metrics.totalBorrowed) }}
              </div>
            </div>
            <div>
              <div class="text-content-tertiary text-p3 mb-4">Available liquidity</div>
              <div class="text-p2 text-content-primary">
                {{ formatCompactUsdValue(market.metrics.totalAvailableLiquidity) }}
              </div>
            </div>
          </div>

          <!-- Mini topology graph (non-clickable preview) -->
          <template v-for="diagram in [getMiniDiagram(market)]" :key="'graph-' + market.id">
            <div
              v-if="diagram.nodes.length > 1"
              class="shrink-0 w-[180px] h-[60px] hidden sm:flex items-center justify-end"
            >
            <svg
              class="h-[60px]"
              :style="{ width: `${diagram.viewWidth}px` }"
              :viewBox="`0 0 ${diagram.viewWidth} 60`"
              xmlns="http://www.w3.org/2000/svg"
            >
              <line
                v-for="(edge, idx) in diagram.edges"
                :key="`e-${idx}`"
                :x1="edge.from.x"
                :y1="edge.from.y"
                :x2="edge.to.x"
                :y2="edge.to.y"
                :stroke="edge.mutual ? '#6b7280' : '#4b5563'"
                :stroke-width="edge.mutual ? 1.2 : 1"
                stroke-linecap="round"
                :opacity="edge.mutual ? 0.8 : 0.5"
              />
              <g
                v-for="node in diagram.nodes"
                :key="node.address"
              >
                <clipPath :id="`clip-${market.id}-${node.address}`">
                  <circle :cx="node.x" :cy="node.y" r="6" />
                </clipPath>
                <circle
                  :cx="node.x"
                  :cy="node.y"
                  r="6"
                  fill="#1f2937"
                  stroke="#4b5563"
                  stroke-width="0.5"
                />
                <image
                  :x="node.x - 6"
                  :y="node.y - 6"
                  width="12"
                  height="12"
                  :href="getAssetLogoUrl(node.assetAddress, node.assetSymbol)"
                  :clip-path="`url(#clip-${market.id}-${node.address})`"
                />
              </g>
            </svg>
            </div>
          </template>
        </div>
      </button>

      <!-- Expanded Content -->
      <template v-if="isExpanded(market.id)">
        <template v-for="matrix in [matrixMap.get(market.id)]" :key="'matrix-' + market.id">
          <div
            v-if="matrix"
            class="border-t border-line-subtle"
          >
            <!-- Product description -->
            <div
              v-if="getProductDescription(market)"
              class="mx-16 mt-16 px-16 py-14 rounded-12 bg-surface-secondary border border-line-subtle"
            >
              <p class="text-p2 text-content-secondary leading-relaxed">
                {{ getProductDescription(market) }}
              </p>
            </div>

            <!-- Controls: view toggle + metric dropdown (matrix only) -->
            <div class="px-16 pt-12 pb-8 flex flex-wrap items-center gap-8">
              <!-- Graph / Matrix toggle -->
              <div class="flex rounded-[100px] border border-line-default overflow-hidden">
                <button
                  class="flex items-center gap-4 min-h-36 py-6 px-12 cursor-pointer transition-all text-p3"
                  :class="getExpandedView(market.id) === 'graph'
                    ? 'bg-accent-300/20 text-accent-700 font-medium'
                    : 'bg-surface text-content-secondary hover:bg-surface-secondary'"
                  @click.stop="setExpandedView(market.id, 'graph')"
                >
                  <UiIcon name="nodes" class="!w-14 !h-14" />
                  Graph
                </button>
                <button
                  class="flex items-center gap-4 min-h-36 py-6 px-12 cursor-pointer transition-all text-p3 border-l border-line-default"
                  :class="getExpandedView(market.id) === 'matrix'
                    ? 'bg-accent-300/20 text-accent-700 font-medium'
                    : 'bg-surface text-content-secondary hover:bg-surface-secondary'"
                  @click.stop="setExpandedView(market.id, 'matrix')"
                >
                  <UiIcon name="grid" class="!w-14 !h-14" />
                  Matrix
                </button>
              </div>

              <!-- Metric dropdown (matrix view only) -->
              <div v-if="getExpandedView(market.id) === 'matrix'" class="relative">
                <div
                  class="ui-select__field"
                  @click.stop="metricDropdownOpen = !metricDropdownOpen"
                >
                  <UiIcon name="filter" class="ui-select__icon" />
                  <span class="ui-select__text">{{ DOT_METRIC_OPTIONS.find(o => o.id === dotMetric)?.label }}</span>
                  <UiIcon
                    name="arrow-down"
                    class="ui-select__arrow"
                    :style="metricDropdownOpen ? 'transform: rotate(180deg)' : ''"
                  />
                </div>
                <div
                  v-if="metricDropdownOpen"
                  class="absolute left-0 top-full mt-4 z-30 bg-surface border border-line-default rounded-12 shadow-card py-4 min-w-[160px]"
                >
                  <button
                    v-for="option in DOT_METRIC_OPTIONS"
                    :key="option.id"
                    class="w-full text-left px-14 py-6 text-p3 cursor-pointer transition-colors"
                    :class="dotMetric === option.id
                      ? 'text-accent-700 bg-accent-300/20 font-medium'
                      : 'text-content-secondary hover:bg-surface-secondary'"
                    @click.stop="dotMetric = option.id; metricDropdownOpen = false"
                  >
                    {{ option.label }}
                  </button>
                </div>
              </div>
            </div>

            <!-- ===== GRAPH VIEW ===== -->
            <template v-if="getExpandedView(market.id) === 'graph'">
              <template v-for="diagram in [getMiniDiagram(market)]" :key="'enlarged-' + market.id">
                <template v-for="enlarged in [getEnlargedDiagram(diagram)]" :key="'edata-' + market.id">
                  <div class="px-16 pb-12 flex items-center justify-center">
                    <svg
                      class="h-auto max-w-full"
                      :style="{ width: `${Math.min(enlarged.viewWidth * 1.5, 900)}px` }"
                      :viewBox="`0 0 ${enlarged.viewWidth} ${enlarged.viewHeight}`"
                      xmlns="http://www.w3.org/2000/svg"
                      @click.self="selectedGraphNode = null"
                    >
                      <!-- Edges -->
                      <template
                        v-for="(edge, idx) in enlarged.edges"
                        :key="`edge-${idx}`"
                      >
                        <!-- Highlighted + selected: show directed arrows in accent color -->
                        <template v-if="selectedGraphNode?.marketId === market.id && isGraphEdgeHighlighted(market.id, edge.from.address, edge.to.address)">
                          <line
                            :x1="edge.from.x"
                            :y1="edge.from.y"
                            :x2="getArrow(edge.from.x, edge.from.y, edge.to.x, edge.to.y, enlarged.nodeRadius).lineX2"
                            :y2="getArrow(edge.from.x, edge.from.y, edge.to.x, edge.to.y, enlarged.nodeRadius).lineY2"
                            style="stroke: var(--accent-500)"
                            :stroke-width="0.8"
                            stroke-linecap="round"
                            opacity="0.9"
                          />
                          <polygon
                            :points="getArrow(edge.from.x, edge.from.y, edge.to.x, edge.to.y, enlarged.nodeRadius).triangle"
                            style="fill: var(--accent-500)"
                            opacity="0.9"
                          />
                          <template v-if="edge.mutual">
                            <line
                              :x1="edge.to.x"
                              :y1="edge.to.y"
                              :x2="getArrow(edge.to.x, edge.to.y, edge.from.x, edge.from.y, enlarged.nodeRadius).lineX2"
                              :y2="getArrow(edge.to.x, edge.to.y, edge.from.x, edge.from.y, enlarged.nodeRadius).lineY2"
                              style="stroke: var(--accent-500)"
                              :stroke-width="0.8"
                              stroke-linecap="round"
                              opacity="0.9"
                            />
                            <polygon
                              :points="getArrow(edge.to.x, edge.to.y, edge.from.x, edge.from.y, enlarged.nodeRadius).triangle"
                              style="fill: var(--accent-500)"
                              opacity="0.9"
                            />
                          </template>
                        </template>
                        <!-- Default state or dimmed -->
                        <line
                          v-else
                          :x1="edge.from.x"
                          :y1="edge.from.y"
                          :x2="edge.to.x"
                          :y2="edge.to.y"
                          :stroke="edge.mutual ? '#9ca3af' : '#6b7280'"
                          :stroke-width="edge.mutual ? 1.0 : 0.5"
                          stroke-linecap="round"
                          :opacity="selectedGraphNode?.marketId === market.id ? 0.15 : (edge.mutual ? 0.9 : 0.5)"
                          style="transition: opacity 0.2s, stroke 0.2s"
                        />
                      </template>

                      <!-- Nodes -->
                      <g
                        v-for="node in enlarged.nodes"
                        :key="node.address"
                        class="cursor-pointer"
                        :opacity="isGraphNodeHighlighted(diagram, market.id, node.address) ? 1 : 0.25"
                        style="transition: opacity 0.2s"
                        @click.stop="toggleGraphNode(market.id, node.address)"
                      >
                        <clipPath :id="`graph-clip-${market.id}-${node.address}`">
                          <circle :cx="node.x" :cy="node.y" r="12" />
                        </clipPath>
                        <circle
                          :cx="node.x"
                          :cy="node.y"
                          r="12"
                          fill="#1f2937"
                          stroke="#4b5563"
                          stroke-width="1"
                        />
                        <image
                          :x="node.x - 12"
                          :y="node.y - 12"
                          width="24"
                          height="24"
                          :href="getAssetLogoUrl(node.assetAddress, node.assetSymbol)"
                          :clip-path="`url(#graph-clip-${market.id}-${node.address})`"
                        />
                        <!-- Asset label -->
                        <text
                          :x="getLabelPosition(node, enlarged.cx, enlarged.cy).x"
                          :y="getLabelPosition(node, enlarged.cx, enlarged.cy).y"
                          :text-anchor="getLabelPosition(node, enlarged.cx, enlarged.cy).anchor"
                          class="fill-current"
                          :class="isExternalCollateral(market, node.address) ? 'text-content-tertiary' : 'text-content-primary'"
                          font-size="12"
                          font-weight="500"
                        >
                          {{ node.assetSymbol }}
                        </text>
                      </g>
                    </svg>
                  </div>

                  <!-- Graph info -->
                  <div class="flex justify-center gap-16 text-p3 text-content-tertiary pb-8">
                    <span>{{ diagram.assetCount }} assets</span>
                    <span>{{ diagram.pairCount }} pairs</span>
                  </div>

                  <p class="text-p4 text-content-muted text-center leading-relaxed px-16 pb-12">
                    Tap a node to highlight connections and see lending/borrowing options below.
                  </p>
                </template>
              </template>
            </template>

            <!-- ===== MATRIX VIEW ===== -->
            <template v-else>
              <div class="px-16 pb-12 flex items-center justify-center">
                <div class="relative max-h-[50vh] overflow-auto rounded-8 border border-line-subtle p-12">
                  <table class="border-collapse">
                    <thead class="sticky top-0 z-20 bg-surface">
                      <tr>
                        <th class="text-left text-p5 text-content-muted font-normal py-6 pr-10 pl-6 sticky left-0 bg-surface z-30 border-b border-r border-white/[0.04]">
                          <div class="flex flex-col leading-tight">
                            <span>Liability &#8594;</span>
                            <span>Collateral &#8595;</span>
                          </div>
                        </th>
                        <th
                          v-for="col in matrix.columns"
                          :key="col.address"
                          class="text-center text-p4 font-medium py-6 px-8 whitespace-nowrap border-b border-r border-white/[0.04] cursor-pointer transition-colors"
                          :class="selectedMatrixHeader?.address === col.address && selectedMatrixHeader?.axis === 'column' && selectedMatrixHeader?.marketId === market.id
                            ? 'text-accent-500 !bg-accent-500/10'
                            : 'text-content-primary hover:bg-white/[0.04]'"
                          @click.stop="toggleMatrixHeader(market.id, col.address, 'column')"
                        >
                          <div class="flex flex-col items-center gap-2">
                            <BaseAvatar
                              class="icon--16"
                              :src="getAssetLogoUrl(col.assetAddress, col.symbol)"
                              :label="col.symbol"
                            />
                            {{ col.symbol }}
                          </div>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr
                        v-for="row in matrix.rows"
                        :key="row.address"
                      >
                        <td
                          class="text-p4 py-6 pr-10 pl-6 whitespace-nowrap sticky left-0 z-10 bg-surface border-b border-r border-white/[0.04] cursor-pointer transition-colors"
                          :class="selectedMatrixHeader?.address === row.address && selectedMatrixHeader?.axis === 'row' && selectedMatrixHeader?.marketId === market.id
                            ? 'text-accent-500 !bg-accent-500/10'
                            : row.category === 'external' ? 'text-content-tertiary hover:bg-white/[0.04]' : 'text-content-primary hover:bg-white/[0.04]'"
                          @click.stop="toggleMatrixHeader(market.id, row.address, 'row')"
                        >
                          <div class="flex items-center gap-4">
                            <BaseAvatar
                              class="icon--16 shrink-0"
                              :src="getAssetLogoUrl(row.assetAddress, row.symbol)"
                              :label="row.symbol"
                            />
                            {{ row.symbol }}
                          </div>
                        </td>
                        <td
                          v-for="col in matrix.columns"
                          :key="col.address"
                          class="text-center py-6 px-8 min-w-[56px] transition-colors border-b border-r border-white/[0.04]"
                          :class="[
                            selectedCell?.collateralAddr === row.address && selectedCell?.liabilityAddr === col.address
                              ? '!bg-accent-500/20'
                              : row.address === col.address
                                ? 'bg-white/[0.03]'
                                : '',
                            matrix.cells.get(row.address)?.get(col.address) ? 'cursor-pointer hover:bg-white/[0.06]' : '',
                          ]"
                          :style="(() => {
                            const cell = matrix.cells.get(row.address)?.get(col.address)
                            if (!cell) return undefined
                            if (selectedCell?.collateralAddr === row.address && selectedCell?.liabilityAddr === col.address) return undefined
                            if (row.address === col.address) return undefined
                            const range = metricRangeMap.get(market.id)
                            if (!range) return undefined
                            const val = getCellMetricValue(cell, row.address, col.address, market)
                            return { backgroundColor: getCellBgColor(val, dotMetric, range.min, range.max) }
                          })()"
                          @mouseenter="matrix.cells.get(row.address)?.get(col.address) && (hoveredCell = { collateralAddr: row.address, liabilityAddr: col.address })"
                          @mouseleave="hoveredCell = null"
                          @click.stop="matrix.cells.get(row.address)?.get(col.address) && onCellClick(market.id, row.address, col.address)"
                        >
                          <template v-if="matrix.cells.get(row.address)?.get(col.address)">
                            <div class="inline-flex items-center justify-center gap-2">
                              <SvgIcon
                                v-if="dotMetric === 'lltv' && isLiquidationLTVRamping(matrix.cells.get(row.address)!.get(col.address)!.ltv)"
                                name="arrow-top-right"
                                class="!w-10 !h-10 text-warning-500 shrink-0 rotate-180"
                                title="Liquidation LTV ramping down"
                              />
                              <SvgIcon
                                v-if="shouldShowSparkles(market, row.address, col.address)"
                                name="sparks"
                                class="!w-10 !h-10 text-accent-500 shrink-0"
                              />
                              <span
                                class="text-p5 whitespace-nowrap transition-all"
                                :class="[
                                  selectedCell?.collateralAddr === row.address && selectedCell?.liabilityAddr === col.address
                                    ? 'text-accent-500 font-semibold'
                                    : hoveredCell?.collateralAddr === row.address && hoveredCell?.liabilityAddr === col.address
                                      ? 'text-content-primary font-medium'
                                      : 'text-content-secondary',
                                ]"
                              >
                                {{ formatMetricValue(getCellMetricValue(matrix.cells.get(row.address)!.get(col.address)!, row.address, col.address, market), dotMetric) }}
                              </span>
                            </div>
                          </template>
                        </td>
                      </tr>
                    </tbody>
                  </table>

                </div>
              </div>

              <p class="text-p4 text-content-muted text-center leading-relaxed px-16 pb-12">
                Tap a cell, row, or column header to see lending/borrowing options below.
              </p>
            </template>

            <!-- ===== VAULT CARDS (below visualization, both views) ===== -->
            <div
              v-if="hasSelection(market)"
              class="border-t border-line-subtle px-16 py-12"
            >
              <div
                class="rounded-12 border border-accent-500/20 bg-accent-500/[0.04] p-12"
              >
              <!-- Matrix view: cell selection cards -->
              <template v-if="getExpandedView(market.id) === 'matrix'">
                <!-- Header selection: lend card + multiple borrow pairs -->
                <template v-if="selectedMatrixHeader?.marketId === market.id">
                  <div class="flex flex-col gap-12">
                    <template v-for="vault in [getMatrixHeaderVault(market)]" :key="'header-lend-' + market.id">
                      <template v-if="vault">
                        <h4 class="text-p3 font-medium text-content-secondary">Lend</h4>
                        <VaultItem :vault="vault" />
                      </template>
                    </template>

                    <template v-if="getMatrixHeaderBorrowPairs(market).length">
                      <h4 class="text-p3 font-medium text-content-secondary">Borrow</h4>
                    </template>
                    <template v-for="pair in getMatrixHeaderBorrowPairs(market)" :key="`header-borrow-${pair.collateral.address}-${pair.borrow.address}`">
                      <VaultBorrowItem :pair="pair" />
                    </template>
                  </div>
                </template>

                <!-- Cell selection: single lend + single borrow card -->
                <template v-else>
                  <div class="flex flex-col gap-12">
                    <template v-for="lendVault in [getSelectedLendVault(market)]" :key="'lend-' + market.id">
                      <template v-if="lendVault">
                        <h4 class="text-p3 font-medium text-content-secondary">Lend</h4>
                        <VaultItem :vault="lendVault" />
                      </template>
                    </template>

                    <template v-for="pair in [getSelectedBorrowPair(market)]" :key="'borrow-' + market.id">
                      <template v-if="pair">
                        <h4 class="text-p3 font-medium text-content-secondary">Borrow</h4>
                        <VaultBorrowItem :pair="pair" />
                      </template>
                    </template>
                  </div>
                </template>
              </template>

              <!-- Graph view: node selection cards -->
              <template v-else>
                <div class="flex flex-col gap-12">
                  <!-- Lend card for selected node -->
                  <template v-for="vault in [getGraphSelectedVault(market)]" :key="'graph-lend-' + market.id">
                    <template v-if="vault">
                      <h4 class="text-p3 font-medium text-content-secondary">Lend</h4>
                      <VaultItem :vault="vault" />
                    </template>
                  </template>

                  <!-- Borrow pair cards where selected node is the liability -->
                  <template v-if="getGraphBorrowPairs(market).length">
                    <h4 class="text-p3 font-medium text-content-secondary">Borrow</h4>
                  </template>
                  <template v-for="pair in getGraphBorrowPairs(market)" :key="`graph-borrow-${pair.collateral.address}-${pair.borrow.address}`">
                    <VaultBorrowItem :pair="pair" />
                  </template>
                </div>
              </template>
              </div>
            </div>
          </div>
        </template>
      </template>
    </article>
  </div>
</template>
