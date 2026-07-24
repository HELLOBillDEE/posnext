const CRED_KEY = 'face_cred_id'
const PIN_KEY  = 'face_pin_store'

export function hasFaceId() {
  try { return !!localStorage.getItem(CRED_KEY) && !!localStorage.getItem(PIN_KEY) } catch { return false }
}

export async function isFaceIdAvailable() {
  try {
    return typeof window !== 'undefined' &&
      !!window.PublicKeyCredential &&
      await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
  } catch { return false }
}

export async function registerFaceId(pin) {
  const challenge = crypto.getRandomValues(new Uint8Array(32))
  const userId    = crypto.getRandomValues(new Uint8Array(16))
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: { name: 'CHERD POS', id: window.location.hostname },
      user: { id: userId, name: 'pos-user', displayName: 'POS User' },
      pubKeyCredParams: [{ alg: -7, type: 'public-key' }, { alg: -257, type: 'public-key' }],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'preferred',
      },
      timeout: 60000,
    },
  })
  localStorage.setItem(CRED_KEY, btoa(String.fromCharCode(...new Uint8Array(cred.rawId))))
  localStorage.setItem(PIN_KEY, pin)
  return true
}

export async function authenticateWithFaceId() {
  const credIdStr = localStorage.getItem(CRED_KEY)
  if (!credIdStr) return null
  const credId  = Uint8Array.from(atob(credIdStr), c => c.charCodeAt(0))
  const challenge = crypto.getRandomValues(new Uint8Array(32))
  await navigator.credentials.get({
    publicKey: {
      challenge,
      allowCredentials: [{ id: credId, type: 'public-key' }],
      userVerification: 'required',
      rpId: window.location.hostname,
      timeout: 60000,
    },
  })
  return localStorage.getItem(PIN_KEY)
}

export function getFaceIdData() {
  try {
    const credId = localStorage.getItem(CRED_KEY)
    const pin    = localStorage.getItem(PIN_KEY)
    if (!credId || !pin) return null
    return { credId, pin }
  } catch { return null }
}

export function importFaceIdData({ credId, pin }) {
  try {
    localStorage.setItem(CRED_KEY, credId)
    localStorage.setItem(PIN_KEY, pin)
  } catch {}
}

export function clearFaceId() {
  try { localStorage.removeItem(CRED_KEY); localStorage.removeItem(PIN_KEY) } catch {}
}
