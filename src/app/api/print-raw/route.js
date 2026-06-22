import net from 'net'

export async function POST(req) {
  try {
    const { ip, port = 9100, data } = await req.json()
    if (!ip || !data) return Response.json({ error: 'missing ip or data' }, { status: 400 })

    const bytes = Buffer.from(data, 'base64')

    await new Promise((resolve, reject) => {
      const socket = new net.Socket()
      socket.setTimeout(6000)

      socket.connect(port, ip, () => {
        socket.write(bytes, () => {
          socket.end()
          resolve()
        })
      })

      socket.on('timeout', () => { socket.destroy(); reject(new Error('timeout')) })
      socket.on('error', reject)
    })

    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
