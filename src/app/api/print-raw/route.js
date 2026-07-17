import net from 'net'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS })
}

export async function POST(req) {
  try {
    const { ip, port = 9100, data } = await req.json()
    if (!ip || !data) return Response.json({ error: 'missing ip or data' }, { status: 400, headers: CORS })

    const bytes = Buffer.from(data, 'base64')

    await new Promise((resolve, reject) => {
      const socket = new net.Socket()
      let done = false
      let connected = false
      const finish = (err) => { if (!done) { done = true; socket.destroy(); err ? reject(err) : resolve() } }

      // connect timeout 4 วิ — ถ้าต่อไม่ติดเลย = error จริง
      const connectTimer = setTimeout(() => {
        if (!connected) finish(new Error(`เชื่อมต่อ ${ip}:${port} ไม่ได้`))
      }, 4000)

      socket.connect(port, ip, () => {
        clearTimeout(connectTimer)
        connected = true
        socket.setTimeout(8000)
        socket.write(bytes, () => {
          socket.end()  // graceful FIN — ให้ kernel flush ข้อมูลก่อนปิด
        })
      })

      socket.on('close',   () => finish())
      socket.on('end',     () => finish())
      socket.on('timeout', () => finish())  // printer ไม่ส่ง FIN กลับ — assume success
      socket.on('error', err => {
        if (!connected) finish(err)   // ต่อไม่ติด = error จริง
        else finish()                 // error หลัง connect = printer รับข้อมูลแล้ว (ECONNRESET, EPIPE ฯลฯ)
      })
    })

    return Response.json({ ok: true }, { headers: CORS })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500, headers: CORS })
  }
}
