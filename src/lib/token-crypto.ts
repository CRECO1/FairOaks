import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';

function getKey(): Buffer {
  const KEY_ENV = process.env.TOKEN_ENCRYPTION_KEY ?? '';

  if (!KEY_ENV || KEY_ENV.length < 32) {
    if (process.env.NODE_ENV === 'production') {
      // Hard fail in production — never silently use a weak key
      throw new Error(
        '[token-crypto] TOKEN_ENCRYPTION_KEY is missing or under 32 characters. ' +
        'Set a strong 32+ character key in your environment variables.'
      );
    }
    // Dev fallback only — warns loudly
    console.warn(
      '[token-crypto] WARNING: Using dev fallback key. Set TOKEN_ENCRYPTION_KEY (32+ chars) before deploying.'
    );
    return crypto.scryptSync('dev-fallback-key', 'dev-salt-2024', 32);
  }

  // Use first 32 bytes of the key (UTF-8)
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
