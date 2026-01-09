import { WagmiPlugin } from '@wagmi/vue'
import { createAppKit } from '@reown/appkit/vue'
import {
  arbitrum, mainnet, base, swellchain, sonic,
  bob, berachain, avalanche, bsc, unichain, monad,
  tac, linea, plasma, type AppKitNetwork } from '@reown/appkit/networks'
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi'
import { availableNetworkIds } from '~/entities/custom'

const projectId = 'b4d5f74af3e208693c5c26a4eb041592' // https://reown.com/
const url = 'https://beta-lite.boostcult.fun'

const metadata = {
  name: 'Euler Lite',
  description: 'Euler Finance Lite',
  url,
  icons: [`${url}/manifest-img.png`],
}

const allNetworks: AppKitNetwork[] = [
  mainnet, arbitrum, base, swellchain, sonic,
  bob, berachain, avalanche, bsc, unichain,
  tac, linea, plasma, monad,
]

const networkMap = new Map<number | string, AppKitNetwork>(
  allNetworks.map(network => [network.id, network]),
)
const filteredNetworks = availableNetworkIds
  .map(id => networkMap.get(id) || networkMap.get(String(id)))
  .filter(Boolean) as AppKitNetwork[]

if (!filteredNetworks.length) {
  console.warn('[wagmi] availableNetworkIds is empty or contains unknown ids, falling back to the full network list')
}

const networks = (filteredNetworks.length ? filteredNetworks : allNetworks) as [AppKitNetwork, ...AppKitNetwork[]]

const wagmiAdapter = new WagmiAdapter({
  networks,
  projectId,
})

createAppKit({
  adapters: [wagmiAdapter],
  networks,
  projectId,
  metadata,
})

export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.use(WagmiPlugin, { config: wagmiAdapter.wagmiConfig })
})
