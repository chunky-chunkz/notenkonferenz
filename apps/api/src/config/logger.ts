import winston from 'winston';
import { env } from './env.js';

export const logger = winston.createLogger({
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    env.NODE_ENV === 'production'
      ? winston.format.json()
      : winston.format.combine(
          winston.format.colorize(),
          winston.format.printf(({ timestamp, level, message, ...rest }) => {
            const extra = Object.keys(rest).length ? ` ${JSON.stringify(rest)}` : '';
            return `${timestamp} ${level}: ${message}${extra}`;
          }),
        ),
  ),
  transports: [new winston.transports.Console()],
});
