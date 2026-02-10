// https://nuxt.com/docs/api/configuration/nuxt-config

// Derive enabled chains from RPC_URL_HTTP_* env vars
const enabledChainIds = Object.keys(process.env)
  .filter(k => /^RPC_URL_HTTP_\d+$/.test(k) && process.env[k])
  .map(k => Number(k.replace('RPC_URL_HTTP_', '')))

// Collect subgraph URIs from NUXT_PUBLIC_SUBGRAPH_URI_*
const subgraphUris: Record<string, string> = {}
for (const [key, value] of Object.entries(process.env)) {
  const match = key.match(/^NUXT_PUBLIC_SUBGRAPH_URI_(\d+)$/)
  if (match && value) {
    subgraphUris[match[1]] = value
  }
}

// Validate: each RPC chain must have a subgraph
for (const chainId of enabledChainIds) {
  if (!subgraphUris[String(chainId)]) {
    console.error(`[config] Chain ${chainId} has RPC_URL_HTTP_${chainId} but no NUXT_PUBLIC_SUBGRAPH_URI_${chainId}`)
  }
}

const appTitle = process.env.NUXT_PUBLIC_CONFIG_APP_TITLE || process.env.CONFIG_APP_TITLE || 'Euler Lite'
const appDescription = process.env.NUXT_PUBLIC_CONFIG_APP_DESCRIPTION || process.env.CONFIG_APP_DESCRIPTION || 'Lightweight interface for Euler Finance lending and borrowing.'

const cspHeaderValue = `default-src 'self'; script-src 'unsafe-inline' 'wasm-unsafe-eval' 'self' https://static.cloudflareinsights.com; style-src 'unsafe-inline' 'self'; object-src 'none'; base-uri 'self'; connect-src 'self' https://indexer.euler.finance https://swap.euler.finance https://swap-dev.euler.finance https://api.merkl.xyz https://incentra-prd.brevis.network https://hermes.pyth.network https://raw.githubusercontent.com https://oracle-checks-data.euler.finance https://data.euler.finance https://rpc.walletconnect.org https://api.web3modal.org https://explorer-api.walletconnect.com https://verify.walletconnect.org https://pulse.walletconnect.org https://rpc.monad.xyz https://chain-proxy.wallet.coinbase.com https://cca-lite.coinbase.com https://yields.llama.fi https://rpc.plasma.to https://registry.npmjs.org https://*.quiknode.pro https://*.alchemy.com https://*.ankr.com https://*.goldsky.com wss://www.walletlink.org wss://relay.walletconnect.com wss://relay.walletconnect.org; font-src 'self' https://fonts.reown.com; frame-src 'self' https://verify.walletconnect.org https://verify.walletconnect.com; img-src 'self' data: blob: https://raw.githubusercontent.com https://storage.googleapis.com https://token-images.euler.finance; manifest-src 'self'; media-src 'self'; worker-src 'self' blob:; form-action 'self';`

export default defineNuxtConfig({
  modules: ['@nuxtjs/tailwindcss', '@nuxt/eslint', '@gvade/nuxt3-svg-sprite', '@vueuse/nuxt'],
  ssr: false,

  components: [
    {
      path: '~/components',
      pathPrefix: false,
    },
  ],
  devtools: {
    enabled: true,

    timeline: {
      enabled: true,
    },
  },

  app: {
    head: {
      title: appTitle,
      htmlAttrs: {
        lang: 'en',
      },
      meta: [
        {
          name: 'description',
          content: appDescription,
        },
        { charset: 'utf-8' },
        {
          name: 'viewport',
          content: 'width=device-width, initial-scale=1, user-scalable=no',
        },
        {
          property: 'og:title',
          content: appTitle,
        },
        {
          property: 'og:description',
          content: appDescription,
        },
        {
          property: 'og:type',
          content: 'website',
        },
        {
          name: 'twitter:card',
          content: 'summary',
        },
        {
          name: 'twitter:title',
          content: appTitle,
        },
        {
          name: 'twitter:description',
          content: appDescription,
        },
        {
          name: 'theme-color',
          content: '#efeef4',
        },
        {
          'http-equiv': 'Content-Security-Policy',
          'content': cspHeaderValue,
        },
      ],
      link: [
        {
          rel: 'preconnect',
          href: 'https://rsms.me',
        },
        {
          rel: 'preconnect',
          href: 'https://fonts.reown.com',
          crossorigin: 'anonymous',
        },
        {
          rel: 'icon',
          href: '/favicons/favicon.ico',
        },
        {
          rel: 'shortcut icon',
          href: '/favicons/favicon.ico',
        },
      ],
    },
  },

  css: ['~/assets/styles/main.scss'],

  runtimeConfig: {
    public: {
      pythHermesUrl: process.env.PYTH_HERMES_URL || 'https://hermes.pyth.network',
      appKitProjectId: process.env.APPKIT_PROJECT_ID,
      appUrl: process.env.NUXT_PUBLIC_APP_URL,
      walletScreeningUri: process.env.WALLET_SCREENING_URI || '',
      eulerApiUrl: process.env.EULER_API_URL || '',
      swapApiUrl: process.env.SWAP_API_URL || '',
      priceApiUrl: process.env.PRICE_API_URL || '',

      // CONFIG_ vars (Doppler: NUXT_PUBLIC_CONFIG_*)
      configDocsUrl: '',
      configTosUrl: '',
      configTosMdUrl: '',
      configXUrl: '',
      configDiscordUrl: '',
      configTelegramUrl: '',
      configGithubUrl: '',
      configAppTitle: 'Euler Lite',
      configAppDescription: 'Lightweight interface for Euler Finance.',
      configLabelsRepo: 'euler-xyz/euler-labels',
      configOracleChecksRepo: 'euler-xyz/oracle-checks',
      // Feature flags: enabled by default. Set to 'false' to disable.
      configEnableTosSignature: '',
      configEnableEntityBranding: '',
      configEnableVaultType: '',
      configEnableEarnPage: '',
      configEnableLendPage: '',

      // Computed at startup (populated by scanning process.env)
      enabledChainIds,
      subgraphUris,
    },
  },

  sourcemap: {
    server: false,
    client: false,
  },

  devServer: {
    // Only enable HTTPS if both key and cert are provided
    ...(process.env.HTTPS_KEY && process.env.HTTPS_CERT
      ? {
          https: {
            key: process.env.HTTPS_KEY,
            cert: process.env.HTTPS_CERT,
          },
        }
      : {}),
  },

  compatibilityDate: '2024-08-29',

  nitro: {
    compressPublicAssets: true,
  },

  telemetry: false,
  eslint: { config: { stylistic: true } },

  svgSprite: {
    elementClass: 'icon',
  },
})
