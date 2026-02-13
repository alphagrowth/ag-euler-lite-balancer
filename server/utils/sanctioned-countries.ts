// Sanctioned countries for server-side geo-gating.
// Keep in sync with entities/constants.ts SANCTIONED_COUNTRIES.
export const SANCTIONED_COUNTRIES: ReadonlySet<string> = new Set([
  'AF', // Afghanistan
  // 'BY', // Belarus
  'CF', // Central African Republic
  'CU', // Cuba
  'KP', // North Korea
  'CD', // DR Congo
  'ET', // Ethiopia
  // 'HK', // Hong Kong
  'IR', // Iran
  'IQ', // Iraq
  'LB', // Lebanon
  'LY', // Libya
  'ML', // Mali
  'MM', // Myanmar
  'NI', // Nicaragua
  'RU', // Russia
  'SO', // Somalia
  'SS', // South Sudan
  'SD', // Sudan
  'SY', // Syria
  // 'UA', // Ukraine (Crimea, Donetsk, Luhansk)
  'VE', // Venezuela
  'YE', // Yemen
  'ZW', // Zimbabwe
])
