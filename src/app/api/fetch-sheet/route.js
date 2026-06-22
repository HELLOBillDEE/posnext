import { requireAuth, unauthorizedResponse } from '@/lib/authApi'

export async function POST(req) {
  if (!await requireAuth(req)) return unauthorizedResponse()
  try {
    const { url } = await req.json()
    if (!url) return Response.json({ error: 'No URL' }, { status: 400 })

    const csvUrl = sheetToCsvUrl(url)
    if (!csvUrl) return Response.json({ error: 'URL ไม่ถูกต้อง ต้องเป็น Google Sheets URL' }, { status: 400 })

    const res = await fetch(csvUrl, { redirect: 'follow' })
    if (!res.ok) return Response.json({ error: `ดึงข้อมูลไม่ได้ (${res.status}) — ตรวจสอบว่าแชร์เป็น "Anyone with the link"` }, { status: 502 })

    const text = await res.text()
    if (!text.trim()) return Response.json({ error: 'ชีทว่างเปล่า' }, { status: 422 })

    return new Response(text, { headers: { 'Content-Type': 'text/csv; charset=utf-8' } })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

function sheetToCsvUrl(input) {
  try {
    // Support both full URLs and just the spreadsheet ID
    const match = input.match(/\/spreadsheets\/d\/([\w-]+)/)
    if (!match) return null
    const id = match[1]

    // Extract gid if present
    const gidMatch = input.match(/[#&?]gid=(\d+)/)
    const gid = gidMatch ? gidMatch[1] : '0'

    return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`
  } catch { return null }
}
