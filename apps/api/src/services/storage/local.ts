/**
 * Local filesystem implementation of StorageService.
 *
 * All keys are resolved relative to `baseDir`. Parent directories are created
 * automatically on `put`.
 *
 * ⚠️  Render Free tier: the local disk at /app is ephemeral — every deploy or
 *     restart wipes it. Use this implementation for development only, or when
 *     running on infrastructure with a persistent volume. For production on
 *     Render Free, configure R2_BUCKET and use the S3 implementation instead.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { StorageService } from './interface.js';

export class LocalStorageService implements StorageService {
  constructor(private readonly baseDir: string) {
    fs.mkdirSync(baseDir, { recursive: true });
  }

  private resolve(key: string): string {
    // Prevent path traversal
    const resolved = path.resolve(this.baseDir, key);
    if (!resolved.startsWith(path.resolve(this.baseDir))) {
      throw new Error(`Storage key escapes base directory: ${key}`);
    }
    return resolved;
  }

  async put(key: string, data: Buffer, _contentType?: string): Promise<void> {
    const dest = this.resolve(key);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, data);
  }

  async get(key: string): Promise<Buffer> {
    const src = this.resolve(key);
    if (!fs.existsSync(src)) {
      throw new Error(`Storage key not found: ${key}`);
    }
    return fs.readFileSync(src);
  }

  async exists(key: string): Promise<boolean> {
    try {
      return fs.existsSync(this.resolve(key));
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      fs.unlinkSync(this.resolve(key));
    } catch (err: any) {
      if (err?.code !== 'ENOENT') throw err;
    }
  }

  async list(prefix: string): Promise<string[]> {
    const dir = this.resolve(prefix);
    if (!fs.existsSync(dir)) return [];

    const keys: string[] = [];
    const scan = (current: string, rel: string) => {
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const entryRel = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          scan(path.join(current, entry.name), entryRel);
        } else {
          keys.push(`${prefix}/${entryRel}`);
        }
      }
    };

    if (fs.statSync(dir).isDirectory()) {
      scan(dir, '');
    } else {
      // prefix points to a file, not a directory
      keys.push(prefix);
    }

    return keys;
  }
}
