// https://nuxt.com/docs/api/configuration/nuxt-config

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
      title: 'Euler TMA',
      htmlAttrs: {
        lang: 'en',
      },
      meta: [
        {
          name: 'description',
          content: 'Euler TMA',
        },
        { charset: 'utf-8' },
        {
          name: 'viewport',
          content: 'width=device-width, initial-scale=1, user-scalable=no',
        },
        {
          name: 'theme-color',
          content: '#efeef4',
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

  vite: {
    css: {
      preprocessorOptions: {
        scss: {
          additionalData: '@use "~/assets/styles/mixins.scss" as *;',
        },
      },
    },
  },
  telemetry: false,
  eslint: { config: { stylistic: true } },

  svgSprite: {
    elementClass: 'icon',
  },
})
