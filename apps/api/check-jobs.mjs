import 'dotenv/config';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

const redis = new IORedis({ host: 'localhost', port: 6379, maxRetriesPerRequest: null });
const queue = new Queue('imports', { connection: redis });

const jobs = await queue.getJobs(['completed', 'failed', 'waiting', 'active', 'delayed'], 0, 50);
console.log(`Total jobs: ${jobs.length}`);
for (const job of jobs.sort((a,b) => Number(a.id) - Number(b.id))) {
  const state = await job.getState();
  console.log(`\nJob ${job.id} [${job.name}] state=${state} progress=${job.progress}`);
  if (job.data?.logs?.length) {
    job.data.logs.forEach(l => console.log('  ', l));
  }
  if (job.failedReason) console.log('  FAILED:', job.failedReason);
}
await redis.quit();
