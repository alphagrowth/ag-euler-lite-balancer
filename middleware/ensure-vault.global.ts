import { useToast } from '~/components/ui/composables/useToast'
import { getAddress } from 'viem'

export default defineNuxtRouteMiddleware(async (to) => {
  const { info } = useToast()
  if (process.server) {
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

  const { vaults, loadLabels } = useEulerLabels()

  if (!Object.keys(vaults).length) {
    try {
      await loadLabels()
    }
    catch (err) {
      console.warn('[ensure-vault] failed to load labels', err)
      info('This vault could not be found on this chain!')
      return navigateTo({
        path: '/',
        query: { ...to.query },
        hash: to.hash,
      }, { replace: true })
    }
  }

  if (!vaultAddress || !vaults[vaultAddress]) {
    info('This vault could not be found on this chain!')
    return navigateTo({
      path: '/',
      query: { ...to.query },
      hash: to.hash,
    }, { replace: true })
  }
})
