import { WagmiPlugin } from '@wagmi/vue'
import { createAppKit } from '@reown/appkit/vue'
import {
  arbitrum, mainnet, base, swellchain, sonic,
  bob, berachain, avalanche, bsc, unichain,
  tac, linea, plasma, type AppKitNetwork } from '@reown/appkit/networks'
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi'

const projectId = 'b4d5f74af3e208693c5c26a4eb041592'

const metadata = {
  name: 'Euler Lite',
  description: 'Euler Finance Lite',
  url: 'https://euler-app.fanz.ee/',
  icons: ['https://euler-app.fanz.ee/manifest-img.png'],
}

const networks: [AppKitNetwork, ...AppKitNetwork[]] = [
  mainnet, arbitrum, base, swellchain, sonic,
  bob, berachain, avalanche, bsc, unichain,
  tac, linea, plasma
]

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
