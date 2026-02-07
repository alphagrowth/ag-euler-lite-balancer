let cached: boolean | null = null

export async function detectVpn(): Promise<boolean> {
  if (cached !== null) {
    return cached
  }

  try {
    const resp = await fetch(window.location.origin, { method: 'HEAD' })
    const header = resp.headers.get('x-is-vpn')
    cached = header === 'true'
  }
  catch {
    cached = false
  }

  return cached
}

export function resetVpnCache(): void {
  cached = null
}
