export const runtime = 'nodejs'

export async function GET() {
  return Response.json({ usb: process.platform === 'win32' })
}
