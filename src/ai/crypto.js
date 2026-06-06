// crypto.js - Client-Side Zero-Knowledge Encryption utility for LUKAS
async function getKey(passphrase) {
  const enc = new TextEncoder();
  const keyMaterial = await window.crypto.subtle.importKey(
    "raw",
    enc.encode(passphrase),
    { name: "PBKDF2" },
    false,
    ["deriveBits", "deriveKey"]
  );
  return window.crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: enc.encode("LukasNexusSaltSecret"), // Static salt for key derivation
      iterations: 100000,
      hash: "SHA-256"
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptData(text, passphrase) {
  try {
    const key = await getKey(passphrase);
    const enc = new TextEncoder();
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await window.crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv },
      key,
      enc.encode(text)
    );
    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(encrypted), iv.length);
    // Return Base64
    return btoa(String.fromCharCode(...combined));
  } catch (e) {
    console.error('[Crypto] Encryption failed:', e);
    throw new Error('Encryption failed');
  }
}

async function decryptData(base64Text, passphrase) {
  try {
    const key = await getKey(passphrase);
    const dec = new TextDecoder();
    const combined = new Uint8Array(
      atob(base64Text).split("").map(c => c.charCodeAt(0))
    );
    const iv = combined.slice(0, 12);
    const data = combined.slice(12);
    const decrypted = await window.crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv },
      key,
      data
    );
    return dec.decode(decrypted);
  } catch (e) {
    console.error('[Crypto] Decryption failed:', e);
    throw new Error('Decryption failed. Ensure your passphrase is correct.');
  }
}

export { encryptData, decryptData };
