import { ValueTransformer } from 'typeorm';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

// AES-256-CBC column-level encryption transformer.
// Set DB_ENCRYPTION_KEY env var to a strong random secret (never use the default in prod).
// Existing plaintext rows are migrated automatically at startup by MigrationsService.
export class EncryptionTransformer implements ValueTransformer {
  // Encrypted values look like: <32 lowercase hex chars>:<hex chars>
  // Using a strict pattern prevents emails like user:name@example.com from being
  // misidentified as encrypted and causing a decryption error.
  static readonly ENCRYPTED_PATTERN = /^[0-9a-f]{32}:[0-9a-f]+$/;

  static isEncrypted(value: string): boolean {
    return EncryptionTransformer.ENCRYPTED_PATTERN.test(value);
  }

  private static getKey(): Buffer {
    const secret = process.env.DB_ENCRYPTION_KEY || 'dev-only-key-change-in-prod';
    return scryptSync(secret, 'cdms-salt', 32);
  }

  to(value: string): string {
    if (!value) return value;
    const iv = randomBytes(16);
    const key = EncryptionTransformer.getKey();
    const cipher = createCipheriv('aes-256-cbc', key, iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
  }

  from(value: string): string {
    if (!value || !EncryptionTransformer.ENCRYPTED_PATTERN.test(value)) return value;
    const [ivHex, encHex] = value.split(':');
    const key = EncryptionTransformer.getKey();
    const decipher = createDecipheriv('aes-256-cbc', key, Buffer.from(ivHex, 'hex'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encHex, 'hex')),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  }
}
