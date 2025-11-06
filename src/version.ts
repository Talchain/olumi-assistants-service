import { readFileSync } from 'node:fs';
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
