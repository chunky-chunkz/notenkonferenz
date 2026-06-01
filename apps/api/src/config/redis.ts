import Redis from 'ioredis';
import { env } from './env.js';

function makeRedis(options: ConstructorParameters<typeof Redis>[1] = {}): Redis {
  const client = new Redis(env.REDIS_URL, {
    enableOfflineQueue: false,
    ...options,
  });
  client.on('error', (err: Error) => {
    console.warn('[Redis] connection error (non-fatal):', err.message);
  });
  return client;
}

// BullMQ requires maxRetriesPerRequest: null
export const redis = makeRedis({ maxRetriesPerRequest: null });
export const sessionRedis = makeRedis();
