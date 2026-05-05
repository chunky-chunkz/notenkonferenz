import { prisma } from '../config/database.js';

/**
 * Create an audit log entry.
 */
export async function logAction(
  userId: number | null | undefined,
  action: string,
  before?: string | null,
  after?: string | null,
): Promise<void> {
  await prisma.log.create({
    data: {
      userId: userId ?? null,
      action,
      before: before ?? null,
      after: after ?? null,
    },
  });
}
