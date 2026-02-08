import { ethers } from 'ethers'
import type { ComputedRef } from 'vue'
import { EVC_ABI, type BatchItem, type BatchItemResult } from '~/abis/evc'
import { erc20DecimalsAbi } from '~/abis/erc20'
import { priceOracleAbi } from '~/abis/oracle'
import { vaultConvertToAssetsAbi } from '~/abis/vault'
import { USD_ADDRESS, EUR_ADDRESS } from '~/entities/constants'
import type { OracleAdapterEntry } from '~/entities/oracle'
import type { Vault, SecuritizeVault } from '~/entities/vault'
import { buildPythBatchItems } from '~/utils/pyth'
import { nanoToValue } from '~/utils/crypto-utils'
import { buildBatchItem } from '~/utils/multicall'

export type AdapterPriceInfo = {
  rate: number
  success: boolean
}

const oracleInterface = new ethers.Interface(priceOracleAbi)
const erc20Interface = new ethers.Interface(erc20DecimalsAbi)
const vaultInterface = new ethers.Interface(vaultConvertToAssetsAbi)

const getAdapterKey = (adapter: OracleAdapterEntry) =>
  `${adapter.oracle.toLowerCase()}:${adapter.base.toLowerCase()}:${adapter.quote.toLowerCase()}`

const buildKnownDecimals = (
  sourceVaults: Vault[],
  collateralVaults: (Vault | SecuritizeVault)[],
): Map<string, number> => {
  const decimals = new Map<string, number>()

  // UoA constants
  decimals.set(USD_ADDRESS.toLowerCase(), 18)
  decimals.set(EUR_ADDRESS.toLowerCase(), 18)

  const addVaultDecimals = (vault: Vault | SecuritizeVault) => {
    if (vault.asset?.address && vault.asset?.decimals !== undefined) {
      decimals.set(vault.asset.address.toLowerCase(), Number(vault.asset.decimals))
    }
    if (vault.address && vault.decimals !== undefined) {
      decimals.set(vault.address.toLowerCase(), Number(vault.decimals))
    }
  }

  // Add unit of account decimals from source vaults
  sourceVaults.forEach((vault) => {
    addVaultDecimals(vault)
    if (vault.unitOfAccount && vault.unitOfAccountDecimals !== undefined) {
      decimals.set(vault.unitOfAccount.toLowerCase(), Number(vault.unitOfAccountDecimals))
    }
  })

  collateralVaults.forEach(addVaultDecimals)

  return decimals
}

const findUnknownDecimalsAddresses = (
  adapters: OracleAdapterEntry[],
  knownDecimals: Map<string, number>,
): string[] => {
  const unknown = new Set<string>()

  adapters.forEach((adapter) => {
    const base = adapter.base.toLowerCase()
    const quote = adapter.quote.toLowerCase()
    if (!knownDecimals.has(base)) unknown.add(base)
    if (!knownDecimals.has(quote)) unknown.add(quote)
  })

  return [...unknown]
}

const fetchMissingDecimals = async (
  addresses: string[],
  evcAddress: string,
  provider: ethers.JsonRpcProvider,
): Promise<Map<string, number>> => {
  const result = new Map<string, number>()
  if (!addresses.length) return result

  const items: BatchItem[] = addresses.map(addr =>
    buildBatchItem(addr, erc20Interface.encodeFunctionData('decimals')),
  )

  const evcContract = new ethers.Contract(evcAddress, EVC_ABI, provider)

  try {
    const [batchResults] = await evcContract.batchSimulation.staticCall(
      items,
      { value: 0n },
    ) as [BatchItemResult[], unknown, unknown]

    batchResults.forEach((res, i) => {
      if (res.success) {
        try {
          const [decimals] = evcInterface_decodeFunctionResult(res.result)
          result.set(addresses[i].toLowerCase(), Number(decimals))
        }
        catch {
          // Skip tokens whose decimals can't be decoded
        }
      }
      // Skip tokens whose decimals() call failed — omitting them
      // from the map causes their adapters to be filtered out later,
      // which is safer than defaulting to 18 (would misquote USDC/WBTC).
    })
  }
  catch {
    // Batch call failed — return empty map so all adapters with
    // unknown decimals are skipped rather than mis-priced.
  }

  return result
}

// Decode decimals result inline (avoids extra ethers.Interface allocation)
const evcInterface_decodeFunctionResult = (data: string): [bigint] => {
  return erc20Interface.decodeFunctionResult('decimals', data) as unknown as [bigint]
}

