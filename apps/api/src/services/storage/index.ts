/**
 * Storage service singleton.
 *
 * Selection logic:
 *   STORAGE_PROVIDER=s3 OR R2_BUCKET set  → S3StorageService (any S3-compatible backend)
 *   otherwise                              → LocalStorageService rooted at MEDIA_DIR
 *
 * Key conventions used across the codebase:
 *   portfolios/<kandidatId>.zip                   portfolio archives from PKOrg
 *   portfolios/<fachrichtung>/<kandidatId>.zip    portfolio archives scoped by fachrichtung
 *   uploads/pdf/<uniqueName>.pdf                  uploaded Anpassung PDFs
 *   media/<filename>                              static media (templates, etc.)
 */
import { env } from '../../config/env.js';
import { LocalStorageService } from './local.js';
import { S3StorageService } from './s3.js';
import type { StorageService } from './interface.js';

export type { StorageService };

function createStorage(): StorageService {
  if (env.STORAGE_PROVIDER === 's3' || env.R2_BUCKET) {
    const endpoint = env.S3_ENDPOINT
      ?? (env.R2_ACCOUNT_ID ? `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : '');
    return new S3StorageService({
      endpoint,
      region:          env.S3_REGION,
      accessKeyId:     env.S3_ACCESS_KEY_ID ?? env.R2_ACCESS_KEY_ID ?? '',
      secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? env.R2_SECRET_ACCESS_KEY ?? '',
      bucket:          env.S3_BUCKET ?? env.R2_BUCKET ?? '',
      forcePathStyle:  env.S3_FORCE_PATH_STYLE,
    });
  }

  return new LocalStorageService(env.MEDIA_DIR);
}

export const storage: StorageService = createStorage();
