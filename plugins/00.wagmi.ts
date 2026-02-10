import { WagmiPlugin } from '@wagmi/vue'
import { createAppKit } from '@reown/appkit/vue'
import type { AppKitNetwork } from '@reown/appkit/networks'
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi'
import { getNetworksByChainIds } from '~/entities/chainRegistry'

export default defineNuxtPlugin((nuxtApp) => {
  const appConfig = useAppConfig()
  const projectId = appConfig.appKitProjectId
  const appUrl = appConfig.appUrl
  const normalizedAppUrl = appUrl ? appUrl.replace(/\/+$/, '') : ''
  const { enabledChainIds } = useChainConfig()

  if (!projectId) {
    console.warn('[wagmi] Missing APPKIT_PROJECT_ID in runtime config')
  }
  if (!normalizedAppUrl) {
    console.warn('[wagmi] Missing APP_URL in runtime config')
  }

  if (!enabledChainIds.length) {
    throw new Error(
      '[wagmi] No enabled chains. Set at least one RPC_URL_HTTP_<chainId> env var.',
    )
  }

  const networks = getNetworksByChainIds(enabledChainIds) as [
    AppKitNetwork,
    ...AppKitNetwork[],
  ]

  const metadata = {
    name: appConfig.appTitle,
    description: appConfig.appDescription,
    url: normalizedAppUrl,
    icons: normalizedAppUrl ? [`${normalizedAppUrl}/manifest-img.png`] : [],
  }

  const wagmiAdapter = new WagmiAdapter({
    networks,
    projectId: projectId || '',
  })

  createAppKit({
    adapters: [wagmiAdapter],
    networks,
    projectId: projectId || '',
    metadata,
  })

  nuxtApp.vueApp.use(WagmiPlugin, { config: wagmiAdapter.wagmiConfig })
})
