import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''

// Public schema — สำหรับตาราง family_* เท่านั้น
export const supabaseFamily = createClient(url, key)
