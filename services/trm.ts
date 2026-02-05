export async function screenAddress(
  trmUri: string,
  address: string,
  vpnIsUsed: boolean,
): Promise<boolean> {
  if (!trmUri || !address) return false

  try {
    const resp = await fetch(trmUri, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        address,
        chain: 'all',
        vpnIsUsed: String(vpnIsUsed),
      }),
    })

    const data = await resp.json()
    return Boolean(data?.addressIsSuspicious)
  }
  catch {
    return false
  }
}
