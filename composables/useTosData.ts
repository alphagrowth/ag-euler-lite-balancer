import type { Hex } from 'viem'
import { keccak256, stringToHex, toHex } from 'viem'
import { TOS_MD, TOS_PUBLIC } from '~/entities/constants'

let cachedTosData: TosData | null = null
let fetchPromise: Promise<TosData> | null = null

export interface TosData {
  tosMessage: string
  tosMessageHash: Hex
}

export async function getTosData(): Promise<TosData> {
  if (cachedTosData) {
    return cachedTosData
  }
  if (fetchPromise) {
    return fetchPromise
  }

  fetchPromise = fetch(TOS_MD)
    .then(response => response.text())
    .then((content) => {
      const tosHash = keccak256(toHex(content))
      const tosHashShort = `0x${tosHash.slice(-6)}`
      const tosMessage = `By proceeding to engage with and use Euler, you accept and agree to abide by the Terms of Use: ${TOS_PUBLIC}  hash:${tosHashShort}`
      const tosMessageHash = keccak256(stringToHex(tosMessage))
      cachedTosData = { tosMessage, tosMessageHash }
      return cachedTosData
    })
    .finally(() => {
      fetchPromise = null
    })

  return fetchPromise
}
