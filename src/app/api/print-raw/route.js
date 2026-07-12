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

      // Phase 1: connect timeout — ถ้าต่อไม่ติดภายใน 4 วิ = error
      const connectTimer = setTimeout(() => {
        if (!connected) finish(new Error(`เชื่อมต่อ ${ip}:${port} ไม่ได้`))
      }, 4000)

      socket.connect(port, ip, () => {
        clearTimeout(connectTimer)
        connected = true
        // Phase 2: data timeout — ต่อติดแล้ว รอ FIN จาก printer สูงสุด 8 วิ
        socket.setTimeout(8000)
        socket.write(bytes, () => {
          socket.end() // ส่ง FIN บอก printer ว่าหมดข้อมูลแล้ว (graceful)
        })
      })
      // รอ printer ปิด connection เองหลัง process เสร็จ
      socket.on('close', () => finish())
      socket.on('end',   () => finish())
      socket.on('timeout', () => finish()) // ต่อติดแต่ไม่มี FIN — assume success
      // ECONNRESET = printer closed connection after receiving data — treat as success
      socket.on('error', err => err.code === 'ECONNRESET' ? finish() : finish(err))
    })

    return Response.json({ ok: true }, { headers: CORS })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500, headers: CORS })
  }
}
