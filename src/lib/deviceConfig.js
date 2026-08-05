const KEY = 'device_config'
const COOKIE_NAME = 'pos_device_cfg'
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365 * 5 // 5 years

function readCookie() {
  if (typeof document === 'undefined') return {}
  try {
    const c = document.cookie.split(';').find(s => s.trim().startsWith(COOKIE_NAME + '='))
    if (!c) return {}
    return JSON.parse(decodeURIComponent(c.trim().slice(COOKIE_NAME.length + 1))) || {}
  } catch { return {} }
}

function writeCookie(obj) {
  if (typeof document === 'undefined') return
  try {
    document.cookie = `${COOKIE_NAME}=${encodeURIComponent(JSON.stringify(obj))};path=/;max-age=${COOKIE_MAX_AGE};SameSite=Lax`
  } catch {}
}

export function getDeviceConfig() {
  if (typeof window === 'undefined') return {}
  try {
    const fromLS = JSON.parse(localStorage.getItem(KEY) || '{}')
    if (fromLS.terminal_id) return fromLS
    // localStorage empty (PWA context) → fall back to cookie
    return readCookie()
  } catch { return readCookie() }
}

export function setDeviceConfig(patch) {
  const cur = getDeviceConfig()
  const next = { ...cur, ...patch }
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch {}
  writeCookie(next)
}

export function getTerminalId()   { return getDeviceConfig().terminal_id   || '' }
export function getTerminalName() { return getDeviceConfig().terminal_name || '' }
