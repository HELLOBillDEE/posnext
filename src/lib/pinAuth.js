const STORE_KEY = 'device_login_pin'

async function deriveKey(pin, salt) {
  const mat = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveKey']
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: new Uint8Array(salt), iterations: 100000, hash: 'SHA-256' },
    mat,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

export async function savePinCredentials(pin, email, password) {
  const salt = Array.from(crypto.getRandomValues(new Uint8Array(16)))
  const iv   = Array.from(crypto.getRandomValues(new Uint8Array(12)))
  const key  = await deriveKey(pin, salt)
  const data = new TextEncoder().encode(JSON.stringify({ email, password }))
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: new Uint8Array(iv) }, key, data)
  localStorage.setItem(STORE_KEY, JSON.stringify({ salt, iv, data: Array.from(new Uint8Array(cipher)) }))
}

export function hasPinCredentials() {
  try { return !!localStorage.getItem(STORE_KEY) } catch { return false }
}

export async function decryptPinCredentials(pin) {
  try {
    const { salt, iv, data } = JSON.parse(localStorage.getItem(STORE_KEY))
    const key   = await deriveKey(pin, salt)
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(iv) }, key, new Uint8Array(data))
    return JSON.parse(new TextDecoder().decode(plain))
  } catch { return null }
}

export function clearPinCredentials() {
  try { localStorage.removeItem(STORE_KEY) } catch {}
}
