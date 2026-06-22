import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''

// iOS Safari WebKit fix: Headers.set() and fetch({ headers: plainObj }) both reject
// non-ISO-8859-1 characters (> U+00FF). Patch Headers prototype and wrap fetch
// to strip any such chars before they reach the native browser API.
if (typeof window !== 'undefined' && typeof Headers !== 'undefined') {
  const _set = Headers.prototype.set
  const _append = Headers.prototype.append
  const strip = (v) => String(v).replace(/[^\x00-\xFF]/g, '')
  Headers.prototype.set = function(n, v) { return _set.call(this, n, strip(v)) }
  Headers.prototype.append = function(n, v) { return _append.call(this, n, strip(v)) }
}

async function safeFetch(input, init) {
  if (!init?.headers) return fetch(input, init)
  const h = {}
  const strip = (v) => String(v).replace(/[^\x00-\xFF]/g, '')
  if (init.headers instanceof Headers) {
    init.headers.forEach((v, k) => { h[k] = strip(v) })
  } else {
    for (const [k, v] of Object.entries(init.headers)) h[k] = strip(v)
  }
  return fetch(input, { ...init, headers: h })
}

export const supabase = createClient(url, key, {
  db: { schema: 'pos' },
  global: { fetch: safeFetch },
})
