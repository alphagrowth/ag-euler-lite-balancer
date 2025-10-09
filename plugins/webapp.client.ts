export default defineNuxtPlugin(() => {
  const config = useRuntimeConfig().public
  const webapp = window.Telegram?.WebApp
  const tga = window?.telegramAnalytics
  const router = useRouter()
  const route = useRoute()

  const onBack = () => {
    if (window.history.length > 1) {
      router.go(-1)
    }
    else {
      router.push('/')
    }
  }

  if (!webapp) {
    return {
      provide: {
        webapp: {},
        haptic: {
          notificationOccurred: () => {},
          impactOccurred: () => {},
        },
      },
    }
  }

  if (tga && config.tgaToken && config.tgaName) {
    tga.init({
      token: config.tgaToken,
      appName: config.tgaName,
    })
    console.log('tga inited')
  }

  webapp.themeParams.bg_color = '#08131F'
  const haptic = webapp.HapticFeedback
  try {
    webapp.setHeaderColor(webapp.themeParams.bg_color)
  }
  catch (e) {
    console.warn('[TGA]:', e)
  }
  try {
    webapp.BackButton.onClick(onBack)
    webapp.enableClosingConfirmation()
    webapp.expand()
    webapp.disableVerticalSwipes()
  }
  catch (e) {
    console.warn('[TGA]:', e)
  }

  watch(() => route.name, (value) => {
    if (!webapp?.BackButton) {
      return
    }

    if (['index', 'borrow', 'portfolio', 'onboarding', 'portfolio-saving'].includes(value as string)) {
      webapp.BackButton.hide()
      return
    }

    webapp.BackButton.show()
  }, { immediate: true })

  return {
    provide: {
      webapp,
      haptic,
    },
  }
})
