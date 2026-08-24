/**
 * Client-Side Encrypted Vault menggunakan Web Crypto API.
 * 
 * Arsitektur Zero-Knowledge:
 * 1. Master password di-hash menggunakan PBKDF2 untuk menghasilkan CryptoKey.
 * 2. API key dienkripsi dengan AES-256-GCM sebelum masuk ke localStorage.
 * 3. Key asli hanya ada di memori saat aplikasi berjalan, tidak pernah tersimpan plain text.
 */

const SALT = new TextEncoder().encode('otomation-setting-static-salt-v1');
const ALGO = 'AES-GCM';

/**
 * Menurunkan CryptoKey dari password master menggunakan PBKDF2.
 * Iterasi tinggi (100k) untuk mencegah brute-force.
 */
export async function deriveMasterKey(password: string): Promise<CryptoKey> {
  const keyMaterial = await window.crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );

  return window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: SALT,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: ALGO, length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Mengenkripsi teks biasa menjadi ciphertext (base64) + IV.
 */
export async function encryptData(
  plainText: string,
  key: CryptoKey,
): Promise<{ ciphertext: string; iv: string }> {
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plainText);

  const encrypted = await window.crypto.subtle.encrypt(
    { name: ALGO, iv },
    key,
    encoded,
  );

  return {
    ciphertext: btoa(String.fromCharCode(...new Uint8Array(encrypted))),
    iv: btoa(String.fromCharCode(...iv)),
  };
}

/**
 * Mendekripsi ciphertext (base64) kembali ke teks biasa.
 */
export async function decryptData(
  ciphertext: string,
  ivBase64: string,
  key: CryptoKey,
): Promise<string> {
  const iv = new Uint8Array(atob(ivBase64).split('').map((c) => c.charCodeAt(0)));
  const encryptedBytes = new Uint8Array(atob(ciphertext).split('').map((c) => c.charCodeAt(0)));

  const decrypted = await window.crypto.subtle.decrypt(
    { name: ALGO, iv },
    key,
    encryptedBytes,
  );

  return new TextDecoder().decode(decrypted);
}