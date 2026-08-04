import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'

export const runtime = 'nodejs'

const SAVE_DIR = process.env.MAP_SNAPSHOT_DIR || join(process.cwd(), 'map-snapshots')
mkdir(SAVE_DIR, { recursive: true }).catch(() => {})

export async function POST(req) {
  try {
    const { dataUrl, filename } = await req.json()
    if (!dataUrl || !filename) return Response.json({ error: 'ข้อมูลไม่ครบ' }, { status: 400 })

    const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '')
    const buffer = Buffer.from(base64, 'base64')
    const safeName = filename.replace(/[^a-zA-Z0-9.\-_]/g, '_')
    await writeFile(join(SAVE_DIR, safeName), buffer)

    return Response.json({ ok: true, path: `/api/map-snapshot/${safeName}` })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
