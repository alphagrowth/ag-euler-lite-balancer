/* eslint-disable @typescript-eslint/no-dynamic-delete */
import axios from 'axios'
import type {
  TokenData,
} from '~/entities/token'

const isLoading = ref(false)
const tokens: Record<string, TokenData> = shallowReactive({})

export const useTokens = () => {
  const loadTokens = async () => {
    try {
      isLoading.value = true
      const { getCurrentChainConfig } = useEulerAddresses()
      await until(getCurrentChainConfig).toBeTruthy()
      const { chainId } = useEulerAddresses()

      Object.keys(tokens).forEach(key => delete tokens[key])

      const res = await axios.get(`https://indexer-main.euler.finance/v1/tokens?chainId=${chainId.value}`)

      const tokensArr = res.data as TokenData[]

      Object.assign(tokens, Object.fromEntries(tokensArr.map(token => [token.symbol, token])))
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
    tokens,
    loadTokens,
  }
}

export const getAssetLogoUrl = (symbol: string) => {
  return tokens[symbol]?.logoURI ?? `/tokens/${symbol}.png`
}
