import { useAccount, useConfig } from '@wagmi/vue'
import { formatUnits, parseUnits, type Address, erc20Abi } from 'viem'
import { sendTransaction, waitForTransactionReceipt, writeContract, readContract } from '@wagmi/vue/actions'
import { useToast } from '~/components/ui/composables/useToast'
import {
  useEnsoRoute,
  previewAdapterZapIn,
  zapInFunctionAbi,
  EnsoRouteNotFoundError,
  type BptAdapterConfigEntry,
} from '~/composables/useEnsoRoute'
import { logWarn } from '~/utils/errorHandling'

type ZapError = {
  message?: string
  shortMessage?: string
}

export interface ZapPool {
  id: string
  name: string
  collateralVault: string
  inputTokens: ZapToken[]
  routeType: 'adapter' | 'enso'
  outputToken: ZapToken
}

export interface ZapToken {
  address: string
  symbol: string
  decimals: number
}

export const ZAP_POOLS: ZapPool[] = [
  {
    id: 'pool1',
    name: 'Balancer USDT0-AUSD-USDC',
    collateralVault: '0x5795130BFb9232C7500C6E57A96Fdd18bFA60436',
    inputTokens: [
      { address: '0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a', symbol: 'AUSD', decimals: 6 },
    ],
    routeType: 'enso',
    outputToken: { address: '0x2DAA146dfB7EAef0038F9F15B2EC1e4DE003f72b', symbol: 'BPT', decimals: 18 },
  },
  {
    id: 'pool2',
    name: 'Balancer sMON-WMON',
    collateralVault: '0x7ad9f09B431A4C5F4CbA809d449Fde842192f9ec',
    inputTokens: [
      { address: '0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A', symbol: 'WMON', decimals: 18 },
    ],
    routeType: 'enso',
    outputToken: { address: '0x02b34a02db24179Ac2D77Ae20AA6215C7153E7f8', symbol: 'BPT', decimals: 18 },
  },
  {
    id: 'pool3',
    name: 'Balancer shMON-WMON',
    collateralVault: '0x7A81A1613D50ffF334027Aad76F2416368f6050f',
    inputTokens: [
      { address: '0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A', symbol: 'WMON', decimals: 18 },
    ],
    routeType: 'enso',
    outputToken: { address: '0x340Fa62AE58e90473da64b0af622cdd6113106Cb', symbol: 'BPT', decimals: 18 },
  },
  {
    id: 'beefy-usdt0-ausd-usdc',
    name: 'Beefy USDT0-AUSD-USDC',
    collateralVault: '0xf18f3bc9440ad7940e6e2a86fd0c724add2dd0aa',
    inputTokens: [
      { address: '0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a', symbol: 'AUSD', decimals: 6 },
    ],
    routeType: 'enso',
    outputToken: {
      address: '0xd0331a023c35514c2ef99eb34ed868737e9dcea3',
      symbol: 'mooToken',
      decimals: 18,
    },
  },
]

