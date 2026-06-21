/**
 * M3 hardening #3 — `_context_summary` is diagnostic-only.
 *
 * The redacted `_context_summary` surface exists for staging diagnostics +
 * the Golden-Journey Harness (A1/A2) ONLY. It must never become product
 * logic: no UI / prose / chip / coaching / handler path may read it.
 *
 * This static guard walks the entire `src/` tree and asserts the
 * `_context_summary` wire-key literal appears ONLY in the allowlisted
 * files — the route that attaches it, the builder/types that define it,
 * the debug-fields wire type, and the config flag doc. If the literal
 * shows up anywhere else (e.g. a composer started reading it as a product
 * signal), this test fails and forces a review.
 *
 * Mirrors the repo's existing source-scan guard pattern (see
 * forbidden-user-facing-phrases.test.ts), but file-scoped: it is the
 * converse of the redaction allowlist — redaction proves the value is
 * safe; this proves the value is not load-bearing outside diagnostics.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

const SRC_ROOT = fileURLToPath(new URL('../../src', import.meta.url));
const WIRE_KEY = '_context_summary';

/**
 * Files allowed to mention the `_context_summary` wire key, as paths
 * relative to `src/`. Every entry is a diagnostic-plane file:
 *   - route-v2.ts          — strips + flag-gated re-attaches the surface
 *   - debug-fields.ts      — the optional wire-type augmentation
 *   - build-context-summary.ts — the redacted builder + type
 *   - canonical-analysis-state.ts — module-doc reference only
 *   - config/index.ts      — the CEE_CONTEXT_SUMMARY_ENABLED flag doc
 * NONE of these is a UI / prose / chip / coaching / handler product path.
 */
const ALLOWLIST = new Set<string>([
  'orchestrator/route-v2.ts',
  'orchestrator/debug-fields.ts',
  'orchestrator-v5/context/build-context-summary.ts',
  'orchestrator-v5/context/canonical-analysis-state.ts',
  'config/index.ts',
]);

function walkTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      // Skip generated + test directories — the guard targets product src.
      if (entry === '__tests__' || entry === 'generated') continue;
      walkTsFiles(full, out);
    } else if (
      entry.endsWith('.ts') &&
      !entry.endsWith('.d.ts') &&
      !entry.endsWith('.test.ts') &&
      // Skip editor/sync duplicate copies ("foo 2.ts", "foo 3.tsx") — the
      // repo's .gitignore already excludes these via the `* 2.*` rule, so
      // they never reach a PR; this filesystem walk must not couple the
      // guard to recurring sync junk.
      !/ \d+\.[cm]?tsx?$/.test(entry)
    ) {
      out.push(full);
    }
  }
  return out;
}

describe('`_context_summary` is diagnostic-only (static guard)', () => {
  it('appears only in allowlisted diagnostic-plane src files', () => {
    const offenders: string[] = [];
    for (const file of walkTsFiles(SRC_ROOT)) {
      const text = readFileSync(file, 'utf8');
      if (!text.includes(WIRE_KEY)) continue;
      const rel = relative(SRC_ROOT, file).split('\\').join('/');
      if (!ALLOWLIST.has(rel)) offenders.push(rel);
    }
    expect(
      offenders,
      `'${WIRE_KEY}' must not be read outside the diagnostic plane. ` +
        `Unexpected files: ${offenders.join(', ')}. If a new diagnostic-plane ` +
        `file legitimately references it, add it to the ALLOWLIST; if a product ` +
        `path is reading it, that is a contract violation.`,
    ).toEqual([]);
  });

  it('allowlist entries are real and still reference the key (no stale allowlisting)', () => {
    for (const rel of ALLOWLIST) {
      const text = readFileSync(join(SRC_ROOT, rel), 'utf8');
      expect(text.includes(WIRE_KEY), `${rel} no longer mentions ${WIRE_KEY}`).toBe(true);
    }
  });
});
