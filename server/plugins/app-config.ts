/**
 * Nitro plugin that reads app-level env vars at server startup
 * and injects them into the HTML via render:html hook.
 *
 * This runs at server startup, so Doppler-injected env vars are available.
 * The config is embedded as a <script> tag in the HTML head, making it
 * accessible to the client synchronously via window.__APP_CONFIG__.
 *
 * Also patches <title> and meta tags so crawlers see the correct values.
 */

const DEFAULTS = {
  appTitle: 'Euler Lite',
  appDescription: 'Lightweight interface for Euler Finance lending and borrowing.',
}

function readAppConfig() {
  return {
    appTitle: process.env.NUXT_PUBLIC_CONFIG_APP_TITLE || DEFAULTS.appTitle,
    appDescription: process.env.NUXT_PUBLIC_CONFIG_APP_DESCRIPTION || DEFAULTS.appDescription,
    pythHermesUrl: process.env.PYTH_HERMES_URL || 'https://hermes.pyth.network',
    appKitProjectId: process.env.APPKIT_PROJECT_ID || '',
    appUrl: process.env.NUXT_PUBLIC_APP_URL || '',
    walletScreeningUri: process.env.WALLET_SCREENING_URI || '',
    eulerApiUrl: process.env.EULER_API_URL || '',
    swapApiUrl: process.env.SWAP_API_URL || '',
    priceApiUrl: process.env.PRICE_API_URL || '',
  }
}

function patchMeta(html: { head: string[] }, appConfig: ReturnType<typeof readAppConfig>) {
  const { appTitle, appDescription } = appConfig

  html.head = html.head.map((chunk) => {
    let patched = chunk

    // Replace <title>…</title>
    patched = patched.replace(/<title>[^<]*<\/title>/, `<title>${appTitle}</title>`)

    // Replace content="…" on relevant meta tags
    patched = patched.replace(
      /(<meta\s+property="og:title"\s+content=")[^"]*(")/,
      `$1${appTitle}$2`,
    )
    patched = patched.replace(
      /(<meta\s+name="twitter:title"\s+content=")[^"]*(")/,
      `$1${appTitle}$2`,
    )
    patched = patched.replace(
      /(<meta\s+name="description"\s+content=")[^"]*(")/,
      `$1${appDescription}$2`,
    )
    patched = patched.replace(
      /(<meta\s+property="og:description"\s+content=")[^"]*(")/,
      `$1${appDescription}$2`,
    )
    patched = patched.replace(
      /(<meta\s+name="twitter:description"\s+content=")[^"]*(")/,
      `$1${appDescription}$2`,
    )

    return patched
  })
}

export default defineNitroPlugin((nitroApp) => {
  const appConfig = readAppConfig()
  const scriptTag = `<script>window.__APP_CONFIG__=${JSON.stringify(appConfig)}</script>`

  nitroApp.hooks.hook('render:html', (html) => {
    html.head.push(scriptTag)
    patchMeta(html, appConfig)
  })
})
