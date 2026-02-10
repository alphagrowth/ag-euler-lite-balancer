const THEME_KEY = 'theme'

type Theme = 'light' | 'dark'

const getSystemTheme = (): Theme => {
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

const theme = ref<Theme>('light')
let initialized = false

export const useTheme = () => {
  if (!initialized && import.meta.client) {
    const stored = localStorage.getItem(THEME_KEY) as Theme | null
    theme.value = stored ?? getSystemTheme()
    initialized = true
  }

  const isDark = computed(() => theme.value === 'dark')

  const toggleTheme = () => {
    theme.value = theme.value === 'dark' ? 'light' : 'dark'
    localStorage.setItem(THEME_KEY, theme.value)
  }

  return { theme: readonly(theme), isDark, toggleTheme }
}
