import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { readFile, mkdir, writeFile, chmod } from 'node:fs/promises';
import { resolve } from 'node:path';
export type Sealed = { iv: string; tag: string; data: string };
export class SecretVault {
  constructor(private key: Buffer) {
    if (key.length !== 32) throw new Error('Credential encryption requires a 32-byte key.');
  }
  /** Opaque, domain-separated lookup IDs for private graph terms; never exposes the vault key. */
  fingerprint(value: string, scope: string): string {
    return createHmac('sha256', this.key)
      .update(JSON.stringify([scope, value]))
      .digest('hex');
  }
  seal(value: string, scope: string): Sealed {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(scope));
    const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
  }
  open(value: Sealed, scope: string): string {
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(value.iv, 'base64'));
    decipher.setAAD(Buffer.from(scope));
    decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(value.data, 'base64')), decipher.final()]).toString('utf8');
  }
  static async load(development: boolean) {
    if (process.env.STUDIO_CREDENTIAL_KEY)
      return new SecretVault(Buffer.from(process.env.STUDIO_CREDENTIAL_KEY, 'base64'));
    if (!development) throw new Error('STUDIO_CREDENTIAL_KEY is required outside development identity mode.');
    const dir = resolve('.studio');
    const path = resolve(dir, 'credential-key');
    await mkdir(dir, { recursive: true, mode: 0o700 });
    try {
      await writeFile(path, randomBytes(32), { flag: 'wx', mode: 0o600 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    await chmod(path, 0o600);
    return new SecretVault(await readFile(path));
  }
}
