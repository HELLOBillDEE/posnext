import { createClient } from '@supabase/supabase-js'

export async function requireAuth(request) {
  // Read token from cookie (set by AuthProvider on login)
  const token = request.cookies.get('pos_token')?.value
    || request.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) return null

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { db: { schema: 'pos' } }
  )
  const { data: { user }, error } = await supabase.auth.getUser(token)
  return error ? null : user
}

export function unauthorizedResponse() {
  return Response.json({ error: 'Unauthorized' }, { status: 401 })
}
