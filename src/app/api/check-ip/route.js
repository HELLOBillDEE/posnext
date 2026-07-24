export async function GET(req) {
  const ip = new URL(req.url).searchParams.get('ip')
  if (!ip) return Response.json({ online: false })

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 1500)

  try {
    const res = await fetch(`http://${ip}/`, { signal: ctrl.signal, redirect: 'manual' })
    clearTimeout(timer)
    const text = await res.text().catch(() => '')
    const isDahua = /dahua|dh-|ipc-|nvr|dvr/i.test(text) || res.headers.get('server')?.toLowerCase().includes('dahua')
    return Response.json({ online: true, status: res.status, dahua: isDahua })
  } catch (e) {
    clearTimeout(timer)
    return Response.json({ online: false })
  }
}
