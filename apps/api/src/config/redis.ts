import Redis from 'ioredis';
import { env } from './env.js';

function makeRedis(options: ConstructorParameters<typeof Redis>[1] = {}): Redis | null {
  if (!env.REDIS_URL) return null;
  const client = new Redis(env.REDIS_URL, {
    enableOfflineQueue: false,
    ...options,
  });
  client.on('error', (err: Error) => {
    console.error('[Redis] connection error:', err.message);
  });
  return client;
}

// BullMQ requires maxRetriesPerRequest: null
export const redis = makeRedis({ maxRetriesPerRequest: null });
export const sessionRedis = makeRedis();
