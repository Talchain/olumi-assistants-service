/**
 * AI Harness completion pass — architecture-protection static scan.
 *
 * The harness owns ASSURANCE only. It asserts behaviour; it must never
 * implement behaviour. These checks mechanically enforce the hard rule
 * that no local substitute for graph/data architecture logic lives in the
 * harness surface:
 *
 *   - no local graph hashing (identity, topology, or analysis-affecting);
 *   - no import of the CEE-local graph-identity module (Group A owns it;
 *     it has zero production call sites and is NOT wire-observable);
 *   - no CAS / stale-write logic or vocabulary claiming CAS exists;
 *   - no local model-version truth (no version substrate exists at all);
 *   - no zod schema substitutes (the ONE sanctioned inline spec is
 *     tests/unit/t4-contract/, which self-guards its src isolation and is
 *     deliberately NOT re-scanned or extended here);
 *   - no fixture pretending the 64-hex graphIdentityHash is a wire value
 *     (wire hashes are the 16-hex analysis-affecting hash).
 *
 * Style follows the t4-contract isolation guard: fs scan, non-vacuous by
 * construction (file counts asserted), path-exact allowlists so the scan
 * itself cannot become the drift vector.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

/** Repo root, derived from this file's location (tests/unit/ai-harness/). */
const REPO_ROOT = join(__dirname, '..', '..', '..');

/** Directories that constitute the harness surface (TS scan). */
const HARNESS_TS_DIRS = [
  'tools/golden-journey-harness',
  'tools/v5-journey-replay',
  'tests/unit/ai-harness',
  'tests/unit/golden-journey-harness',
  'tests/unit/v5-journey-replay',
] as const;

/** Fixture JSON scanned for wire-shape honesty. */
const FIXTURE_JSON_DIRS = ['tools/golden-journey-harness/fixtures', 'tests/fixtures/cross-service'] as const;

/**
 * Files exempt from the TOKEN scans because they hold forbidden names as
 * scan data (regex literals / substrate-signal strings), not as logic:
 *   - this scanner itself;
 *   - the future-hooks registry, whose tripwires name the substrate
 *     signals (CEE_V5_GRAPH_CAS_MODE, graph_identity_hash, model_versions)
 *     they assert are ABSENT from src.
 * Path-exact (repo-relative, POSIX separators).
 */
const SCAN_DATA_FILES: ReadonlySet<string> = new Set([
  'tests/unit/ai-harness/architecture-protection.test.ts',
  'tests/unit/ai-harness/future-hooks-registry.test.ts',
]);

/**
 * The ONE sanctioned hashing site in the harness: the v5 replay client's
 * non-JSON BODY fingerprint (`__body_sha256_prefix`, diagnostics-only).
 * It hashes an HTTP body for correlation — never a graph.
 */
const HASHING_ALLOWLIST: ReadonlySet<string> = new Set(['tools/v5-journey-replay/client.ts']);

function walkFiles(dir: string, ext: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === 'node_modules') continue;
      out.push(...walkFiles(full, ext));
    } else if (entry.endsWith(ext)) {
      out.push(full);
    }
  }
  return out;
}

function repoRel(absPath: string): string {
  return relative(REPO_ROOT, absPath).split(sep).join('/');
}

