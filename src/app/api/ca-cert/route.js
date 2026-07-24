import { readFileSync } from 'fs'
import { join } from 'path'

export function GET() {
  try {
    const cert = readFileSync(join(process.cwd(), 'certificates', 'ca-cert.pem'))
    return new Response(cert, {
      headers: {
        'Content-Type': 'application/x-x509-ca-cert',
        'Content-Disposition': 'attachment; filename="CHERD-POS-CA.crt"',
        'Cache-Control': 'no-store',
      },
    })
  } catch {
    return new Response('Not found', { status: 404 })
  }
}
