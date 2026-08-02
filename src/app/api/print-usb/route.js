import { execFile } from 'child_process'
import { promises as fs, createWriteStream } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

export const runtime = 'nodejs'

// POST /api/print-usb — ส่ง ESC/POS ตรงไปเครื่องพิมพ์ USB บน Windows
// usb_port: ชื่อ Windows printer (เช่น "Vozy") หรือ port (เช่น "USB004")
export async function POST(req) {
  try {
    const { data, usb_port } = await req.json()
    if (!data) return Response.json({ error: 'ไม่มีข้อมูล' }, { status: 400 })

    const bytes = Buffer.from(data, 'base64')
    const target = (usb_port || 'USB001').trim()
    const tmp = join(tmpdir(), `pos_print_${Date.now()}.bin`)
    await fs.writeFile(tmp, bytes)

    // วิธี 1: เขียนตรงไปที่ Windows device path \\.\USB004
    const devicePath = `\\\\.\\${target}`
    try {
      await new Promise((resolve, reject) => {
        const stream = createWriteStream(devicePath, { flags: 'w' })
        stream.on('error', reject)
        stream.on('finish', resolve)
        stream.write(bytes)
        stream.end()
      })
      await fs.unlink(tmp).catch(() => {})
      return Response.json({ ok: true })
    } catch {
      // วิธี 2: fallback — copy /b ผ่าน cmd
      await new Promise((resolve, reject) => {
        execFile('cmd', ['/c', 'copy', '/b', tmp, target], (err, stdout, stderr) => {
          fs.unlink(tmp).catch(() => {})
          if (err) reject(new Error((stderr || stdout || err.message || '').trim()))
          else resolve()
        })
      })
      return Response.json({ ok: true })
    }
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
