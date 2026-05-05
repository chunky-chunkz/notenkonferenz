import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { importQueue } from '../services/queue.js';
import { AppError } from '../middleware/errorHandler.js';

export const jobsRouter = Router();
jobsRouter.use(requireAuth);

// ─── GET /api/jobs/:jobId ────────────────────────────────────────────────────
jobsRouter.get('/:jobId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const job = await importQueue.getJob(req.params.jobId);
    if (!job) {
      throw new AppError(404, 'not_found', 'Job not found');
    }

    const state = await job.getState();
    const progress = typeof job.progress === 'number' ? job.progress : 0;
    const logs = (job.data as any).logs ?? [];

    res.json({
      jobId: job.id,
      type: job.name,
      status: state,
      progress,
      logs,
      error: job.failedReason ?? undefined,
    });
  } catch (err) {
    next(err);
  }
});