/**
 * Strips line comments and block comments so that harness documentation
 * may NAME an absent substrate (e.g. "no model_versions table exists")
 * without tripping the token scan. Tokens in live code or string literals
 * still match. Deliberately simple — a comment-shaped string literal
 * would be stripped too, which is the safe direction here.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

function harnessTsFiles(): Array<{ rel: string; source: string }> {
  const files: Array<{ rel: string; source: string }> = [];
  for (const dir of HARNESS_TS_DIRS) {
    const abs = join(REPO_ROOT, dir);
    const found = walkFiles(abs, '.ts');
    // Non-vacuous: an empty scan proves nothing (t4 isolation-guard rule).
    expect(found.length, `scan found no .ts files under ${dir} — the scan itself is broken`).toBeGreaterThan(0);
    for (const f of found) {
      files.push({ rel: repoRel(f), source: readFileSync(f, 'utf-8') });
    }
  }
  return files;
}

function fixtureJsonFiles(): Array<{ rel: string; parsed: unknown }> {
  const files: Array<{ rel: string; parsed: unknown }> = [];
  for (const dir of FIXTURE_JSON_DIRS) {
    const abs = join(REPO_ROOT, dir);
    const found = walkFiles(abs, '.json');
    expect(found.length, `scan found no .json files under ${dir} — the scan itself is broken`).toBeGreaterThan(0);
    for (const f of found) {
      files.push({ rel: repoRel(f), parsed: JSON.parse(readFileSync(f, 'utf-8')) as unknown });
    }
  }
  return files;
}

/** Walks parsed JSON yielding [dottedPath, key, value] for every property. */
function* jsonEntries(value: unknown, path = '$'): Generator<[string, string, unknown]> {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) yield* jsonEntries(value[i], `${path}[${i}]`);
  } else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      yield [`${path}.${k}`, k, v];
      yield* jsonEntries(v, `${path}.${k}`);
    }
  }
}

