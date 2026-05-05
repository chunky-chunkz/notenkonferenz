import 'dotenv/config';

import { app } from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { prisma } from './config/database.js';

const PORT = env.PORT;

async function main() {
  // Verify DB connection
  await prisma.$connect();
  logger.info('✅ Database connected');

  app.listen(PORT, () => {
    logger.info(`🚀 API server running on http://localhost:${PORT}`);
    logger.info(`   Environment: ${env.NODE_ENV}`);
  });
}

main().catch((err) => {
  logger.error('❌ Failed to start server:', err);
  process.exit(1);
});
