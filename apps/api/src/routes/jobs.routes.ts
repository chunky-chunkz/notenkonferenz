import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { importQueue } from '../services/queue.js';
import { AppError } from '../middleware/errorHandler.js';

export const jobsRouter = Router();
jobsRouter.use(requireAuth);

function requireQueue(res: Response): boolean {
  if (!importQueue) {
    res.status(503).json({ error: 'queue_unavailable', message: 'Job queue unavailable: REDIS_URL is not configured.' });
    return false;
  }
  return true;
}

// ─── GET /api/jobs ────────────────────────────────────────────────────────────
jobsRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!requireQueue(res)) return;
    const userId = req.session.userId;
    const jobs = await importQueue!.getJobs(['active', 'waiting', 'delayed', 'failed', 'completed'], 0, 100);
    const result = await Promise.all(
      jobs
        .filter((job) => (job.data as any).userId === userId)
        .map(async (job) => {
          const state = await job.getState();
          return {
            jobId: job.id,
            type: job.name,
            status: state,
            progress: typeof job.progress === 'number' ? job.progress : 0,
            createdAt: job.timestamp,
            error: job.failedReason ?? undefined,
          };
        }),
    );
    // Sort newest first
    result.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
    res.json({ jobs: result });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/jobs/:jobId ─────────────────────────────────────────────────────
jobsRouter.get('/:jobId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!requireQueue(res)) return;
    const job = await importQueue!.getJob(req.params.jobId);
    if (!job || (job.data as any).userId !== req.session.userId) {
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
      createdAt: job.timestamp,
      error: job.failedReason ?? undefined,
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/jobs/:jobId/cancel ─────────────────────────────────────────────
jobsRouter.post('/:jobId/cancel', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!requireQueue(res)) return;
    const job = await importQueue!.getJob(req.params.jobId);
    if (!job || (job.data as any).userId !== req.session.userId) {
      throw new AppError(404, 'not_found', 'Job not found');
    }

    const state = await job.getState();

    if (state === 'active') {
      await job.moveToFailed(new Error('Abgebrochen durch Admin'), job.token ?? '0', true);
    } else {
      await job.remove();
    }

    res.json({ status: 'cancelled', previousState: state });
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /api/jobs/:jobId ──────────────────────────────────────────────────
jobsRouter.delete('/:jobId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!requireQueue(res)) return;
    const job = await importQueue!.getJob(req.params.jobId);
    if (!job || (job.data as any).userId !== req.session.userId) {
      throw new AppError(404, 'not_found', 'Job not found');
    }

    const state = await job.getState();
    if (state === 'active') {
      // Active jobs are locked by the worker — move to failed first so the
      // lock is released, then the remove below cleans it from history.
      try {
        await job.moveToFailed(new Error('Gelöscht durch Admin'), job.token ?? '0', true);
      } catch {
        // If moveToFailed fails (e.g. lock mismatch), force-remove via queue
        await importQueue!.remove(job.id!);
        res.json({ status: 'removed' });
        return;
      }
    }
    await job.remove();
    res.json({ status: 'removed' });
  } catch (err) {
    next(err);
  }
});
