import { useAccount, useConfig } from '@wagmi/vue'
import { formatUnits, parseUnits, type Address, type Hex, erc20Abi } from 'viem'
import { sendTransaction, waitForTransactionReceipt, writeContract, readContract } from '@wagmi/vue/actions'
import { useToast } from '~/components/ui/composables/useToast'
import { type SwapApiQuote, SwapperMode } from '~/entities/swap'
import {
  useEnsoRoute,
  encodeAdapterZapIn,
  previewAdapterZapIn,
  zapInFunctionAbi,
  type BptAdapterConfigEntry,
} from '~/composables/useEnsoRoute'
import { useVaultRegistry } from '~/composables/useVaultRegistry'
import { getNewSubAccount } from '~/entities/account'
import { logWarn } from '~/utils/errorHandling'

export interface LoopZapPool {
  id: string
  name: string
  collateralVault: string
  borrowVault: string
  borrowAsset: string
  borrowAssetSymbol: string
  borrowAssetDecimals: number
  inputTokens: { address: string, symbol: string, decimals: number }[]
  routeType: 'adapter' | 'enso'
  bptAddress: string
}

const POOLS: LoopZapPool[] = [
  {
    id: 'pool1',
    name: 'Stableswap (USDT0/AUSD/USDC)',
    collateralVault: '0x5795130BFb9232C7500C6E57A96Fdd18bFA60436',
    borrowVault: '0x438cedcE647491B1d93a73d491eC19A50194c222',
    borrowAsset: '0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a',
    borrowAssetSymbol: 'AUSD',
    borrowAssetDecimals: 6,
    inputTokens: [
      { address: '0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a', symbol: 'AUSD', decimals: 6 },
    ],
    routeType: 'enso',
    bptAddress: '0x2DAA146dfB7EAef0038F9F15B2EC1e4DE003f72b',
  },
  {
    id: 'pool2',
    name: 'sMON/WMON (Kintsu)',
    collateralVault: '0x578c60e6Df60336bE41b316FDE74Aa3E2a4E0Ea5',
    borrowVault: '0x75B6C392f778B8BCf9bdB676f8F128b4dD49aC19',
    borrowAsset: '0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A',
    borrowAssetSymbol: 'WMON',
    borrowAssetDecimals: 18,
    inputTokens: [
      { address: '0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A', symbol: 'WMON', decimals: 18 },
    ],
    routeType: 'enso',
    bptAddress: '0x3475Ea1c3451a9a10Aeb51bd8836312175B88BAc',
  },
  {
    id: 'pool3',
    name: 'shMON/WMON (Fastlane)',
    collateralVault: '0x6660195421557BC6803e875466F99A764ae49Ed7',
    borrowVault: '0x75B6C392f778B8BCf9bdB676f8F128b4dD49aC19',
    borrowAsset: '0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A',
    borrowAssetSymbol: 'WMON',
    borrowAssetDecimals: 18,
    inputTokens: [
      { address: '0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A', symbol: 'WMON', decimals: 18 },
    ],
    routeType: 'enso',
    bptAddress: '0x150360c0eFd098A6426060Ee0Cc4a0444c4b4b68',
  },
  {
    id: 'pool4',
    name: 'AZND/AUSD/LOAZND',
    collateralVault: '0x175831aF06c30F2EA5EA1e3F5EBA207735Eb9F92',
    borrowVault: '0x438cedcE647491B1d93a73d491eC19A50194c222',
    borrowAsset: '0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a',
    borrowAssetSymbol: 'AUSD',
    borrowAssetDecimals: 6,
    inputTokens: [
      { address: '0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a', symbol: 'AUSD', decimals: 6 },
    ],
    routeType: 'adapter',
    bptAddress: '0xD328E74AdD15Ac98275737a7C1C884ddc951f4D3',
  },
]

const MULTIPLIER_OPTIONS = [2, 3, 4, 5]

