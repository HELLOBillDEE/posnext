import Anthropic from '@anthropic-ai/sdk'

export async function POST(req) {
  try {
    const { imageBase64, mediaType } = await req.json()
    if (!imageBase64) return Response.json({ error: 'No image' }, { status: 400 })

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: imageBase64 },
          },
          {
            type: 'text',
            text: `นี่คือบิลค่าใช้จ่าย กรุณาอ่านแล้วตอบกลับด้วย raw JSON เท่านั้น ห้ามมี markdown หรือคำอธิบาย:
{
  "description": "รายละเอียดค่าใช้จ่าย",
  "amount": ยอดรวม (ตัวเลข),
  "category": "ประเภท เช่น ค่าน้ำไฟ/ค่าเช่า/ค่าวัสดุ/ค่าขนส่ง/อื่นๆ",
  "expense_date": "วันที่ (YYYY-MM-DD ถ้าแปลงได้)"
}`,
          },
        ],
      }],
    })

    const text = message.content[0].text.trim()
    const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
    let result = null
    const match = stripped.match(/\{[\s\S]*\}/)
    if (match) { try { result = JSON.parse(match[0]) } catch(_) {} }
    if (!result) { try { result = JSON.parse(stripped) } catch(_) {} }
    if (!result) return Response.json({ error: 'อ่านไม่ได้ ลองถ่ายใหม่' }, { status: 422 })

    return Response.json(result)
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
