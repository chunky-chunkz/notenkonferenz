import { Request, Response, NextFunction } from 'express';
import { logger } from '../config/logger.js';

export function requestLogger(req: Request, _res: Response, next: NextFunction): void {
  logger.debug(`${req.method} ${req.path}`);
  next();
}
