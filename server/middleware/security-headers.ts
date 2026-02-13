import { setResponseHeader } from 'h3'

const isDevelopment = process.env.NODE_ENV === 'development'

export default defineEventHandler((event) => {
  // Prevent clickjacking: deny all framing
  setResponseHeader(event, 'X-Frame-Options', 'DENY')

  // Prevent MIME-type sniffing
  setResponseHeader(event, 'X-Content-Type-Options', 'nosniff')

  // Control referrer information leakage
  setResponseHeader(event, 'Referrer-Policy', 'strict-origin-when-cross-origin')

  // Restrict browser features the app does not need
  setResponseHeader(event, 'Permissions-Policy', 'geolocation=(), microphone=(), camera=()')

  // HSTS: only in production (localhost uses plain HTTP in dev)
  if (!isDevelopment) {
    setResponseHeader(
      event,
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains; preload',
    )
  }
})
