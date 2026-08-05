// In-memory server cache — ทำงานเฉพาะบน PM2 (long-lived process)
// บน Vercel (serverless) cache หมดทุก request — ไม่มีผลเสีย แค่ไม่ได้ประโยชน์

const cache = new Map()

export function getCached(key) {
  const entry = cache.get(key)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) { cache.delete(key); return null }
  return entry.data
}

export function setCached(key, data, ttlMs) {
  cache.set(key, { data, expiresAt: Date.now() + ttlMs })
}

export function invalidateCache(key) {
  if (key) cache.delete(key)
  else cache.clear()
}
