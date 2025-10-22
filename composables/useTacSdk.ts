import { Network, TacSdk } from '@tonappchain/sdk'
import { isAxiosError } from 'axios'
import { TonClient } from '@ton/ton'
import { ethers } from 'ethers'
// import { TonClient } from '@ton/ton'
let tacSdk: TacSdk = shallowReactive({} as TacSdk)
const isLoaded = ref(false)

const init = async () => {
  try {
    const { TVM_TONCENTER_URL, NETWORK, EVM_PROVIDER_URL } = useAppConfig()

    const TONParams = NETWORK === Network.MAINNET
      ? {
          contractOpener: new TonClient({
            endpoint: `${TVM_TONCENTER_URL}/api/v2/jsonRPC`,
          }),
        }
      : {
          contractOpener: new TonClient({
            endpoint: `${TVM_TONCENTER_URL}/api/v2/jsonRPC`,
          }),
          settingsAddress: 'EQCQTgXQ99LqwpeYUxDml9DeYTqoqnZEqiTnRyc63Um9RYn5',
        }
    const otherParams = NETWORK === Network.MAINNET
      ? {}
      : {
          TACParams: {
            settingsAddress: '0xCf4066EC68e24C9f28A577A48AA404459E871bA9',
            provider: ethers.getDefaultProvider(EVM_PROVIDER_URL),
          },
          customLiteSequencerEndpoints: [
            'https://datav3-combat.turin.tac.build',
          ],
        }

    tacSdk = await TacSdk.create({
      network: NETWORK,
      TONParams,
      ...otherParams,
    })
  }
  catch (e) {
    console.warn(e)
    if (isAxiosError(e)) {
      throw showError({
        statusCode: e.status,
        statusMessage: `TAC SDK failed to initialize: ${e.message}. Try again later.`,
      })
    }
    throw showError({
      statusMessage: 'TAC SDK failed to initialize. Try again later.',
    })
  }
  finally {
    isLoaded.value = true
  }
}

export const useTacSdk = () => {
  return {
    tacSdk,
    isLoaded,
    init,
  }
}
