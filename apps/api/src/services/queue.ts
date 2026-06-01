import { Queue } from 'bullmq';
import { redis } from '../config/redis.js';

export const importQueue: Queue | null = redis
  ? new Queue('imports', {
      connection: redis,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 50 },
      },
    })
  : null;
