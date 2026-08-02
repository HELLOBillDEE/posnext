import { execFile } from 'child_process'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

export const runtime = 'nodejs'

// POST /api/print-usb — ส่ง ESC/POS ผ่าน Windows Printing API
// usb_port: ชื่อเครื่องพิมพ์ใน Windows เช่น "เครื่องพิมพ์ใบเสร็จ"
export async function POST(req) {
  try {
    const { data, usb_port } = await req.json()
    if (!data) return Response.json({ error: 'ไม่มีข้อมูล' }, { status: 400 })

    const bytes = Buffer.from(data, 'base64')
    const tmp = join(tmpdir(), `pos_print_${Date.now()}.bin`)
    await fs.writeFile(tmp, bytes)

    const printerName = (usb_port || 'Receipt Printer').trim()
    const script = join(process.cwd(), 'print-raw.ps1')

    await new Promise((resolve, reject) => {
      execFile('powershell', [
        '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', script,
        '-PrinterName', printerName,
        '-FilePath', tmp,
      ], (err, stdout, stderr) => {
        fs.unlink(tmp).catch(() => {})
        if (err) reject(new Error((stderr || stdout || err.message || '').trim()))
        else resolve()
      })
    })

    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
