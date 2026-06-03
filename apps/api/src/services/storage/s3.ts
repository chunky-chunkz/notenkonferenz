/**
 * S3-compatible storage implementation targeting Cloudflare R2.
 *
 * R2 endpoint format: https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com
 *
 * Required env vars (validated at startup in env.ts when R2_BUCKET is set):
 *   R2_BUCKET            – bucket name
 *   R2_ACCOUNT_ID        – Cloudflare account ID (used to build the endpoint)
 *   R2_ACCESS_KEY_ID     – R2 API token access key
 *   R2_SECRET_ACCESS_KEY – R2 API token secret key
 *
 * Optional:
 *   R2_PUBLIC_URL        – base URL of a public bucket / custom domain.
 *                          Not used by this service directly, but exported so
 *                          routes can build direct download URLs when needed.
 */
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import type { StorageService } from './interface.js';

function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

export class S3StorageService implements StorageService {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(opts: {
    accountId: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucket: string;
  }) {
    this.bucket = opts.bucket;
    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${opts.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: opts.accessKeyId,
        secretAccessKey: opts.secretAccessKey,
      },
    });
  }

  async put(key: string, data: Buffer, contentType = 'application/octet-stream'): Promise<void> {
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: data,
      ContentType: contentType,
    }));
  }

  async get(key: string): Promise<Buffer> {
    const res = await this.client.send(new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    }));
    if (!res.Body) throw new Error(`Storage key not found: ${key}`);
    return streamToBuffer(res.Body as NodeJS.ReadableStream);
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch (err: any) {
      if (err?.name === 'NotFound' || err?.$metadata?.httpStatusCode === 404) return false;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    // S3 DeleteObject is idempotent — no error on missing key.
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async list(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let continuationToken: string | undefined;

    do {
      const res = await this.client.send(new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }));
      for (const obj of res.Contents ?? []) {
        if (obj.Key) keys.push(obj.Key);
      }
      continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (continuationToken);

    return keys;
  }
}
