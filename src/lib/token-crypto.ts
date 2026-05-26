import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_ENV = process.env.TOKEN_ENCRYPTION_KEY ?? '';

function getKey(): Buffer {
  if (!KEY_ENV || KEY_ENV.length < 32) {
    // Fallback: derive a key from a simpler secret (dev only)
    return crypto.scryptSync(KEY_ENV || 'dev-fallback-key', 'salt', 32);
  }
  return Buffer.from(KEY_ENV.slice(0, 32), 'utf8');
}

export function encryptToken(plaintext: string): string {
  if (!plaintext) return plaintext;
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Format: iv(32hex):authTag(32hex):encrypted(hex)
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptToken(ciphertext: string): string {
  if (!ciphertext || !ciphertext.includes(':')) return ciphertext;
  try {
    const [ivHex, authTagHex, encryptedHex] = ciphertext.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const encrypted = Buffer.from(encryptedHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
    decipher.setAuthTag(authTag);
    return decipher.update(encrypted).toString('utf8') + decipher.final('utf8');
  } catch {
    // Return as-is if decryption fails (handles already-plaintext tokens during migration)
    return ciphertext;
  }
}
