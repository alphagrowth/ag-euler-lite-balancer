export const links = [
  {
    title: 'Docs',
    url: 'https://github.com/',
  },
  {
    title: 'Terms of Use',
    url: 'https://github.com/',
  },
] as const

export const socials = {
  x: 'https://x.com/',
  discord: 'https://discord.com/',
  telegram: 'https://t.me/',
  github: 'https://github.com/',
} as const

// Base hue for the app theme in degrees (0-360). Change to shift the brand palette.
export const themeHue = 150

export const enableIntrinsicApy = true // defillama
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

export const availableNetworkIds = [
  1,
  42161,
  8453,
  1923,
  146,
  60808,
  80094,
  43114,
  56,
  130,
  239,
  59144,
  9745,
  143,
] as const

export const labelsRepo: string = 'euler-xyz/euler-labels' // https://github.com/euler-xyz/euler-labels
