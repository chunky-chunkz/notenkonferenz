import Redis from 'ioredis';
import { env } from './env.js';

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null, // required for BullMQ
});

export const sessionRedis = new Redis(env.REDIS_URL);
