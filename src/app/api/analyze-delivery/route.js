import { GoogleGenerativeAI } from '@google/generative-ai'
import { requireAuth, unauthorizedResponse } from '@/lib/authApi'

export async function POST(req) {
  if (!await requireAuth(req)) return unauthorizedResponse()
  try {
    const { imageBase64, mediaType } = await req.json()
    if (!imageBase64) return Response.json({ error: 'No image' }, { status: 400 })

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' })

    const result = await model.generateContent([
      {
        inlineData: { data: imageBase64, mimeType: mediaType || 'image/jpeg' },
      },
      `นี่คือใบส่งของ/ใบกำกับภาษีจากซัพพลายเออร์ กรุณาอ่านและแยกรายการสินค้าออกมาให้ครบถ้วน

ตอบกลับด้วย raw JSON เท่านั้น ห้ามมี markdown, ห้ามมี code block, ห้ามมีคำอธิบาย:
{
  "supplier": "ชื่อซัพพลายเออร์ (ถ้ามี)",
  "invoice_no": "เลขที่ใบส่งของ (ถ้ามี)",
  "invoice_date": "วันที่ (YYYY-MM-DD ถ้าแปลงได้)",
  "items": [
    {
      "name": "ชื่อสินค้า",
      "barcode": "บาร์โค้ด/รหัสสินค้า (ถ้ามี)",
      "qty": จำนวน (ตัวเลข),
      "unit": "หน่วย (ชิ้น/กล่อง/ถุง ฯลฯ)",
      "unit_cost": ราคาต่อหน่วย (ตัวเลข),
      "total": ราคารวม (ตัวเลข)
    }
  ],
  "grand_total": ราคารวมทั้งหมด (ตัวเลข)
}

ถ้าอ่านข้อมูลบางส่วนไม่ออก ให้ใส่ null สำหรับช่องนั้น`,
    ])

    const text = result.response.text().trim()
    const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()

    let parsed = null
    const match = stripped.match(/\{[\s\S]*\}/)
    if (match) { try { parsed = JSON.parse(match[0]) } catch(_) {} }
    if (!parsed) { try { parsed = JSON.parse(stripped) } catch(_) {} }

    if (!parsed) {
      return Response.json({ error: 'ไม่สามารถอ่านใบส่งของได้ กรุณาถ่ายใหม่ให้ชัดขึ้น', raw: text.substring(0, 300) }, { status: 422 })
    }

    return Response.json(parsed)
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
