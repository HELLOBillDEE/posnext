import net from 'net'
import { requireAuth, unauthorizedResponse } from '@/lib/authApi'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS })
}

export async function POST(req) {
  if (!await requireAuth(req)) return unauthorizedResponse()
  try {
    const { ip, port = 9100, data } = await req.json()
    if (!ip || !data) return Response.json({ error: 'missing ip or data' }, { status: 400, headers: CORS })

    const bytes = Buffer.from(data, 'base64')

    await new Promise((resolve, reject) => {
      const socket = new net.Socket()
      socket.setTimeout(6000)
      socket.connect(port, ip, () => { socket.write(bytes, () => { socket.end(); resolve() }) })
      socket.on('timeout', () => { socket.destroy(); reject(new Error('timeout')) })
      socket.on('error', reject)
    })

    return Response.json({ ok: true }, { headers: CORS })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500, headers: CORS })
  }
}
