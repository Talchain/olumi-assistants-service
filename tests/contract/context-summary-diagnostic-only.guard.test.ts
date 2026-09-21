/**
 * M3 hardening #3 — `_context_summary` is diagnostic-only.
 *
 * The redacted `_context_summary` surface exists for staging diagnostics +
 * the Golden-Journey Harness (A1/A2) ONLY. It must never become product
 * logic: no UI / prose / chip / coaching / handler path may read it.
 *
 * This static guard walks the entire `src/` tree and asserts the
 * `_context_summary` wire-key literal appears in CODE (comments stripped)
 * ONLY in the allowlisted files — the route that attaches it and the
 * debug-fields wire type. If the literal shows up in code anywhere else
 * (e.g. a composer started reading it as a product signal), this test
 * fails and forces a review.
 *
 * Mirrors the repo's existing source-scan guard pattern (see
 * forbidden-user-facing-phrases.test.ts), but file-scoped: it is the
 * converse of the redaction allowlist — redaction proves the value is
 * safe; this proves the value is not load-bearing outside diagnostics.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

import { stripCommentsFile, GUARD_WALK_TIMEOUT_MS } from '../../scripts/ci/strip-source-comments.mjs';

const SRC_ROOT = fileURLToPath(new URL('../../src', import.meta.url));
const WIRE_KEY = '_context_summary';

/**
 * All three scans below match the COMMENT-STRIPPED view of each file
 * (scripts/ci/strip-source-comments.mjs, the shared literal-aware
 * tokeniser). The contract is that no product path READS these keys — a
 * comment cannot read a field, so a design note naming a key must never
 * fail the guard (the source-scanning-guard footgun: before this, an
 * accurate comment in a new file turned this gate red, and comment-only
 * mentions forced allowlist entries). Consequence: the allowlists now
 * enumerate exactly the files with CODE references, and files whose only
 * mention is documentation need no entry at all.
 */
function codeView(file: string): string {
  return stripCommentsFile(file);
}

/**
 * Files allowed to reference the `_context_summary` wire key in CODE, as
 * paths relative to `src/`. Every entry is a diagnostic-plane file:
 *   - route-v2.ts          — strips + flag-gated re-attaches the surface
 *   - debug-fields.ts      — the optional wire-type augmentation
 * (build-context-summary.ts, canonical-analysis-state.ts and config/index.ts
 * mention the key in comments only — invisible to the code-view scan, so
 * they need no allowlisting.)
 * NONE of these is a UI / prose / chip / coaching / handler product path.
 */
const ALLOWLIST = new Set<string>([
  'orchestrator/route-v2.ts',
  'orchestrator/debug-fields.ts',
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
      const text = codeView(file);
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
  }, GUARD_WALK_TIMEOUT_MS); // full-src tree walk; explicit timeout absorbs parallel-load CPU contention

  it('allowlist entries are real and still reference the key (no stale allowlisting)', () => {
    for (const rel of ALLOWLIST) {
      const text = codeView(join(SRC_ROOT, rel));
      expect(text.includes(WIRE_KEY), `${rel} no longer references ${WIRE_KEY} in code`).toBe(true);
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
  // (route-v2.ts and config/index.ts mention the key in comments only —
  // invisible to the code-view scan, so they need no allowlisting.)
]);

describe('`coaching_state_pack` is diagnostic-only (static guard)', () => {
  it('appears only in the allowlisted diagnostic-plane builder', () => {
    const offenders: string[] = [];
    for (const file of walkTsFiles(SRC_ROOT)) {
      const text = codeView(file);
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
  }, GUARD_WALK_TIMEOUT_MS); // full-src tree walk; explicit timeout absorbs parallel-load CPU contention

  it('allowlist entry still references the key (no stale allowlisting)', () => {
    for (const rel of COACHING_ALLOWLIST) {
      const text = codeView(join(SRC_ROOT, rel));
      expect(text.includes(COACHING_WIRE_KEY), `${rel} no longer references ${COACHING_WIRE_KEY} in code`).toBe(true);
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
  // (canonical-analysis-state.ts and config/index.ts mention the field in
  // comments only — invisible to the code-view scan, so they need no
  // allowlisting.)
]);

describe('`canonical_state_source` is diagnostic-only (static guard)', () => {
  it('appears only in allowlisted diagnostic-plane files', () => {
    const offenders: string[] = [];
    for (const file of walkTsFiles(SRC_ROOT)) {
      const text = codeView(file);
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
  }, GUARD_WALK_TIMEOUT_MS); // full-src tree walk; explicit timeout absorbs parallel-load CPU contention

  it('allowlist entry still references the key (no stale allowlisting)', () => {
    for (const rel of SOURCE_ALLOWLIST) {
      const text = codeView(join(SRC_ROOT, rel));
      expect(text.includes(SOURCE_WIRE_KEY), `${rel} no longer references ${SOURCE_WIRE_KEY} in code`).toBe(true);
    }
  });
});