const buildPriceQueryItems = (
  adapters: OracleAdapterEntry[],
  decimals: Map<string, number>,
): { filteredAdapters: OracleAdapterEntry[]; items: BatchItem[] } => {
  const filteredAdapters: OracleAdapterEntry[] = []
  const items: BatchItem[] = []

  for (const adapter of adapters) {
    const baseDecimals = decimals.get(adapter.base.toLowerCase())
    const quoteDecimals = decimals.get(adapter.quote.toLowerCase())
    if (baseDecimals === undefined || quoteDecimals === undefined) continue

    const inAmount = 10n ** BigInt(baseDecimals)

    if (adapter.name === 'ERC4626Vault') {
      const callData = vaultInterface.encodeFunctionData('convertToAssets', [inAmount])
      items.push(buildBatchItem(adapter.oracle, callData))
    }
    else {
      const callData = oracleInterface.encodeFunctionData('getQuote', [
        inAmount,
        adapter.base,
        adapter.quote,
      ])
      items.push(buildBatchItem(adapter.oracle, callData))
    }

    filteredAdapters.push(adapter)
  }

  return { filteredAdapters, items }
}

const decodePriceResults = (
  adapters: OracleAdapterEntry[],
  results: BatchItemResult[],
  decimals: Map<string, number>,
): Map<string, AdapterPriceInfo> => {
  const prices = new Map<string, AdapterPriceInfo>()

  adapters.forEach((adapter, i) => {
    const key = getAdapterKey(adapter)
    const res = results[i]

    if (!res?.success) {
      prices.set(key, { rate: 0, success: false })
      return
    }

    try {
      const isERC4626 = adapter.name === 'ERC4626Vault'
      const decoded = isERC4626
        ? vaultInterface.decodeFunctionResult('convertToAssets', res.result)
        : oracleInterface.decodeFunctionResult('getQuote', res.result)

      const outAmount = decoded[0] as bigint
      const quoteDecimals = decimals.get(adapter.quote.toLowerCase()) ?? 18
      const rate = nanoToValue(outAmount, quoteDecimals)

      prices.set(key, { rate, success: true })
    }
    catch {
      prices.set(key, { rate: 0, success: false })
    }
  })

  return prices
}

export const useOracleAdapterPrices = (
  adapters: ComputedRef<OracleAdapterEntry[]>,
  sourceVaults: ComputedRef<Vault[]>,
  collateralVaults: ComputedRef<(Vault | SecuritizeVault)[]>,
) => {
  const prices: Ref<Map<string, AdapterPriceInfo>> = ref(new Map())
  const isLoading = ref(false)

  const { EVM_PROVIDER_URL, PYTH_HERMES_URL } = useEulerConfig()
  const { eulerCoreAddresses } = useEulerAddresses()

  let provider: ethers.JsonRpcProvider | undefined

  const fetchPrices = async () => {
    const adapterList = adapters.value
    const evcAddress = eulerCoreAddresses.value?.evc
    if (!adapterList.length || !evcAddress || !EVM_PROVIDER_URL) {
      prices.value = new Map()
      return
    }

    try {
      if (!provider) {
        provider = new ethers.JsonRpcProvider(EVM_PROVIDER_URL)
      }

      // 1. Build known decimals
      const knownDecimals = buildKnownDecimals(sourceVaults.value, collateralVaults.value)

      // 2. Find unknown decimals
      const unknownAddresses = findUnknownDecimalsAddresses(adapterList, knownDecimals)

      // 3. Fetch missing decimals if needed
      if (unknownAddresses.length) {
        const fetched = await fetchMissingDecimals(unknownAddresses, evcAddress, provider)
        fetched.forEach((dec, addr) => knownDecimals.set(addr, dec))
      }

      // 4. Build Pyth update batch items
      const { items: pythItems, totalFee } = await buildPythBatchItems(
        sourceVaults.value,
        EVM_PROVIDER_URL,
        PYTH_HERMES_URL,
      )

      // 5. Build price query batch items (skipping adapters with unknown decimals)
      const { filteredAdapters, items: priceItems } = buildPriceQueryItems(adapterList, knownDecimals)

      // 6. Execute single batchSimulation
      const allItems = [...pythItems, ...priceItems]
      const evcContract = new ethers.Contract(evcAddress, EVC_ABI, provider)
      const [batchResults] = await evcContract.batchSimulation.staticCall(
        allItems,
        { value: totalFee },
      ) as [BatchItemResult[], unknown, unknown]

      // 7. Decode price results (skip Pyth update results)
      const priceResults = batchResults.slice(pythItems.length)
      prices.value = decodePriceResults(filteredAdapters, priceResults, knownDecimals)
    }
    catch (err) {
      console.warn('[useOracleAdapterPrices] fetchPrices failed:', err)
      prices.value = new Map()
    }
  }

  watch(adapters, async () => {
    if (!adapters.value.length) {
      prices.value = new Map()
      return
    }
    isLoading.value = true
    await fetchPrices()
    isLoading.value = false
  }, { immediate: true })

  return {
    prices,
    isLoading,
  }
}
