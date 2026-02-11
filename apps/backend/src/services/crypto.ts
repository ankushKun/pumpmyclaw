/**
 * AES-256-GCM encryption for secrets at rest.
 *
 * Format: base64(iv || ciphertext || authTag)
 * - IV: 12 bytes (96 bits, recommended for GCM)
 * - Auth Tag: 16 bytes (128 bits)
 */

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96 bits recommended for GCM
const AUTH_TAG_LENGTH = 16; // 128 bits

// Derive a 32-byte key from the environment variable
function getKey(): Buffer {
  if (!ENCRYPTION_KEY) {
    // In development without a key, return a deterministic dev key
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        "[crypto] WARNING: No ENCRYPTION_KEY set, using insecure dev key"
      );
      return Buffer.alloc(32, "dev-key-not-secure");
    }
    throw new Error("ENCRYPTION_KEY environment variable is required");
  }

  // If key is hex-encoded (64 chars = 32 bytes), decode it
  if (/^[0-9a-fA-F]{64}$/.test(ENCRYPTION_KEY)) {
    return Buffer.from(ENCRYPTION_KEY, "hex");
  }

  // Otherwise, derive a key using SHA-256
  const crypto = require("crypto");
  return crypto.createHash("sha256").update(ENCRYPTION_KEY).digest();
}

/**
 * Encrypt a plaintext string using AES-256-GCM.
 * Returns a base64-encoded string containing IV + ciphertext + authTag.
 */
export function encrypt(plaintext: string): string {
  const crypto = require("crypto");
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  // Combine: IV + ciphertext + authTag
  const combined = Buffer.concat([iv, ciphertext, authTag]);
  return combined.toString("base64");
}

/**
 * Decrypt a base64-encoded encrypted string.
 * Returns the original plaintext.
 */
export function decrypt(encrypted: string): string {
  const crypto = require("crypto");
  const key = getKey();
  const combined = Buffer.from(encrypted, "base64");

  // Extract components
  const iv = combined.subarray(0, IV_LENGTH);
  const authTag = combined.subarray(combined.length - AUTH_TAG_LENGTH);
  const ciphertext = combined.subarray(
    IV_LENGTH,
    combined.length - AUTH_TAG_LENGTH
  );

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(authTag);

  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return plaintext.toString("utf8");
}

/**
 * Check if a string appears to be encrypted (base64 with valid structure).
 */
export function isEncrypted(value: string): boolean {
  try {
    const decoded = Buffer.from(value, "base64");
    // Minimum size: IV (12) + authTag (16) + at least 1 byte ciphertext
    return decoded.length >= IV_LENGTH + AUTH_TAG_LENGTH + 1;
  } catch {
    return false;
  }
}
