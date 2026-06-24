import { createClient } from '@supabase/supabase-js'

// LINE sends events here — used once to capture the Group ID
export async function POST(req) {
  try {
    const body = await req.json()
    const events = body.events || []

    for (const event of events) {
      const source = event.source
      // Capture group/room ID when bot is added or someone sends a message in a group
      if (source?.type === 'group' && source?.groupId) {
        const supabase = createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
          { db: { schema: 'pos' } }
        )
        await supabase.from('settings').upsert(
          { key: 'line_group_id', value: source.groupId },
          { onConflict: 'key' }
        )
        break
      }
    }
    return new Response('OK', { status: 200 })
  } catch {
    return new Response('OK', { status: 200 }) // LINE requires 200 always
  }
}

// LINE verifies webhook with GET
export async function GET() {
  return new Response('LINE webhook OK', { status: 200 })
}
