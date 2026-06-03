/**
 * Minimal storage abstraction used throughout the API.
 *
 * Keys are forward-slash-separated paths (no leading slash), e.g.:
 *   "portfolios/12345.zip"
 *   "uploads/pdf/1718000000000-123456789.pdf"
 *   "media/vorlage_notenkonferenz_API.docx"
 *
 * Implementations must be safe to call concurrently.
 */
export interface StorageService {
  /** Write data to the given key, replacing any existing content. */
  put(key: string, data: Buffer, contentType?: string): Promise<void>;

  /** Read the full content of a key into a Buffer. Throws if the key does not exist. */
  get(key: string): Promise<Buffer>;

  /** Return true if the key exists, false otherwise. */
  exists(key: string): Promise<boolean>;

  /**
   * Delete a key. Resolves without error if the key does not exist
   * (idempotent delete semantics, matching S3 behaviour).
   */
  delete(key: string): Promise<void>;

  /**
   * List all keys that start with the given prefix.
   * Returns bare keys (not full URLs), e.g. ["portfolios/1.zip", "portfolios/2.zip"].
   * Returns an empty array when no keys match.
   */
  list(prefix: string): Promise<string[]>;
}
