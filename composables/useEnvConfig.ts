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

interface EnvConfig {
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

const DEFAULTS: EnvConfig = {
  appTitle: 'Euler Lite',
  appDescription: 'Lightweight interface for Euler Finance lending and borrowing.',
  pythHermesUrl: '',
  appKitProjectId: '',
  appUrl: '',
  walletScreeningUri: '',
  eulerApiUrl: '',
  swapApiUrl: '',
  priceApiUrl: '',
}

let cached: EnvConfig | null = null

function env(key: string, ...fallbackKeys: string[]): string {
  for (const k of [key, ...fallbackKeys]) {
    if (process.env[k]) return process.env[k]!
  }
  return ''
}

function scanEnv(): EnvConfig {
  return {
    appTitle: env('APP_TITLE', 'NUXT_PUBLIC_CONFIG_APP_TITLE') || DEFAULTS.appTitle,
    appDescription: env('APP_DESCRIPTION', 'NUXT_PUBLIC_CONFIG_APP_DESCRIPTION') || DEFAULTS.appDescription,
    pythHermesUrl: env('PYTH_HERMES_URL', 'NUXT_PUBLIC_PYTH_HERMES_URL') || DEFAULTS.pythHermesUrl,
    appKitProjectId: env('APPKIT_PROJECT_ID', 'NUXT_PUBLIC_APP_KIT_PROJECT_ID') || DEFAULTS.appKitProjectId,
    appUrl: env('NUXT_PUBLIC_APP_URL') || DEFAULTS.appUrl,
    walletScreeningUri: env('WALLET_SCREENING_URI', 'NUXT_PUBLIC_WALLET_SCREENING_URI') || DEFAULTS.walletScreeningUri,
    eulerApiUrl: env('EULER_API_URL', 'NUXT_PUBLIC_EULER_API_URL') || DEFAULTS.eulerApiUrl,
    swapApiUrl: env('SWAP_API_URL', 'NUXT_PUBLIC_SWAP_API_URL') || DEFAULTS.swapApiUrl,
    priceApiUrl: env('PRICE_API_URL', 'NUXT_PUBLIC_PRICE_API_URL') || DEFAULTS.priceApiUrl,
  }
}

export const useEnvConfig = (): EnvConfig => {
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
