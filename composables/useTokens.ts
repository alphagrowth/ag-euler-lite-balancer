/* eslint-disable @typescript-eslint/no-dynamic-delete */
import axios from 'axios'
import type {
  TokenData,
} from '~/entities/token'

const isLoading = ref(false)
const tokens: Record<string, TokenData> = shallowReactive({})

export const useTokens = () => {
  const { getCurrentChainConfig } = useEulerAddresses()
  const { chainId } = useEulerAddresses()

  const loadTokens = async () => {
    try {
      isLoading.value = true
      Object.keys(tokens).forEach(key => delete tokens[key])

      await until(getCurrentChainConfig).toBeTruthy()

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

  watch(chainId, loadTokens)

  return {
    isLoading,
    tokens,
    loadTokens,
  }
}

export const getAssetLogoUrl = (symbol: string) => {
  return tokens[symbol]?.logoURI ?? `/tokens/${symbol}.png`
}
