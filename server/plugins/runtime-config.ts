/**
 * Nitro server plugin that patches runtimeConfig.public at startup.
 *
 * nuxt.config.ts scans process.env at *build* time, but when env vars are
 * injected at *runtime* (e.g. via Doppler on Railway) the build-time values
 * are empty. This plugin re-scans process.env at server startup so the
 * correct values are embedded in SSR payloads and available to the client.
 */
export default defineNitroPlugin(() => {
  const config = useRuntimeConfig()

  // Re-derive enabledChainIds from RPC_URL_HTTP_* env vars
  const chainIds = Object.keys(process.env)
    .filter(k => /^RPC_URL_HTTP_\d+$/.test(k) && process.env[k])
    .map(k => Number(k.replace('RPC_URL_HTTP_', '')))

  if (chainIds.length) {
    config.public.enabledChainIds = chainIds
  }

  // Re-derive subgraphUris from NUXT_PUBLIC_SUBGRAPH_URI_* env vars
  const subgraphUris: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    const match = key.match(/^NUXT_PUBLIC_SUBGRAPH_URI_(\d+)$/)
    if (match && value) {
      subgraphUris[match[1]] = value
    }
  }
  if (Object.keys(subgraphUris).length) {
    config.public.subgraphUris = subgraphUris
  }
})
