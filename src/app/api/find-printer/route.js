import { execSync, exec } from 'child_process'
import net from 'net'
import os from 'os'

function normalizeMac(mac) {
  return mac.toLowerCase().replace(/-/g, ':')
}

function testPort(ip, port, ms = 2000) {
  return new Promise(resolve => {
    const s = new net.Socket()
    let done = false
    const finish = ok => { if (!done) { done = true; s.destroy(); resolve(ok) } }
    s.setTimeout(ms)
    s.connect(port, ip, () => finish(true))
    s.on('timeout', () => finish(false))
    s.on('error', () => finish(false))
  })
}

function findMacInArp(mac) {
  try {
    const out = execSync('arp -a 2>/dev/null', { timeout: 3000 }).toString()
    const nm = normalizeMac(mac)
    for (const line of out.split('\n')) {
      if (normalizeMac(line).includes(nm)) {
        const m = line.match(/\((\d+\.\d+\.\d+\.\d+)\)/)
        if (m) return m[1]
      }
    }
  } catch {}
  return null
}

function getLocalSubnet() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address.split('.').slice(0, 3).join('.')
      }
    }
  }
  return null
}

function pingSweep(subnet, from = 1, to = 120) {
  return Promise.all(
    Array.from({ length: to - from + 1 }, (_, i) => i + from).map(i =>
      new Promise(r => exec(`ping -c 1 -W 1 ${subnet}.${i} 2>/dev/null`, () => r()))
    )
  )
}

export async function POST(req) {
  const { mac, port = 9100 } = await req.json()
  if (!mac) return Response.json({ error: 'missing mac' }, { status: 400 })

  // ตรวจ ARP cache ก่อน (เร็วสุด)
  let ip = findMacInArp(mac)
  if (ip && await testPort(ip, port)) return Response.json({ ip })

  // Ping-sweep เพื่อเติม ARP table แล้วหา MAC อีกรอบ
  const subnet = getLocalSubnet()
  if (!subnet) return Response.json({ ip: null }, { status: 404 })

  await pingSweep(subnet, 1, 120)

  ip = findMacInArp(mac)
  if (ip && await testPort(ip, port)) return Response.json({ ip })

  return Response.json({ ip: null }, { status: 404 })
}
