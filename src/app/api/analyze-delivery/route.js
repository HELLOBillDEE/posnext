import { GoogleGenerativeAI } from '@google/generative-ai'

export async function POST(req) {
  try {
    const { imageBase64, mediaType } = await req.json()
    if (!imageBase64) return Response.json({ error: 'No image' }, { status: 400 })

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' })

    const result = await model.generateContent([
      {
        inlineData: { data: imageBase64, mimeType: mediaType || 'image/jpeg' },
      },
      `คุณคือผู้ช่วยอ่านใบส่งของ/ใบกำกับภาษี/ใบเสร็จจากซัพพลายเออร์ของร้านค้าปลีกในประเทศไทย

กฎทั่วไป:
- อ่านชื่อสินค้าให้ครบ รวมรุ่น/ขนาด/สี
- ภาษาไทยเก็บเป็นไทย ภาษาอังกฤษ/รหัสสินค้าเก็บตามต้นฉบับ
- ถ้ามีบาร์โค้ด/รหัสสินค้าให้ใส่ใน barcode
- ห้ามรวม VAT ในราคาต่อหน่วย

━━━ วิธีคำนวณเมื่อเจอหน่วย "ลัง-Y" ━━━

เอกสารแสดงจำนวนเป็น "X ลัง-Y" เช่น "3 ลัง-8"
หมายความว่า: ซื้อ X ลัง โดยแต่ละลังมี Y ชิ้น

ขั้นตอนคำนวณ (ทำทีละขั้น):
1. อ่าน X = จำนวนลัง, Y = ชิ้นต่อลัง
2. อ่าน "จำนวนเงิน" (คอลัมน์ขวาสุด) = ราคารวมทั้งหมดของ row นั้น → ใช้เป็น total
3. qty = X × Y  (หน่วยปลีกรวม)
4. unit_cost = total ÷ qty  (ราคาต่อชิ้นปลีก)
5. unit = "ชิ้น" (หรือหน่วยปลีกที่เหมาะสม เช่น กระป๋อง ขวด)

ตัวอย่างเจาะจง:
- "1 ลัง-24", จำนวนเงิน 2490 → qty=24, unit_cost=2490÷24=103.75
- "1 ลัง-3",  จำนวนเงิน 2270 → qty=3,  unit_cost=2270÷3=756.67
- "2 ลัง-4",  จำนวนเงิน 3940 → qty=8,  unit_cost=3940÷8=492.50
- "3 ลัง-8",  จำนวนเงิน 8070 → qty=24, unit_cost=8070÷24=336.25
- "2 ลัง-12", จำนวนเงิน 2160 → qty=24, unit_cost=2160÷24=90.00

คอลัมน์ "ราคา" ในเอกสาร = ราคาต่อลัง (ห้ามใช้โดยตรงเป็น unit_cost)
ใช้สูตร: unit_cost = จำนวนเงิน ÷ qty เสมอ

ตอบกลับด้วย raw JSON เท่านั้น ห้ามมี markdown, ห้ามมี code block, ห้ามมีคำอธิบาย:
{
  "supplier": "ชื่อซัพพลายเออร์ (ถ้ามี)",
  "invoice_no": "เลขที่ใบส่งของ (ถ้ามี)",
  "invoice_date": "วันที่ (YYYY-MM-DD ถ้าแปลงได้)",
  "items": [
    {
      "name": "ชื่อสินค้า รวมรุ่น/ขนาด/สี",
      "barcode": "บาร์โค้ด/รหัสสินค้า หรือ null",
      "qty": จำนวนหน่วยปลีกรวม = X×Y (ตัวเลข),
      "unit": "หน่วยปลีก เช่น ชิ้น กระป๋อง ขวด กล่อง (ไม่ใช่ ลัง)",
      "unit_cost": จำนวนเงิน÷qty (ตัวเลข ทศนิยม 2 ตำแหน่ง ไม่รวม VAT),
      "total": จำนวนเงินในเอกสาร (ตัวเลข ก่อน VAT)
    }
  ],
  "grand_total": ราคารวมทั้งหมดก่อน VAT (ตัวเลข)
}

ถ้าอ่านข้อมูลบางส่วนไม่ออก ให้ใส่ null`,
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