export const useZapBpt = () => {
  const wagmiConfig = useConfig()
  const { address, isConnected } = useAccount()
  const { chainId: currentChainId } = useEulerAddresses()
  const { fetchSingleBalance } = useWallets()
  const { slippage } = useSlippage()
  const { bptAdapterConfig } = useDeployConfig()
  const { getEnsoRoute } = useEnsoRoute()
  const { error: showError, success: showSuccess } = useToast()

  const selectedPoolId = ref<string>(ZAP_POOLS[0].id)
  const inputAmount = ref<string>('')
  const inputTokenAddress = ref<string>('')

  const isQuoting = ref(false)
  const isZapping = ref(false)
  const quoteError = ref<string | null>(null)

  const walletBalance = ref<bigint>(0n)
  const expectedOutputFromZap = ref<bigint>(0n)
  const outputReceivedFromZap = ref<bigint>(0n)

  const phase = ref<'input' | 'done'>('input')

  const selectedPool = computed(() => ZAP_POOLS.find(p => p.id === selectedPoolId.value)!)

  const selectedInputToken = computed(() => {
    const pool = selectedPool.value
    if (!pool) return null
    const token = pool.inputTokens.find(t => t.address === inputTokenAddress.value)
    return token || pool.inputTokens[0]
  })

  watch(selectedPoolId, () => {
    const pool = ZAP_POOLS.find(p => p.id === selectedPoolId.value)
    if (pool) {
      inputTokenAddress.value = pool.inputTokens[0].address
      inputAmount.value = ''
      resetState()
    }
  }, { immediate: true })

  const inputAmountNano = computed(() => {
    const token = selectedInputToken.value
    if (!token || !inputAmount.value) return 0n
    try {
      return parseUnits(inputAmount.value, token.decimals)
    }
    catch {
      return 0n
    }
  })

  const isInsufficient = computed(() => {
    return inputAmountNano.value > 0n && inputAmountNano.value > walletBalance.value
  })

  const isZapReady = computed(() => {
    return isConnected.value
      && inputAmountNano.value > 0n
      && !isInsufficient.value
      && expectedOutputFromZap.value > 0n
      && !quoteError.value
      && phase.value === 'input'
  })

  function resetState() {
    phase.value = 'input'
    expectedOutputFromZap.value = 0n
    outputReceivedFromZap.value = 0n
    quoteError.value = null
  }

  async function updateBalance() {
    const token = selectedInputToken.value
    if (!token || !isConnected.value) {
      walletBalance.value = 0n
      return
    }
    walletBalance.value = await fetchSingleBalance(token.address)
  }

  watch([selectedInputToken, isConnected], () => updateBalance(), { immediate: true })

  const fetchZapPreview = useDebounceFn(async () => {
    expectedOutputFromZap.value = 0n
    quoteError.value = null

    const pool = selectedPool.value
    const token = selectedInputToken.value
    const input = inputAmountNano.value
    if (!pool || !token || input <= 0n) return
    if (!currentChainId.value) return
    if (!address.value) return

    isQuoting.value = true

    try {
      if (pool.routeType === 'adapter') {
        const adapterEntry = bptAdapterConfig[pool.collateralVault.toLowerCase()]
          || bptAdapterConfig[pool.collateralVault]
        if (!adapterEntry?.pool || !adapterEntry?.wrapper || !adapterEntry?.numTokens) {
          throw new Error('Adapter config missing for this pool')
        }
        const { expectedBptOut } = await previewAdapterZapIn(
          wagmiConfig,
          adapterEntry as BptAdapterConfigEntry,
          input,
          slippage.value,
        )
        expectedOutputFromZap.value = expectedBptOut
      }
      else {
        const ensoRoute = await getEnsoRoute({
          chainId: currentChainId.value,
          fromAddress: address.value! as Address,
          tokenIn: token.address as Address,
          tokenOut: pool.outputToken.address as Address,
          amountIn: input,
          receiver: address.value! as Address,
          slippage: slippage.value,
        })
        expectedOutputFromZap.value = BigInt(ensoRoute.amountOut)
      }
    }
    catch (e: unknown) {
      if (e instanceof EnsoRouteNotFoundError) {
        quoteError.value = e.message
        expectedOutputFromZap.value = 0n
      }
      else {
        const err = e as ZapError
        quoteError.value = err.message || 'Failed to get zap preview'
        logWarn('zap-bpt/preview', e)
      }
    }
    finally {
      isQuoting.value = false
    }
  }, 600)

  watch([inputAmountNano, selectedPoolId, slippage], () => {
    if (phase.value !== 'input') return
    if (inputAmountNano.value > 0n) {
      fetchZapPreview()
    }
    else {
      expectedOutputFromZap.value = 0n
      quoteError.value = null
    }
  })

  async function executeZapIn() {
    const pool = selectedPool.value
    const token = selectedInputToken.value
    if (!pool || !token || !address.value) return

    isZapping.value = true

    try {
      const input = inputAmountNano.value
      const userAddr = address.value as Address

      const outputBalanceBefore = await readContract(wagmiConfig, {
        address: pool.outputToken.address as Address,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [userAddr],
      })

      if (pool.routeType === 'adapter') {
        const adapterEntry = bptAdapterConfig[pool.collateralVault.toLowerCase()]
          || bptAdapterConfig[pool.collateralVault]
        const fullEntry = adapterEntry as BptAdapterConfigEntry
        const { minBptOut } = await previewAdapterZapIn(wagmiConfig, fullEntry, input, slippage.value)
        const adapterAddr = fullEntry.adapter as Address
        const inputAddr = token.address as Address

        const currentAllowance = await readContract(wagmiConfig, {
          address: inputAddr,
          abi: erc20Abi,
          functionName: 'allowance',
          args: [userAddr, adapterAddr],
        })
        if (currentAllowance < input) {
          const approveHash = await writeContract(wagmiConfig, {
            address: inputAddr,
            abi: erc20Abi,
            functionName: 'approve',
            args: [adapterAddr, input],
          })
          await waitForTransactionReceipt(wagmiConfig, { hash: approveHash })
        }

        const zapHash = await writeContract(wagmiConfig, {
          address: adapterAddr,
          abi: zapInFunctionAbi,
          functionName: 'zapIn',
          args: [BigInt(fullEntry.tokenIndex), input, minBptOut],
        })
        await waitForTransactionReceipt(wagmiConfig, { hash: zapHash })
      }
      else {
        const ensoRoute = await getEnsoRoute({
          chainId: currentChainId.value,
          fromAddress: userAddr,
          tokenIn: token.address as Address,
          tokenOut: pool.outputToken.address as Address,
          amountIn: input,
          receiver: userAddr,
          slippage: slippage.value,
        })

        const ensoRouter = ensoRoute.tx.to as Address
        const inputAddr = token.address as Address

        const currentAllowance = await readContract(wagmiConfig, {
          address: inputAddr,
          abi: erc20Abi,
          functionName: 'allowance',
          args: [userAddr, ensoRouter],
        })
        if (currentAllowance < input) {
          const approveHash = await writeContract(wagmiConfig, {
            address: inputAddr,
            abi: erc20Abi,
            functionName: 'approve',
            args: [ensoRouter, input],
          })
          await waitForTransactionReceipt(wagmiConfig, { hash: approveHash })
        }

        const hash = await sendTransaction(wagmiConfig, {
          to: ensoRoute.tx.to,
          data: ensoRoute.tx.data,
          value: BigInt(ensoRoute.tx.value),
        })
        await waitForTransactionReceipt(wagmiConfig, { hash })
      }

      const outputBalanceAfter = await readContract(wagmiConfig, {
        address: pool.outputToken.address as Address,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [userAddr],
      })

      outputReceivedFromZap.value = outputBalanceAfter - outputBalanceBefore
      phase.value = 'done'
      showSuccess(`Zap complete — ${formatUnits(outputReceivedFromZap.value, pool.outputToken.decimals)} ${pool.outputToken.symbol} received`)

      await updateBalance()
    }
    catch (e: unknown) {
      if (e instanceof EnsoRouteNotFoundError) {
        quoteError.value = e.message
      }
      else {
        const err = e as ZapError
        logWarn('zap-bpt/zap-in', e)
        showError(err.shortMessage || err.message || 'Zap failed')
      }
    }
    finally {
      isZapping.value = false
    }
  }

  return {
    pools: ZAP_POOLS,

    selectedPoolId,
    selectedPool,
    inputAmount,
    inputTokenAddress,
    selectedInputToken,

    inputAmountNano,
    walletBalance,
    expectedOutputFromZap,
    outputReceivedFromZap,
    isInsufficient,

    phase,
    isQuoting,
    isZapping,
    quoteError,
    isZapReady,

    executeZapIn,
    updateBalance,
    resetState,
  }
}