describe('architecture protection — the harness asserts, it never implements', () => {
  const tsFiles = harnessTsFiles();
  const tokenScannable = tsFiles.filter((f) => !SCAN_DATA_FILES.has(f.rel));

  it('scans a real population (non-vacuous guard)', () => {
    expect(tsFiles.length).toBeGreaterThan(20);
    expect(tokenScannable.length).toBeGreaterThan(18);
  });

  it('no local hashing: createHash/crypto.subtle/sha256() appear only in the sanctioned body-fingerprint client', () => {
    const HASHING = /\bcreateHash\s*\(|\bcrypto\.subtle\b|\bsha256\s*\(/;
    for (const { rel, source } of tokenScannable) {
      if (HASHING_ALLOWLIST.has(rel)) continue;
      expect(
        HASHING.test(stripComments(source)),
        `${rel}: hashing primitive found in the harness. The harness never computes hashes — graph hashes are ` +
          `opaque wire strings owned by src (Group A). If you need a NEW non-graph fingerprint, extend ` +
          `HASHING_ALLOWLIST deliberately with a review note; never hash graph content here.`,
      ).toBe(false);
    }
  });

  it('no graph-identity implementation surface: the CEE-local module is never imported or re-implemented', () => {
    const IDENTITY_SURFACE =
      /computeGraphIdentityHash|normaliseGraphForIdentity|evaluateGraphIdentityCas|from\s+['"][^'"]*graph-identity/;
    for (const { rel, source } of tokenScannable) {
      expect(
        IDENTITY_SURFACE.test(stripComments(source)),
        `${rel}: graph-identity functional surface referenced in the harness. graphIdentityHash is CEE-local ` +
          `(zero production call sites, not wire-observable). The harness must treat identity as ABSENT until ` +
          `the identity-exposure hook (ISSUE-9024, future-hooks-registry) converts.`,
      ).toBe(false);
    }
  });

  it('no CAS logic or CAS-availability vocabulary in the harness', () => {
    const CAS_TOKENS = /GraphStaleWriteError|graph_cas|CAS_MODE|compare[-_]?and[-_]?swap/i;
    for (const { rel, source } of tokenScannable) {
      expect(
        CAS_TOKENS.test(stripComments(source)),
        `${rel}: CAS vocabulary found in the harness. No CAS substrate exists on this branch (A3 observe-mode ` +
          `is PR #346, unmerged; enforcement is OFF everywhere). The harness must not imply CAS exists — see ` +
          `the A3 hook (ISSUE-9023, future-hooks-registry).`,
      ).toBe(false);
    }
  });

  it('no local model-version truth in the harness', () => {
    const VERSION_TRUTH = /model_versions|version_pointer|restoreVersion|\bmodelVersion\b/;
    for (const { rel, source } of tokenScannable) {
      expect(
        VERSION_TRUTH.test(stripComments(source)),
        `${rel}: model-version vocabulary found in harness code. No version substrate exists (no table, no ` +
          `pointer, no restore path — Model Management is future work, ISSUE-9025). The harness may FLAG ` +
          `version-claim wording as phantom success, but must never model versions itself.`,
      ).toBe(false);
    }
  });

  it('no schema substitutes: zod never appears in the harness surface (the t4-contract spec is the one sanctioned, self-guarded exception)', () => {
    const ZOD_IMPORT = /from\s+['"]zod['"]|require\(\s*['"]zod['"]\s*\)/;
    for (const { rel, source } of tsFiles) {
      expect(
        ZOD_IMPORT.test(source),
        `${rel}: zod import found in the harness surface. Harness types are read-through views over the wire; ` +
          `contracts are owned by src schemas / @talchain/schemas. The only sanctioned inline spec is ` +
          `tests/unit/t4-contract/candidate-mutation-envelope.test.ts (isolated by its own guard; do not add more).`,
      ).toBe(false);
    }
  });

  it('no wire-key implication of identity-hash availability (graph_identity_hash / identity_hash keys)', () => {
    const IDENTITY_WIRE_KEY = /["']graph_identity_hash["']|["']identity_hash["']/;
    for (const { rel, source } of tokenScannable) {
      expect(
        IDENTITY_WIRE_KEY.test(stripComments(source)),
        `${rel}: identity-hash wire key referenced. No such key exists on any response or diagnostic surface ` +
          `today. If identity exposure genuinely landed, convert via ISSUE-9024 (future-hooks-registry) — do ` +
          `not start reading a key the contract does not carry.`,
      ).toBe(false);
    }
  });

  it('fixtures never carry a 64-hex graph hash: wire hashes are the 16-hex analysis-affecting hash, not graphIdentityHash', () => {
    const HASH_KEY = /graph_hash/; // matches graph_hash, graph_hash_at_run, current_graph_hash
    const HEX_64 = /^[0-9a-f]{64}$/i;
    let hashValuesSeen = 0;
    for (const { rel, parsed } of fixtureJsonFiles()) {
      for (const [path, key, value] of jsonEntries(parsed)) {
        if (!HASH_KEY.test(key) || typeof value !== 'string') continue;
        hashValuesSeen += 1;
        expect(
          HEX_64.test(value),
          `${rel} ${path}: a 64-hex value in a *graph_hash* field means someone put a graphIdentityHash on a ` +
            `wire fixture. Identity hash is CEE-local (Group A) and NOT wire-observable. If the wire genuinely ` +
            `gained identity-hash exposure, convert via ISSUE-9024 in future-hooks-registry — do not just ` +
            `update the fixture.`,
        ).toBe(false);
      }
    }
    // Non-vacuous: the fixture population must actually carry hash fields.
    expect(hashValuesSeen, 'no *graph_hash* values found in any fixture — the tripwire is scanning nothing').toBeGreaterThan(0);
  });

  it('fixtures never carry model-version or CAS wire keys', () => {
    const FORBIDDEN_KEY = /model_version|version_pointer|graph_cas|stale_write/;
    for (const { rel, parsed } of fixtureJsonFiles()) {
      for (const [path, key] of jsonEntries(parsed)) {
        expect(
          FORBIDDEN_KEY.test(key),
          `${rel} ${path}: fixture key "${key}" implies a substrate (model versions / CAS) that does not exist ` +
            `on any wire surface. Blocked-future fixtures live in future-hooks-registry, keyed to their ` +
            `substrate signal — fixtures must not invent the shape early.`,
        ).toBe(false);
      }
    }
  });
});
