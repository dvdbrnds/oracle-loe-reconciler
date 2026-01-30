#!/bin/sh
set -e

# Use absolute path so database is in the persisted volume
export DATABASE_PATH="${DATABASE_PATH:-/app/data/vendor-tracker.db}"

# Ensure data directory exists
mkdir -p /app/data

# Create or update admin user (idempotent)
echo "Creating admin user..."
node server/dist/db/create-admin.js || true

# Start the application
exec pm2-runtime ecosystem.config.cjs --env production
