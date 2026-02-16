// https://nuxt.com/docs/api/configuration/nuxt-config

const cspHeaderValue = `default-src 'self'; script-src 'unsafe-inline' 'wasm-unsafe-eval' 'self' https://static.cloudflareinsights.com; style-src 'unsafe-inline' 'self'; object-src 'none'; base-uri 'self'; connect-src 'self' https://indexer.euler.finance https://swap.euler.finance https://swap-dev.euler.finance https://api.merkl.xyz https://incentra-prd.brevis.network https://hermes.pyth.network https://raw.githubusercontent.com https://oracle-checks-data.euler.finance https://rpc.walletconnect.com https://rpc.walletconnect.org https://relay.walletconnect.com https://relay.walletconnect.org https://api.web3modal.com https://api.web3modal.org https://keys.walletconnect.com https://keys.walletconnect.org https://notify.walletconnect.com https://notify.walletconnect.org https://echo.walletconnect.com https://echo.walletconnect.org https://push.walletconnect.com https://push.walletconnect.org https://pulse.walletconnect.com https://pulse.walletconnect.org https://verify.walletconnect.com https://verify.walletconnect.org https://explorer-api.walletconnect.com https://rpc.monad.xyz https://chain-proxy.wallet.coinbase.com https://cca-lite.coinbase.com https://yields.llama.fi https://rpc.plasma.to https://*.quiknode.pro https://*.alchemy.com https://*.ankr.com https://*.goldsky.com wss://www.walletlink.org wss://relay.walletconnect.com wss://relay.walletconnect.org; font-src 'self' https://fonts.reown.com; frame-src 'self' https://verify.walletconnect.org https://verify.walletconnect.com; img-src 'self' data: blob: https://raw.githubusercontent.com https://storage.googleapis.com https://token-images.euler.finance; manifest-src 'self'; media-src 'self'; worker-src 'self' blob:; form-action 'self';`

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
      title: 'Euler Lite',
      htmlAttrs: {
        lang: 'en',
      },
      meta: [
        {
          name: 'description',
          content: 'Lightweight interface for Euler Finance lending and borrowing.',
        },
        { charset: 'utf-8' },
        {
          name: 'viewport',
          content: 'width=device-width, initial-scale=1, user-scalable=no',
        },
        {
          property: 'og:title',
          content: 'Euler Lite',
        },
        {
          property: 'og:description',
          content: 'Lightweight interface for Euler Finance lending and borrowing.',
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
          content: 'Euler Lite',
        },
        {
          name: 'twitter:description',
          content: 'Lightweight interface for Euler Finance lending and borrowing.',
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
      // CONFIG_ vars (Doppler: NUXT_PUBLIC_CONFIG_*)
      configDocsUrl: '',
      configTosUrl: '',
      configTosMdUrl: '',
      configXUrl: '',
      configDiscordUrl: '',
      configTelegramUrl: '',
      configGithubUrl: '',
      configAppTitle: 'Euler Lite',
      configAppDescription: 'Lightweight interface for Euler Finance lending and borrowing.',
      configLabelsRepo: 'euler-xyz/euler-labels',
      configLabelsRepoBranch: 'master',
      configOracleChecksRepo: 'euler-xyz/oracle-checks',
      // Feature flags: enabled by default. Set to 'false' to disable.
      configEnableEntityBranding: '',
      configEnableVaultType: '',
      configEnableEarnPage: '',
      configEnableLendPage: '',
      configEnableExplorePage: '',
      // Env config fallbacks (Doppler: NUXT_PUBLIC_*)
      // Prefer window.__APP_CONFIG__ at runtime; these are build-time fallbacks.
      appKitProjectId: '',
      appUrl: '',
      pythHermesUrl: '',
      eulerApiUrl: '',
      swapApiUrl: '',
      priceApiUrl: '',
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
