import { invalidateCache } from '@/lib/serverCache'

export const runtime = 'nodejs'

// POST /api/pos-data/invalidate?key=products
// key: products | categories | settings | employees | (ว่าง = clear ทั้งหมด)
export async function POST(req) {
  const key = new URL(req.url).searchParams.get('key')
  invalidateCache(key ? `srv:${key}` : null)
  return Response.json({ ok: true, cleared: key || 'all' })
}
