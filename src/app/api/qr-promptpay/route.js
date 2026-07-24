import generatePayload from 'promptpay-qr'
import QRCode from 'qrcode'

export async function GET(req) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  const amount = parseFloat(searchParams.get('amount') || 0)

  if (!id) return Response.json({ error: 'id required' }, { status: 400 })

  try {
    const payload = generatePayload(id, amount > 0 ? { amount } : {})
    const dataUrl = await QRCode.toDataURL(payload, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 360,
      color: { dark: '#000000', light: '#ffffff' },
    })
    return Response.json({ dataUrl })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
