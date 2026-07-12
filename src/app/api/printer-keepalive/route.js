import net from 'net'

function connect(ip, port) {
  return new Promise(resolve => {
    const socket = new net.Socket()
    let done = false
    const finish = () => { if (!done) { done = true; socket.destroy(); resolve() } }
    socket.setTimeout(4000)
    socket.connect(Number(port) || 9100, ip, () => socket.end())
    socket.on('close', finish)
    socket.on('timeout', finish)
    socket.on('error', finish)
  })
}

function pingESCPOS(ip, port) {
  return new Promise(resolve => {
    const socket = new net.Socket()
    let done = false
    const finish = () => { if (!done) { done = true; socket.destroy(); resolve() } }
    socket.setTimeout(4000)
    socket.connect(Number(port) || 9100, ip, () => {
      // ESC @ = init เครื่องพิม — ไม่พิมอะไร
      socket.write(Buffer.from([0x1B, 0x40]), () => socket.end())
    })
    socket.on('close', finish)
    socket.on('timeout', finish)
    socket.on('error', finish)
  })
}

export async function POST(req) {
  try {
    const { receipt, barcode } = await req.json()
    const results = {}

    if (receipt?.ip) {
      await pingESCPOS(receipt.ip, receipt.port)
      results.receipt = 'ok'
    }

    if (barcode?.ip) {
      // connect+disconnect เท่านั้น — ไม่ส่ง TSPL ใดๆ เพื่อไม่ให้เปลี่ยน SIZE/GAP ของ printer
      await connect(barcode.ip, barcode.port)
      results.barcode = 'ok'
    }

    return Response.json({ ok: true, ...results })
  } catch (e) {
    return Response.json({ ok: false, error: e.message }, { status: 500 })
  }
}
