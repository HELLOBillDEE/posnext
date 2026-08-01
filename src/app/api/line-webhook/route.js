export async function POST() {
  return new Response('OK', { status: 200 })
}

export async function GET() {
  return new Response('LINE webhook OK', { status: 200 })
}
