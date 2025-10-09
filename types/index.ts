export {}

declare global {
  interface Window {
    Telegram: any
    telegramAnalytics: any
    pw: any
    gtag: any
    onTelegramAuth: any
  }
}
