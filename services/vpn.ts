const CACHE_TTL_MS = 5 * 60 * 1000

let cached: { value: boolean, timestamp: number } | null = null

export async function detectVpn(): Promise<boolean> {
  if (cached !== null && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.value
  }

  try {
    const resp = await fetch(window.location.origin, { method: 'HEAD' })
    const header = resp.headers.get('x-is-vpn')
    cached = { value: header === 'true', timestamp: Date.now() }
  }
  catch {
    cached = { value: false, timestamp: Date.now() }
  }

  return cached.value
}

export function resetVpnCache(): void {
  cached = null
}
