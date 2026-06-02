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

# On TERM or INT, kill both processes cleanly
_term() {
  echo "Caught signal — stopping worker (pid $WORKER_PID) and API (pid $API_PID)..."
  kill "$WORKER_PID" "$API_PID" 2>/dev/null || true
}
trap _term TERM INT

# Wait for whichever process exits first
wait -n "$WORKER_PID" "$API_PID"
EXIT_CODE=$?

# Kill the survivor and exit with the first process's exit code
kill "$WORKER_PID" "$API_PID" 2>/dev/null || true
exit $EXIT_CODE
