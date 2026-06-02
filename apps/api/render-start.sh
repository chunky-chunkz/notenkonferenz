#!/bin/sh
set -e

echo "Running Prisma db push..."
npx prisma db push --schema=apps/api/prisma/schema.prisma

echo "Starting BullMQ worker..."
node apps/api/dist/worker.js &
WORKER_PID=$!

echo "Starting API..."
node apps/api/dist/index.js &
API_PID=$!

trap 'echo "Stopping API and worker..."; kill "$API_PID" "$WORKER_PID" 2>/dev/null || true; wait' TERM INT

# If either process exits, stop the other one and exit so Render restarts cleanly.
wait -n "$API_PID" "$WORKER_PID"
EXIT_CODE=$?
echo "One process exited with code $EXIT_CODE; stopping remaining process..."
kill "$API_PID" "$WORKER_PID" 2>/dev/null || true
wait 2>/dev/null || true
exit "$EXIT_CODE"
