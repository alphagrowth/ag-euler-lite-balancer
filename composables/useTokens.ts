/* eslint-disable @typescript-eslint/no-dynamic-delete */
import axios from 'axios'
import type {
  TokenData,
} from '~/entities/token'
import { CUSTOM_ICON_TOKENS } from '~/entities/constants'
import { useEulerConfig } from '~/composables/useEulerConfig'

const isLoading = ref(false)
const tokensByAddress: Record<string, TokenData> = shallowReactive({})

export const useTokens = () => {
  const { getCurrentChainConfig, chainId } = useEulerAddresses()
  const { EULER_API_URL } = useEulerConfig()

  const loadTokens = async () => {
    try {
      isLoading.value = true
      Object.keys(tokensByAddress).forEach(key => delete tokensByAddress[key])

      await until(getCurrentChainConfig).toBeTruthy()

      if (!EULER_API_URL) {
        throw new Error('Tokens API URL is not configured')
      }
      const res = await axios.get(`${EULER_API_URL}/v1/tokens?chainId=${chainId.value}`)

      const tokensArr = res.data as TokenData[]

      Object.assign(tokensByAddress, Object.fromEntries(tokensArr.map(token => [token.address.toLowerCase(), token])))
    }
    catch (e) {
      console.warn(e)
    }
    finally {
      isLoading.value = false
    }
  }

  return {
    isLoading,
    tokens: tokensByAddress,
    loadTokens,
  }
}

export const getAssetLogoUrl = (address: string, symbol: string) => {
  if (CUSTOM_ICON_TOKENS.has(symbol.toLowerCase())) {
    return `/tokens/${symbol.toLowerCase()}.png`
  }

  return tokensByAddress[address.toLowerCase()]?.logoURI ?? `/tokens/${symbol.toLowerCase()}.png`
}
