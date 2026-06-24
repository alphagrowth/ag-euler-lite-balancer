import { computed, ref, unref, watchEffect, type ComputedRef, type Ref } from 'vue'
import type { SecuritizeVault, Vault } from '~/entities/vault'
import { isBptCollateralVault } from '~/entities/custom'
import { isWrapperCollateralVault } from '~/entities/wrapperRoutes'
import { getAssetUsdValue, getCollateralUsdValue } from '~/services/pricing/priceProvider'
import { computeMultipliedPriceImpact } from '~/utils/priceImpact'
import { createRaceGuard } from '~/utils/race-guard'

type MaybeRef<T> = Ref<T> | ComputedRef<T>

export const useMultiplyPriceImpact = (options: {
  isLoading: MaybeRef<boolean>
  isSwapReady: MaybeRef<boolean>
  swapAmountIn: MaybeRef<bigint>
  swapAmountOut: MaybeRef<bigint>
  shortVault: MaybeRef<Vault | null | undefined>
  longVault: MaybeRef<Vault | SecuritizeVault | null | undefined>
  multiplier: MaybeRef<number | null>
  chainId: MaybeRef<number | null | undefined>
}) => {
  const multiplyPriceImpact = ref<number | null>(null)
  const guard = createRaceGuard()

  const reset = () => {
    guard.next()
    multiplyPriceImpact.value = null
  }

  watchEffect(async () => {
    const isLoading = unref(options.isLoading)
    const isSwapReady = unref(options.isSwapReady)
    const shortVault = unref(options.shortVault)
    const longVault = unref(options.longVault)

    if (isLoading || !isSwapReady || !shortVault || !longVault) {
      reset()
      return
    }

    if (
      isBptCollateralVault(longVault.address)
      || isWrapperCollateralVault(unref(options.chainId) ?? undefined, longVault.address)
    ) {
      reset()
      return
    }

    const swapIn = unref(options.swapAmountIn)
    const swapOut = unref(options.swapAmountOut)
    if (swapIn <= 0n || swapOut <= 0n) {
      reset()
      return
    }

    const gen = guard.next()
    const amountInUsd = await getAssetUsdValue(swapIn, shortVault, 'off-chain')
    let amountOutUsd = await getCollateralUsdValue(swapOut, shortVault, longVault, 'off-chain')
    if (amountOutUsd === undefined) {
      amountOutUsd = await getAssetUsdValue(swapOut, longVault, 'off-chain')
    }
    if (guard.isStale(gen)) return

    if (!amountInUsd || !amountOutUsd) {
      multiplyPriceImpact.value = null
      return
    }

    const impact = (amountOutUsd / amountInUsd - 1) * 100
    multiplyPriceImpact.value = Number.isFinite(impact) ? impact : null
  })

  const multipliedPriceImpact = computed(() =>
    computeMultipliedPriceImpact(multiplyPriceImpact.value, unref(options.multiplier)),
  )

  return {
    multiplyPriceImpact,
    multipliedPriceImpact,
  }
}