export const useLoopZap = () => {
  const wagmiConfig = useConfig()
  const { address, isConnected } = useAccount()
  const { buildMultiplyPlan, executeTxPlan } = useEulerOperations()
  const { eulerPeripheryAddresses, chainId: currentChainId } = useEulerAddresses()
  const { refreshAllPositions } = useEulerAccount()
  const { eulerLensAddresses } = useEulerAddresses()
  const { fetchSingleBalance } = useWallets()
  const { slippage } = useSlippage()
  const { bptAdapterConfig } = useDeployConfig()
  const { getEnsoRoute, buildEnsoSwapQuote, buildAdapterSwapQuote } = useEnsoRoute()
  const { getVault } = useVaultRegistry()
  const { error: showError, success: showSuccess } = useToast()

  const selectedPoolId = ref<string>(POOLS[0].id)
  const selectedMultiplier = ref<number>(3)
  const inputAmount = ref<string>('')
  const inputTokenAddress = ref<string>('')

  const isQuoting = ref(false)
  const isZapping = ref(false)
  const isMultiplying = ref(false)
  const quoteError = ref<string | null>(null)

  const walletBalance = ref<bigint>(0n)
  const expectedBptFromZap = ref<bigint>(0n)
  const bptReceivedFromZap = ref<bigint>(0n)

  // Two-phase state: 'input' → 'zapped' → 'done'
  const phase = ref<'input' | 'zapped' | 'done'>('input')

  const multiplyQuote = ref<SwapApiQuote | null>(null)
  const resolvedSubAccount = ref<string>('')

  const selectedPool = computed(() => POOLS.find(p => p.id === selectedPoolId.value)!)

  const selectedInputToken = computed(() => {
    const pool = selectedPool.value
    if (!pool) return null
    const token = pool.inputTokens.find(t => t.address === inputTokenAddress.value)
    return token || pool.inputTokens[0]
  })

  watch(selectedPoolId, () => {
    const pool = POOLS.find(p => p.id === selectedPoolId.value)
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

  const debtAmount = computed(() => {
    const input = inputAmountNano.value
    if (input <= 0n) return 0n
    return input * BigInt(selectedMultiplier.value - 1)
  })

  const totalExposure = computed(() => {
    const input = inputAmountNano.value
    if (input <= 0n) return 0n
    return input * BigInt(selectedMultiplier.value)
  })

  const borrowAmountFormatted = computed(() => {
    const pool = selectedPool.value
    if (!pool || debtAmount.value <= 0n) return '0'
    return formatUnits(debtAmount.value, pool.borrowAssetDecimals)
  })

  const totalExposureFormatted = computed(() => {
    const pool = selectedPool.value
    if (!pool || totalExposure.value <= 0n) return '0'
    return formatUnits(totalExposure.value, pool.borrowAssetDecimals)
  })

  const availableLiquidity = computed(() => {
    const pool = selectedPool.value
    if (!pool) return 0n
    const vault = getVault(pool.borrowVault)
    if (!vault || !('totalCash' in vault)) return 0n
    return vault.totalCash as bigint
  })

  const isInsufficientLiquidity = computed(() => {
    return debtAmount.value > 0n && debtAmount.value > availableLiquidity.value
  })

  const isInsufficient = computed(() => {
    return inputAmountNano.value > 0n && inputAmountNano.value > walletBalance.value
  })

  const isZapReady = computed(() => {
    return isConnected.value
      && inputAmountNano.value > 0n
      && !isInsufficient.value
      && !isInsufficientLiquidity.value
      && expectedBptFromZap.value > 0n
      && !quoteError.value
      && phase.value === 'input'
  })

  const isMultiplyReady = computed(() => {
    return isConnected.value
      && phase.value === 'zapped'
      && bptReceivedFromZap.value > 0n
      && multiplyQuote.value !== null
  })

  function resetState() {
    phase.value = 'input'
    expectedBptFromZap.value = 0n
    bptReceivedFromZap.value = 0n
    multiplyQuote.value = null
    quoteError.value = null
    resolvedSubAccount.value = ''
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

  // Fetch Zap-In preview (Enso or adapter)
  const fetchZapPreview = useDebounceFn(async () => {
    expectedBptFromZap.value = 0n
    quoteError.value = null

    const pool = selectedPool.value
    const input = inputAmountNano.value
    if (!pool || input <= 0n) return
    if (!currentChainId.value) return

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
        expectedBptFromZap.value = expectedBptOut
      }
      else {
        const ensoRoute = await getEnsoRoute({
          chainId: currentChainId.value,
          fromAddress: address.value! as Address,
          tokenIn: pool.borrowAsset as Address,
          tokenOut: pool.bptAddress as Address,
          amountIn: input,
          receiver: address.value! as Address,
          slippage: slippage.value,
        })
        expectedBptFromZap.value = BigInt(ensoRoute.amountOut)
      }
    }
    catch (e: any) {
      quoteError.value = e?.message || 'Failed to get zap preview'
      logWarn('loop-zap/preview', e)
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
      expectedBptFromZap.value = 0n
      quoteError.value = null
    }
  })

  // ── Tx 1: Zap In ──────────────────────────────────────────────
  async function executeZapIn() {
    const pool = selectedPool.value
    if (!pool || !address.value) return

    isZapping.value = true

    try {
      const input = inputAmountNano.value
      const userAddr = address.value as Address

      const bptBalanceBefore = await readContract(wagmiConfig, {
        address: pool.bptAddress as Address,
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
        const inputAddr = pool.borrowAsset as Address

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
          tokenIn: pool.borrowAsset as Address,
          tokenOut: pool.bptAddress as Address,
          amountIn: input,
          receiver: userAddr,
          slippage: slippage.value,
        })

        const ensoRouter = ensoRoute.tx.to as Address
        const inputAddr = pool.borrowAsset as Address

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

      const bptBalanceAfter = await readContract(wagmiConfig, {
        address: pool.bptAddress as Address,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [userAddr],
      })

      bptReceivedFromZap.value = bptBalanceAfter - bptBalanceBefore
      phase.value = 'zapped'
      showSuccess('Zap In complete — BPT received')

      await updateBalance()
      await fetchMultiplyQuote()
    }
    catch (e: any) {
      logWarn('loop-zap/zap-in', e)
      showError(e?.shortMessage || e?.message || 'Zap In failed')
    }
    finally {
      isZapping.value = false
    }
  }

  // ── Multiply quote (for Tx 2) ──────────────────────────────────
  async function fetchMultiplyQuote() {
    multiplyQuote.value = null

    const pool = selectedPool.value
    if (!pool || !eulerPeripheryAddresses.value?.swapper || !currentChainId.value || !address.value) return
    if (bptReceivedFromZap.value <= 0n || debtAmount.value <= 0n) return

    const swapperAddr = eulerPeripheryAddresses.value.swapper as Address
    const swapVerifierAddr = eulerPeripheryAddresses.value.swapVerifier as Address
    const collateralVaultAddr = pool.collateralVault as Address
    const borrowVaultAddr = pool.borrowVault as Address
    const tokenIn = pool.borrowAsset as Address
    const tokenOut = pool.bptAddress as Address
    const debt = debtAmount.value
    const deadline = Math.floor(Date.now() / 1000) + 1800

    const subAccount = await getNewSubAccount(address.value!) as Address
    resolvedSubAccount.value = subAccount

    const adapterEntry = bptAdapterConfig[collateralVaultAddr.toLowerCase()]
      || bptAdapterConfig[pool.collateralVault]

    try {
      if (adapterEntry?.pool && adapterEntry?.wrapper && adapterEntry?.numTokens) {
        const fullEntry = adapterEntry as BptAdapterConfigEntry
        const { expectedBptOut, minBptOut } = await previewAdapterZapIn(wagmiConfig, fullEntry, debt, slippage.value)
        const adapterCalldata = encodeAdapterZapIn(fullEntry.tokenIndex, debt, minBptOut)

        const quote = buildAdapterSwapQuote({
          swapperAddress: swapperAddr,
          swapVerifierAddress: swapVerifierAddr,
          collateralVault: collateralVaultAddr,
          borrowVault: borrowVaultAddr,
          subAccount,
          tokenIn,
          tokenOut,
          borrowAmount: debt,
          deadline,
          adapterAddress: fullEntry.adapter as Address,
          adapterCalldata,
          minAmountOut: minBptOut,
        })
        quote.amountOut = expectedBptOut.toString()
        quote.amountOutMin = minBptOut.toString()
        multiplyQuote.value = quote
      }
      else {
        const ensoRoute = await getEnsoRoute({
          chainId: currentChainId.value,
          fromAddress: swapperAddr,
          tokenIn,
          tokenOut,
          amountIn: debt,
          receiver: swapperAddr,
          slippage: slippage.value,
        })
        multiplyQuote.value = buildEnsoSwapQuote(ensoRoute, {
          swapperAddress: swapperAddr,
          swapVerifierAddress: swapVerifierAddr,
          collateralVault: collateralVaultAddr,
          borrowVault: borrowVaultAddr,
          subAccount,
          tokenIn,
          tokenOut,
          borrowAmount: debt,
          deadline,
        })
      }
    }
    catch (e: any) {
      logWarn('loop-zap/multiply-quote', e)
      showError('Failed to get multiply quote')
    }
  }

  // ── Tx 2: Multiply ────────────────────────────────────────────
  async function executeMultiply() {
    const pool = selectedPool.value
    if (!pool || !multiplyQuote.value || !address.value) return
    if (bptReceivedFromZap.value <= 0n) return

    isMultiplying.value = true

    try {
      const subAccount = resolvedSubAccount.value || await getNewSubAccount(address.value!) as string

      const plan = await buildMultiplyPlan({
        supplyVaultAddress: pool.collateralVault,
        supplyAssetAddress: pool.bptAddress,
        supplyAmount: bptReceivedFromZap.value,
        longVaultAddress: pool.collateralVault,
        longAssetAddress: pool.bptAddress,
        borrowVaultAddress: pool.borrowVault,
        debtAmount: debtAmount.value,
        quote: multiplyQuote.value,
        swapperMode: SwapperMode.EXACT_IN,
        subAccount,
        includePermit2Call: true,
      })

      await executeTxPlan(plan)

      phase.value = 'done'
      showSuccess('Multiply complete — leveraged position opened')

      refreshAllPositions(eulerLensAddresses.value, address.value || '')

      inputAmount.value = ''
      resetState()
      await updateBalance()
    }
    catch (e: any) {
      logWarn('loop-zap/multiply', e)
      showError(e?.shortMessage || e?.message || 'Multiply failed')
    }
    finally {
      isMultiplying.value = false
    }
  }

  return {
    pools: POOLS,
    multiplierOptions: MULTIPLIER_OPTIONS,

    selectedPoolId,
    selectedPool,
    selectedMultiplier,
    inputAmount,
    inputTokenAddress,
    selectedInputToken,

    inputAmountNano,
    debtAmount,
    totalExposure,
    borrowAmountFormatted,
    totalExposureFormatted,
    walletBalance,
    expectedBptFromZap,
    bptReceivedFromZap,
    availableLiquidity,
    isInsufficientLiquidity,
    isInsufficient,

    phase,
    isQuoting,
    isZapping,
    isMultiplying,
    quoteError,
    isZapReady,
    isMultiplyReady,

    executeZapIn,
    executeMultiply,
    updateBalance,
    resetState,
  }
}
