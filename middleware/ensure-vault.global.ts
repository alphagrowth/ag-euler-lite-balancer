import { getAddress } from 'viem'
import { useToast } from '~/components/ui/composables/useToast'

export default defineNuxtRouteMiddleware(async (to) => {
  const { info } = useToast()
  if (import.meta.server) {
    return
  }

  const rawVault = to.params?.vault
  if (!rawVault) {
    return
  }

  let vaultAddress: string | null = null
  try {
    vaultAddress = getAddress(Array.isArray(rawVault) ? rawVault[0] : String(rawVault))
  }
  catch {
    info('This vault could not be found on this chain!')
    return navigateTo({
      path: '/',
      query: { ...to.query },
      hash: to.hash,
    }, { replace: true })
  }

  const { getVault } = useVaults()

  if (
    !to.path.includes('earn') && (!vaultAddress || !(await getVault(vaultAddress)))
  ) {
    console.warn('[ensure-vault] failed to load labels')
    info('This vault could not be found on this chain!')
    return navigateTo({
      path: '/',
      query: { ...to.query },
      hash: to.hash,
    }, { replace: true })
  }
})
