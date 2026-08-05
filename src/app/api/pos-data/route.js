import { createClient } from '@supabase/supabase-js'
import { getCached, setCached, invalidateCache } from '@/lib/serverCache'

function invalidateAll() {
  invalidateCache('srv:products')
  invalidateCache('srv:categories')
  invalidateCache('srv:settings')
  invalidateCache('srv:employees')
}

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { db: { schema: 'pos' } }
)

const TTL_STATIC = 10 * 60 * 1000 // 10 นาที
const TTL_CFG    = 30 * 60 * 1000 // 30 นาที

async function getProducts() {
  const cached = getCached('srv:products')
  if (cached) return cached
  let all = [], page = 0
  while (true) {
    const { data } = await supabase.from('products').select('*, categories(name)').order('name').range(page * 1000, page * 1000 + 999)
    if (!data?.length) break
    all = all.concat(data)
    if (data.length < 1000) break
    page++
  }
  setCached('srv:products', all, TTL_STATIC)
  return all
}

async function getCategories() {
  const cached = getCached('srv:categories')
  if (cached) return cached
  const { data } = await supabase.from('categories').select('*').order('name')
  const result = data || []
  setCached('srv:categories', result, TTL_STATIC)
  return result
}

async function getSettings() {
  const cached = getCached('srv:settings')
  if (cached) return cached
  const { data } = await supabase.from('settings').select('key,value')
  const result = data ? Object.fromEntries(data.map(r => [r.key, r.value])) : {}
  setCached('srv:settings', result, TTL_CFG)
  return result
}

async function getEmployees() {
  const cached = getCached('srv:employees')
  if (cached) return cached
  const { data } = await supabase.from('employees').select('id,name,nickname').eq('active', true).order('name')
  const result = data || []
  setCached('srv:employees', result, TTL_STATIC)
  return result
}

export async function GET(req) {
  try {
    const force = new URL(req.url).searchParams.get('force') === '1'
    if (force) {
      invalidateAll()
    }
    const [products, categories, settings, employees] = await Promise.all([
      getProducts(),
      getCategories(),
      getSettings(),
      getEmployees(),
    ])
    return Response.json({ products, categories, settings, employees })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
