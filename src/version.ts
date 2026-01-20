import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * Service version (single source of truth)
 *
 * Reads from package.json by default, with optional env override.
 * This constant is used by /healthz and all telemetry events.
 *
 * Uses import.meta.url for path resolution to work correctly in both:
 * - Dev mode: tsx src/server.ts (executes .ts from src/)
 * - Prod mode: node dist/src/server.js (executes .js from dist/src/)
 */
export const SERVICE_VERSION =
  process.env.SERVICE_VERSION ??
  ((): string => {
    try {
      // Resolve package.json relative to THIS FILE
      // From src/version.ts: ../ goes to root (where package.json lives)
      const pkgPath = new URL('../package.json', import.meta.url);
      const pkg = JSON.parse(readFileSync(fileURLToPath(pkgPath), 'utf-8'));
      return pkg.version ?? '0.0.0';
    } catch {
      // Fallback: try one more level up (for dist/src/version.js case)
      try {
        const pkgPath = new URL('../../package.json', import.meta.url);
        const pkg = JSON.parse(readFileSync(fileURLToPath(pkgPath), 'utf-8'));
        return pkg.version ?? '0.0.0';
      } catch {
        return '0.0.0';
      }
    }
  })();

/**
 * Git commit SHA (for deployment tracking)
 *
 * Sources (in order of precedence):
 * 1. GIT_COMMIT_SHA env var (explicit override)
 * 2. RENDER_GIT_COMMIT env var (auto-set by Render)
 * 3. Git rev-parse HEAD (for local development)
 * 4. "unknown" fallback
 */
export const GIT_COMMIT_SHA =
  process.env.GIT_COMMIT_SHA ??
  process.env.RENDER_GIT_COMMIT ??
  ((): string => {
    try {
      return execSync('git rev-parse HEAD', { encoding: 'utf-8', timeout: 1000 }).trim();
    } catch {
      return 'unknown';
    }
  })();

/**
 * Short git commit SHA (first 7 characters)
 */
export const GIT_COMMIT_SHORT = GIT_COMMIT_SHA.slice(0, 7);
