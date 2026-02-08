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

// SEO defaults for the app (used in nuxt.config.ts).
export const appTitle = 'Euler Lite'
export const appDescription = 'Lightweight interface for Euler Finance lending and borrowing.'

// AppKit (Reown) metadata used for wallet connection UI.
export const appKitMetadata = {
  name: 'Euler Lite',
  description: 'Euler Finance Lite',
  iconPath: '/manifest-img.png',
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
export const oracleChecksRepo: string = 'euler-xyz/oracle-checks' // https://github.com/euler-xyz/oracle-checks

export const onboardingInfo = {
  logoUrl: '/logo.png',
  title: 'The Modular Credit Layer',
  description: 'Lend, borrow and build without limits.',
}

// Toggle Terms of Use signature flow in transactions.
// Modal content lives at: components/entities/operation/AcknowledgeTermsModal.vue
export const enableTermsOfUseSignature = true

// Toggle branded risk curator / capital allocator section in vault overview.
// Set to false for white-label curator deployments where the entity is implicit.
export const enableEntityBrandingDisplay = true

// Toggle vault type chip (governed / ungoverned / escrow / managed) in vault overview.
// Set to false when all vaults share the same governance type.
export const enableVaultTypeDisplay = true

export const enableEarnPage = true
export const enableLendPage = true
