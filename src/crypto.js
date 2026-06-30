const encoder = new TextEncoder()
const decoder = new TextDecoder()

const PBKDF2_ITERATIONS = 600000

function toBase64(bytes) {
  return btoa(String.fromCharCode(...bytes))
}

function fromBase64(value) {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

export function generateSalt() {
  return toBase64(crypto.getRandomValues(new Uint8Array(16)))
}

export async function sha256Hex(value) {
  const encoded = encoder.encode(String(value || ''))
  const digest = await crypto.subtle.digest('SHA-256', encoded)
  const bytes = new Uint8Array(digest)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export async function deriveVaultKey(pin, saltBase64) {
  const cleanPin = String(pin || '').trim()
  if (!/^\d{10}$/.test(cleanPin)) {
    throw new Error('Invalid PIN format')
  }

  const pinMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(cleanPin),
    { name: 'PBKDF2' },
    false,
    ['deriveKey'],
  )

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: fromBase64(saltBase64),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    pinMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function encryptJson(payload, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encoded = encoder.encode(JSON.stringify(payload))
  const encryptedBuffer = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded)

  return {
    version: 1,
    iv: toBase64(iv),
    data: toBase64(new Uint8Array(encryptedBuffer)),
    createdAt: new Date().toISOString(),
  }
}

export async function decryptJson(encryptedPayload, key) {
  if (!encryptedPayload || encryptedPayload.version !== 1) {
    throw new Error('Unsupported encrypted payload')
  }

  const iv = fromBase64(encryptedPayload.iv)
  const data = fromBase64(encryptedPayload.data)
  const decryptedBuffer = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data)

  return JSON.parse(decoder.decode(new Uint8Array(decryptedBuffer)))
}
