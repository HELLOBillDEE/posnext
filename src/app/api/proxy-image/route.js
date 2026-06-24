export async function GET(req) {
  const url = new URL(req.url).searchParams.get('url')
  if (!url) return new Response('missing url', { status: 400 })
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
    return new Response('fetch failed: ' + e.message, { status: 502 })
  }
}
