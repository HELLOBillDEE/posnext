const STORE_KEY = 'device_login_pin'

// FNV-1a 32-bit hash — works on HTTP, no crypto.subtle needed
function fnv1a(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h
}

// Derive N key bytes from PIN + salt using iterated hashing (key stretching)
function deriveKeyBytes(pin, salt, n) {
  const base = pin + ':' + salt.join(',')
  let state = base
  for (let i = 0; i < 5000; i++) {
    state = fnv1a(state + i).toString(16) + state.slice(0, 24)
  }
  const bytes = []
  let counter = 0
  while (bytes.length < n) {
    const h = fnv1a(state + ':' + counter++)
    bytes.push(h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff, (h >> 24) & 0xff)
    state = h.toString(16) + state.slice(0, 16)
  }
  return bytes.slice(0, n)
}

const MAGIC = 'PIN:'

export async function savePinCredentials(pin, email, password) {
  const salt = Array.from(crypto.getRandomValues(new Uint8Array(16)))
  const json = MAGIC + JSON.stringify({ email, password })
  const plain = Array.from(new TextEncoder().encode(json))
  const key = deriveKeyBytes(pin, salt, plain.length)
  const encrypted = plain.map((b, i) => b ^ key[i])
  const result = { v: 2, salt, data: encrypted }
  localStorage.setItem(STORE_KEY, JSON.stringify(result))
  return result
}

export function importPinCredentials(encrypted) {
  localStorage.setItem(STORE_KEY, JSON.stringify(encrypted))
}

export function hasPinCredentials() {
  try { return !!localStorage.getItem(STORE_KEY) } catch { return false }
}

export async function decryptPinCredentials(pin) {
  try {
    const stored = JSON.parse(localStorage.getItem(STORE_KEY))
    // v2: pure-JS XOR cipher
    if (stored.v === 2) {
      const { salt, data } = stored
      const key = deriveKeyBytes(pin, salt, data.length)
      const plain = new Uint8Array(data.map((b, i) => b ^ key[i]))
      const str = new TextDecoder().decode(plain)
      if (!str.startsWith(MAGIC)) return null
      return JSON.parse(str.slice(MAGIC.length))
    }
    // v1: old AES-GCM format — requires crypto.subtle (HTTPS only)
    if (stored.salt && stored.iv && stored.data && !stored.v) {
      if (!crypto.subtle) return null
      const mat = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveKey'])
      const key = await crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: new Uint8Array(stored.salt), iterations: 100000, hash: 'SHA-256' },
        mat, { name: 'AES-GCM', length: 256 }, false, ['decrypt']
      )
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(stored.iv) }, key, new Uint8Array(stored.data))
      return JSON.parse(new TextDecoder().decode(plain))
    }
    return null
  } catch { return null }
}

export function clearPinCredentials() {
  try { localStorage.removeItem(STORE_KEY) } catch {}
}
