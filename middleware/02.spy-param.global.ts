export default defineNuxtRouteMiddleware((to) => {
  if (import.meta.server) return

  // Read spy address directly from module-level ref (avoid calling useSpyMode in middleware)
  const spyParam = to.query.spy

  // If spy mode is active (address in memory) but ?spy missing from target route — re-add it
  // We check the existing query first; if it already has spy, nothing to do
  if (!spyParam) {
    // Access the singleton spy address by calling the composable
    const { spyAddress, isSpyMode } = useSpyMode()
    if (isSpyMode.value) {
      return navigateTo({
        path: to.path,
        query: {
          ...to.query,
          spy: spyAddress.value,
        },
        hash: to.hash,
      })
    }
  }
})
