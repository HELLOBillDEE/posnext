const SUBDOMAINS = ['a', 'b', 'c']

export async function GET(req, { params }) {
  const [z, x, yExt] = params.slug
  const y = yExt?.replace('.png', '')
  if (!z || !x || !y) return new Response('bad params', { status: 400 })

  const sub = SUBDOMAINS[parseInt(x) % 3]
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)

  try {
    const res = await fetch(
      `https://${sub}.tile.openstreetmap.org/${z}/${x}/${y}.png`,
      {
        headers: { 'User-Agent': 'POSNEXT/1.0 (delivery map)' },
        signal: controller.signal,
      }
    )
    clearTimeout(timer)
    if (!res.ok) return new Response('tile not found', { status: 404 })
    const buf = await res.arrayBuffer()
    return new Response(buf, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=86400',
        'Access-Control-Allow-Origin': '*',
      },
    })
  } catch {
    clearTimeout(timer)
    return new Response('fetch error', { status: 502 })
  }
}
