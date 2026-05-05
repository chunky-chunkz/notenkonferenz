import { Queue } from 'bullmq';
import { redis } from '../config/redis.js';

/**
 * BullMQ queue for import/download jobs.
 * Job names: 'import_notenuebersicht', 'import_durchfuehrung', 'download_portfolios'
 */
export const importQueue = new Queue('imports', {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 50 },
  },
});
