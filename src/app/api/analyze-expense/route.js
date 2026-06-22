import { GoogleGenerativeAI } from '@google/generative-ai'

export async function POST(req) {
  try {
    const { imageBase64, mediaType } = await req.json()
    if (!imageBase64) return Response.json({ error: 'No image' }, { status: 400 })

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' })

    const result = await model.generateContent([
      {
        inlineData: { data: imageBase64, mimeType: mediaType || 'image/jpeg' },
      },
      `นี่คือบิลค่าใช้จ่าย กรุณาอ่านแล้วตอบกลับด้วย raw JSON เท่านั้น ห้ามมี markdown หรือคำอธิบาย:
{
  "description": "รายละเอียดค่าใช้จ่าย",
  "amount": ยอดรวม (ตัวเลข),
  "category": "ประเภท เช่น ค่าน้ำไฟ/ค่าเช่า/ค่าวัสดุ/ค่าขนส่ง/อื่นๆ",
  "expense_date": "วันที่ (YYYY-MM-DD ถ้าแปลงได้)"
}`,
    ])

    const text = result.response.text().trim()
    const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
    let parsed = null
    const match = stripped.match(/\{[\s\S]*\}/)
    if (match) { try { parsed = JSON.parse(match[0]) } catch(_) {} }
    if (!parsed) { try { parsed = JSON.parse(stripped) } catch(_) {} }
    if (!parsed) return Response.json({ error: 'อ่านไม่ได้ ลองถ่ายใหม่' }, { status: 422 })

    return Response.json(parsed)
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
