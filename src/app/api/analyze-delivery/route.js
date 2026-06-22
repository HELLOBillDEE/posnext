import Anthropic from '@anthropic-ai/sdk'

export async function POST(req) {
  try {
    const { imageBase64, mediaType } = await req.json()
    if (!imageBase64) return Response.json({ error: 'No image' }, { status: 400 })

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: imageBase64 },
          },
          {
            type: 'text',
            text: `นี่คือใบส่งของ/ใบกำกับภาษีจากซัพพลายเออร์ กรุณาอ่านและแยกรายการสินค้าออกมาให้ครบถ้วน

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
          },
        ],
      }],
    })

    const text = message.content[0].text.trim()

    // ลบ markdown code block ออก (```json ... ``` หรือ ``` ... ```)
    const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()

    // หา JSON object ที่ใหญ่ที่สุดใน response
    let result = null
    const match = stripped.match(/\{[\s\S]*\}/)
    if (match) {
      try { result = JSON.parse(match[0]) } catch(_) {}
    }
    // fallback: parse ทั้ง string เลย
    if (!result) {
      try { result = JSON.parse(stripped) } catch(_) {}
    }

    if (!result) {
      return Response.json({ error: 'ไม่สามารถอ่านใบส่งของได้ กรุณาถ่ายใหม่ให้ชัดขึ้น', raw: text.substring(0, 300) }, { status: 422 })
    }

    return Response.json(result)
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
