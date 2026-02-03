import { WagmiPlugin } from '@wagmi/vue'
import { createAppKit } from '@reown/appkit/vue'
import {
  arbitrum, mainnet, base, swellchain, sonic,
  bob, berachain, avalanche, bsc, unichain, monad,
  tac, linea, plasma, type AppKitNetwork } from '@reown/appkit/networks'
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi'
import { availableNetworkIds, appKitMetadata } from '~/entities/custom'

const allNetworks: AppKitNetwork[] = [
  mainnet,
  arbitrum,
  base,
  swellchain,
  sonic,
  bob,
  berachain,
  avalanche,
  bsc,
  unichain,
  tac,
  linea,
  plasma,
  monad,
]

const networkMap = new Map<number | string, AppKitNetwork>(
  allNetworks.map((network) => [network.id, network]),
)
const filteredNetworks = availableNetworkIds
  .map((id) => networkMap.get(id) || networkMap.get(String(id)))
  .filter(Boolean) as AppKitNetwork[]

if (!filteredNetworks.length) {
  console.warn(
    "[wagmi] availableNetworkIds is empty or contains unknown ids, falling back to the full network list",
  )
}

const networks = (filteredNetworks.length ? filteredNetworks : allNetworks) as [
  AppKitNetwork,
  ...AppKitNetwork[],
]

export default defineNuxtPlugin((nuxtApp) => {
  const config = useRuntimeConfig()
  const projectId = config.public.appKitProjectId
  const appUrl = config.public.appUrl
  const normalizedAppUrl = appUrl ? appUrl.replace(/\/+$/, '') : ''

  if (!projectId) {
    console.warn('[wagmi] Missing APPKIT_PROJECT_ID in runtime config')
  }
  if (!normalizedAppUrl) {
    console.warn('[wagmi] Missing APP_URL in runtime config')
  }

  const buildAppKitMetadata = (url: string) => ({
    name: appKitMetadata.name,
    description: appKitMetadata.description,
    url,
    icons: url ? [`${url}${appKitMetadata.iconPath}`] : [],
  })

  const metadata = buildAppKitMetadata(normalizedAppUrl)

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
