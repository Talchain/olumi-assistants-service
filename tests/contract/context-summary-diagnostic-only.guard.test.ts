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

/**
 * The `coaching_state_pack` sub-block of `_context_summary` is held to the same
 * contract: it is a redacted diagnostic ONLY, never a product signal. The
 * wire literal must appear in exactly one diagnostic-plane file — the builder
 * that defines + attaches it. (It is deliberately named `coaching_state_pack`,
 * NOT `coaching_state`, to stay disjoint from the unrelated coaching-lifecycle
 * `coaching_state` feature; the route gates it via the camelCase
 * `includeCoachingState` / `coachingStatePackEnabled`, so this scan is precise.)
 */
const COACHING_WIRE_KEY = 'coaching_state_pack';
const COACHING_ALLOWLIST = new Set<string>([
  'orchestrator-v5/context/build-context-summary.ts', // defines + attaches the sub-block
  'orchestrator-v5/context/context-summary-from-frame.ts', // T4 Slice 2: frame-first projection attaches the same sub-block
  'orchestrator/route-v2.ts', // the second (default-off) gate, in a comment
  'config/index.ts', // the CEE_COACHING_STATE_PACK_ENABLED flag doc
]);

describe('`coaching_state_pack` is diagnostic-only (static guard)', () => {
  it('appears only in the allowlisted diagnostic-plane builder', () => {
    const offenders: string[] = [];
    for (const file of walkTsFiles(SRC_ROOT)) {
      const text = readFileSync(file, 'utf8');
      if (!text.includes(COACHING_WIRE_KEY)) continue;
      const rel = relative(SRC_ROOT, file).split('\\').join('/');
      if (!COACHING_ALLOWLIST.has(rel)) offenders.push(rel);
    }
    expect(
      offenders,
      `'${COACHING_WIRE_KEY}' must not be read outside the diagnostic plane. ` +
        `Unexpected files: ${offenders.join(', ')}. The coaching pack is a ` +
        `diagnostic sub-block; no prompt / chip / coaching / handler path may read it.`,
    ).toEqual([]);
  });

  it('allowlist entry still references the key (no stale allowlisting)', () => {
    for (const rel of COACHING_ALLOWLIST) {
      const text = readFileSync(join(SRC_ROOT, rel), 'utf8');
      expect(text.includes(COACHING_WIRE_KEY), `${rel} no longer mentions ${COACHING_WIRE_KEY}`).toBe(true);
    }
  });
});

/**
 * The `canonical_state_source` provenance discriminator (a sibling field of
 * `_context_summary`) gets the same dedicated guard. The whole envelope is
 * already protected, so this is not a current escape — it prevents a FUTURE
 * product path from reading the provenance discriminator directly outside the
 * diagnostic plane. The snake-case literal must appear only in diagnostic-plane
 * files (the route threads it via the camelCase `canonicalStateSource` input,
 * which does not contain the `canonical_state_source` substring).
 */
const SOURCE_WIRE_KEY = 'canonical_state_source';
const SOURCE_ALLOWLIST = new Set<string>([
  'orchestrator-v5/context/build-context-summary.ts', // defines + attaches the field
  'orchestrator-v5/context/context-summary-from-frame.ts', // T4 Slice 2: frame-first projection emits the field (from frame.analysis.source)
  'orchestrator-v5/context/canonical-analysis-state.ts', // doc cross-reference only
  'config/index.ts', // the coachingStatePackEnabled flag doc cross-reference
]);

describe('`canonical_state_source` is diagnostic-only (static guard)', () => {
  it('appears only in allowlisted diagnostic-plane files', () => {
    const offenders: string[] = [];
    for (const file of walkTsFiles(SRC_ROOT)) {
      const text = readFileSync(file, 'utf8');
      if (!text.includes(SOURCE_WIRE_KEY)) continue;
      const rel = relative(SRC_ROOT, file).split('\\').join('/');
      if (!SOURCE_ALLOWLIST.has(rel)) offenders.push(rel);
    }
    expect(
      offenders,
      `'${SOURCE_WIRE_KEY}' must not be read outside the diagnostic plane. ` +
        `Unexpected files: ${offenders.join(', ')}. The provenance discriminator is ` +
        `diagnostic-only; no prompt / chip / coaching / handler path may read it.`,
    ).toEqual([]);
  });

  it('allowlist entry still references the key (no stale allowlisting)', () => {
    for (const rel of SOURCE_ALLOWLIST) {
      const text = readFileSync(join(SRC_ROOT, rel), 'utf8');
      expect(text.includes(SOURCE_WIRE_KEY), `${rel} no longer mentions ${SOURCE_WIRE_KEY}`).toBe(true);
    }
  });
});
