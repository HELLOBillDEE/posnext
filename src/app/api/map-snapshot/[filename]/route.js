import { readFile } from 'fs/promises'
import { join } from 'path'

export const runtime = 'nodejs'

const SAVE_DIR = process.env.MAP_SNAPSHOT_DIR || join(process.cwd(), 'map-snapshots')

export async function GET(req, { params }) {
  try {
    const filename = params.filename.replace(/[^a-zA-Z0-9.\-_]/g, '_')
    const buf = await readFile(join(SAVE_DIR, filename))
    return new Response(buf, { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=31536000' } })
  } catch {
    return new Response('Not found', { status: 404 })
  }
}
