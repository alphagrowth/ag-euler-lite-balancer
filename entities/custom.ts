// Base hue for the app theme in degrees (0-360). Change to shift the brand palette.
export const themeHue = 150

// Intrinsic APY sources (data mapping, not deployment config)
export const intrinsicApySources = [
  { symbol: 'steth', project: 'lido' },
  { symbol: 'wsteth', sourceSymbol: 'steth', project: 'lido' },
  { symbol: 'reth', project: 'rocket-pool' },
  { symbol: 'cbeth', project: 'coinbase-wrapped-staked-eth' },
  { symbol: 'sfrxeth', project: 'frax-ether' },
  { symbol: 'sweth', project: 'swell-liquid-staking' },
  { symbol: 'weeth', project: 'ether.fi-stake' },
  { symbol: 'ezeth', project: 'renzo' },
  { symbol: 'ethx', project: 'stader' },
  { symbol: 'oseth', project: 'stakewise-v2' },
  { symbol: 'ankreth', project: 'ankr' },
] as const
