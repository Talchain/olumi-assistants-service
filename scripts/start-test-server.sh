#!/usr/bin/env bash
#
# Start test server for E2E tests
# This script starts the server with test configuration

set -e

# Export test environment variables
export NODE_ENV=test
export LLM_PROVIDER=fixtures
export ASSIST_API_KEYS=e2e-test-key
export CEE_DIAGNOSTICS_KEY_IDS=e2e-test-key
export GROUNDING_ENABLED=false
export CRITIQUE_ENABLED=false
export CLARIFIER_ENABLED=false
export PORT=3000

# Start the server
if [ -f "dist/src/server.js" ]; then
  # Use built version if available
  node dist/src/server.js
else
  # Fall back to dev server
  pnpm dev
fi
