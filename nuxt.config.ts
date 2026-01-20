// https://nuxt.com/docs/api/configuration/nuxt-config
import { appDescription, appTitle } from './entities/custom'

const cspHeaderValue = `default-src 'self'; script-src 'unsafe-eval' 'unsafe-inline' 'wasm-unsafe-eval' 'self' https://static.cloudflareinsights.com; style-src 'unsafe-inline' 'self'; object-src 'none'; base-uri 'self'; connect-src 'self' https://indexer-main.euler.finance https://swap.euler.finance https://swap-dev.euler.finance https://api.merkl.xyz https://incentra-prd.brevis.network https://hermes.pyth.network https://raw.githubusercontent.com https://rpc.walletconnect.org https://api.web3modal.org https://explorer-api.walletconnect.com https://verify.walletconnect.org https://pulse.walletconnect.org https://rpc.monad.xyz https://chain-proxy.wallet.coinbase.com https://cca-lite.coinbase.com https://yields.llama.fi https://*.quiknode.pro https://*.alchemy.com https://*.ankr.com https://*.goldsky.com wss://www.walletlink.org wss://relay.walletconnect.com wss://relay.walletconnect.org; font-src 'self' https://fonts.reown.com; frame-src 'self' https://verify.walletconnect.org https://verify.walletconnect.com; img-src 'self' data: blob: https://raw.githubusercontent.com https://storage.googleapis.com https://token-images.euler.finance; manifest-src 'self'; media-src 'self'; worker-src 'self' blob:; form-action 'self';`

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
      network: process.env.NETWORK,
      pythHermesUrl: process.env.PYTH_HERMES_URL || 'https://hermes.pyth.network',
    },
  },

  sourcemap: {
    server: false,
    client: false,
  },

  devServer: {
    https: {
      key: process.env.HTTPS_KEY,
      cert: process.env.HTTPS_CERT,
    },
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
