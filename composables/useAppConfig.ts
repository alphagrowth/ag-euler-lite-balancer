/**
 * Provides app-level configuration derived from environment variables.
 *
 * On the server, reads process.env directly (for SSR or API routes).
 * On the client, reads from window.__APP_CONFIG__ which is injected
 * by server/plugins/app-config.ts via the render:html hook.
 *
 * This avoids runtimeConfig (which is frozen in production) and works
 * with runtime-injected env vars (e.g. Doppler on Railway).
 */

interface AppConfig {
  appTitle: string
  appDescription: string
  pythHermesUrl: string
  appKitProjectId: string
  appUrl: string
  walletScreeningUri: string
  eulerApiUrl: string
  swapApiUrl: string
  priceApiUrl: string
}

const DEFAULTS: AppConfig = {
  appTitle: 'Euler Lite',
  appDescription: 'Lightweight interface for Euler Finance lending and borrowing.',
  pythHermesUrl: 'https://hermes.pyth.network',
  appKitProjectId: '',
  appUrl: '',
  walletScreeningUri: '',
  eulerApiUrl: '',
  swapApiUrl: '',
  priceApiUrl: '',
}

let cached: AppConfig | null = null

function scanEnv(): AppConfig {
  return {
    appTitle: process.env.NUXT_PUBLIC_CONFIG_APP_TITLE || DEFAULTS.appTitle,
    appDescription: process.env.NUXT_PUBLIC_CONFIG_APP_DESCRIPTION || DEFAULTS.appDescription,
    pythHermesUrl: process.env.PYTH_HERMES_URL || DEFAULTS.pythHermesUrl,
    appKitProjectId: process.env.APPKIT_PROJECT_ID || DEFAULTS.appKitProjectId,
    appUrl: process.env.NUXT_PUBLIC_APP_URL || DEFAULTS.appUrl,
    walletScreeningUri: process.env.WALLET_SCREENING_URI || DEFAULTS.walletScreeningUri,
    eulerApiUrl: process.env.EULER_API_URL || DEFAULTS.eulerApiUrl,
    swapApiUrl: process.env.SWAP_API_URL || DEFAULTS.swapApiUrl,
    priceApiUrl: process.env.PRICE_API_URL || DEFAULTS.priceApiUrl,
  }
}

export const useAppConfig = (): AppConfig => {
  if (cached) return cached

  if (import.meta.server) {
    cached = scanEnv()
  } else if (typeof window !== 'undefined' && (window as any).__APP_CONFIG__) {
    cached = (window as any).__APP_CONFIG__
  } else {
    cached = { ...DEFAULTS }
  }

  return cached!
}
