/**
 * Storage service singleton.
 *
 * Selection logic:
 *   R2_BUCKET set  → S3StorageService pointed at Cloudflare R2
 *   otherwise      → LocalStorageService rooted at MEDIA_DIR
 *
 * Key conventions used across the codebase:
 *   portfolios/<kandidatId>.zip          portfolio archives from PKOrg
 *   uploads/pdf/<uniqueName>.pdf         uploaded Anpassung PDFs
 *   media/<filename>                     static media (templates, etc.)
 */
import { env } from '../../config/env.js';
import { LocalStorageService } from './local.js';
import { S3StorageService } from './s3.js';
import type { StorageService } from './interface.js';

export type { StorageService };

function createStorage(): StorageService {
  if (env.R2_BUCKET) {
    // All R2_* vars are guaranteed present by env.ts superRefine when R2_BUCKET is set.
    return new S3StorageService({
      bucket:          env.R2_BUCKET,
      accountId:       env.R2_ACCOUNT_ID!,
      accessKeyId:     env.R2_ACCESS_KEY_ID!,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
    });
  }

  return new LocalStorageService(env.MEDIA_DIR);
}

export const storage: StorageService = createStorage();
