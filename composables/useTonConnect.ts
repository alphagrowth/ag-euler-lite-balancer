import type { Account, CHAIN } from '@tonconnect/ui'
import { THEME, TonConnectUI, toUserFriendlyAddress } from '@tonconnect/ui'
import { truncate } from '~/utils/string-utils'
import { TVM_MANIFEST_URL } from '~/entities/config'

const balance = ref(0)
const isLoaded = ref(false)
const account: Account = reactive({} as Account)
const walletName = ref('Wallet')
const address = computed(() => account?.address || '')
const chain = computed(() => account.chain)
const friendlyAddress = computed(() => account?.address ? toUserFriendlyAddress(account.address) : '')
const shortAddress = computed(() => friendlyAddress.value ? truncate(friendlyAddress.value) : '')
const shorterAddress = computed(() => friendlyAddress.value ? truncate(friendlyAddress.value, 3) : '')
const isConnected = computed(() => Boolean(address.value))

const tonConnectUI = new TonConnectUI({
  manifestUrl: TVM_MANIFEST_URL,
  enableAndroidBackHandler: false,
})
const modal = tonConnectUI.modal
Object.assign(account, tonConnectUI.account)
tonConnectUI.uiOptions = {
  language: 'en',
  uiPreferences: {
    theme: THEME.LIGHT,
  },
  actionsConfiguration: {
    // twaReturnUrl: config.telegramMiniAppBotUrl as `${string}://${string}`,
  },
}

tonConnectUI.connectionRestored.then(() => {
  isLoaded.value = true
})
tonConnectUI.onStatusChange((walletInfo) => {
  if (walletInfo?.account?.address) {
    Object.assign(account, walletInfo.account)
    walletName.value = walletInfo?.name
  }
})

const disconnect = async () => {
  Object.assign(account, {
    address: '',
    chain: '' as CHAIN,
    walletStateInit: '',
    publicKey: '',
  })

  await tonConnectUI.disconnect()
}

export const useTonConnect = () => {
  return {
    isLoaded,
    isConnected,
    address,
    friendlyAddress,
    walletName,
    shortAddress,
    shorterAddress,
    tonConnectUI,
    chain,
    modal,
    balance,
    disconnect,
  }
}
