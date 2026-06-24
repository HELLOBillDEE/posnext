const ALLOWED_HOSTS = [
  'supabase.co',
  'supabase.in',
  'profile.line-scdn.net',
  'obs.line-scdn.net',
  'stickershop.line-scdn.net',
]

function isAllowed(urlStr) {
  try {
    const { hostname, protocol } = new URL(urlStr)
    if (protocol !== 'https:') return false
    return ALLOWED_HOSTS.some(h => hostname === h || hostname.endsWith('.' + h))
  } catch {
    return false
  }
}

export async function GET(req) {
  const url = new URL(req.url).searchParams.get('url')
  if (!url) return new Response('missing url', { status: 400 })
  if (!isAllowed(url)) return new Response('domain not allowed', { status: 403 })
  try {
    const res = await fetch(url)
    const buf = await res.arrayBuffer()
    return new Response(buf, {
      headers: {
        'Content-Type': res.headers.get('content-type') || 'image/png',
        'Cache-Control': 'public, max-age=86400',
        'Access-Control-Allow-Origin': '*',
      },
    })
  } catch (e) {
    return new Response('fetch failed', { status: 502 })
  }
}
