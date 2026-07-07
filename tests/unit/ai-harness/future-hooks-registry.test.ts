/**
 * AI Harness completion pass — future-hooks registry.
 *
 * Every blocked-future assurance check lives HERE, keyed to a named owner
 * and a REAL substrate signal. Two parts per hook:
 *
 *   1. An ACTIVE substrate-absence tripwire: an fs scan asserting the
 *      substrate signal is still absent from src. The moment the substrate
 *      lands, the tripwire FAILS with a precise conversion instruction —
 *      blocked-future coverage gets converted deliberately in the landing
 *      change, instead of rotting as a forgotten skip. (Same deliberate-
 *      diff culture as the replay manifest and the typecheck ratchet.)
 *
 *   2. A SKIPPED enforcing case documenting the expected state when
 *      unblocked, with a CI-compliant `// TODO: ISSUE-90XX` reference.
 *
 * The tripwires read src/supabase sources as DATA (grep-style). They
 * import nothing from src and implement nothing — the registry may name
 * substrate signals (that is its job); the architecture-protection scan
 * exempts this one file from token checks for exactly that reason.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(__dirname, '..', '..', '..');

interface FutureHook {
  readonly id: string;
  readonly issue: `ISSUE-${number}`;
  readonly owner: string;
  /** The concrete, observable signal whose arrival unblocks the hook. */
  readonly substrateSignal: string;
  /** What the enforcing test asserts once unblocked. */
  readonly expectedWhenUnblocked: string;
  /**
   * true = the tripwire below FAILS when the substrate lands, forcing the
   * skip→enforcing conversion in the landing change itself.
   */
  readonly autoEnforceIntent: boolean;
}

/** The registry — one screen, one entry per blocked-future check. */
const FUTURE_HOOKS: readonly FutureHook[] = [
  {
    id: 'a3-cas-observe-mode',
    issue: 'ISSUE-9023',
    owner: 'Canonical State / A3 (PR #346)',
    substrateSignal: 'CEE_V5_GRAPH_CAS_MODE (or CEE_GRAPH_IDENTITY_CAS_MODE) appears in src/config',
    expectedWhenUnblocked:
      'observe mode is default-off, non-blocking, diagnostic-only (v5.graph_cas.evaluated telemetry); ' +
      'enforce cannot be enabled accidentally (prod auto-downgrades); NO assertion of atomic CAS anywhere',
    autoEnforceIntent: true,
  },
  {
    id: 'graph-identity-exposure',
    issue: 'ISSUE-9024',
    owner: 'Canonical State / graph-data contract ratification',
    substrateSignal: 'graphIdentityHash / graph_identity_hash reaches a wire or diagnostic surface',
    expectedWhenUnblocked:
      'identity-hash parity assertions: 64-hex identity signal observable and distinct from the 16-hex ' +
      'analysis-affecting hash; label-only durability blind spot (ISSUE-9021) closes',
    autoEnforceIntent: true,
  },
  {
    id: 'model-versions-substrate',
    issue: 'ISSUE-9025',
    owner: 'Model Management',
    substrateSignal: 'a model_versions table (or equivalent version/current-pointer substrate) exists',
    expectedWhenUnblocked:
      'version/restore/compare wording is enforced against real version state; restore/rollback/version ' +
      'claims swap or block at egress when uncommitted (un-blocks ISSUE-9022); the mutation-language ' +
      "'version' noun exclusion is revisited by the owner",
    autoEnforceIntent: true,
  },
  {
    id: 'candidate-mutation-envelope-ratified',
    issue: 'ISSUE-9026',
    owner: 'Track 4 / graph-data contract ratification',
    substrateSignal: 'CandidateMutationEnvelope exported from src (shared, ratified shape)',
    expectedWhenUnblocked:
      'tests/unit/t4-contract/candidate-mutation-envelope.test.ts repoints its import at the shared export ' +
      '(assertions survive verbatim, per that file’s own header) and its isolation guard is retired',
    autoEnforceIntent: true,
  },
  {
    id: 'track4-proposal-card',
    issue: 'ISSUE-9027',
    owner: 'Track 4 UI',
    substrateSignal: 'a proposal_card / proposalCard surface appears in src compose/schemas',
    expectedWhenUnblocked:
      'golden-journey proposal-visibility becomes enforcing: proposal turns observable via ' +
      'pending_confirmation + proposed_* pendings + render-safe copy; never inferred from prose',
    autoEnforceIntent: true,
  },
] as const;

// ── scan helpers (data reads only — no src imports) ────────────────────────

function walkFiles(dir: string, ext: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === 'node_modules' || entry === '__tests__') continue;
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
 * Strip line (`//…`) and block (`/* … *\/`, incl. JSDoc) comments so the
 * substrate scan matches SHIPPING CODE references only.
 *
 * A substrate is "landed" when it exists in shipping code, not when a
 * comment merely NAMES it — e.g. build-context-summary.ts documents that
 * "the CEE-local 64-hex graphIdentityHash is on NO wire or diagnostic
 * surface", asserting the OPPOSITE of a landing, yet a raw string scan
 * matched that documentation and fired the ISSUE-9024 tripwire falsely.
 *
 * This never HIDES a real landing: code after `//` or inside `/* *\/` is by
 * definition itself commented out, and a genuine substrate reference is an
 * identifier / property / string KEY (e.g. `env.CEE_V5_GRAPH_CAS_MODE`,
 * `"CEE_V5_GRAPH_CAS_MODE"`) — none of which are comments, so all survive.
 * Deliberately does not model string literals containing comment tokens;
 * that edge case cannot manufacture a false NEGATIVE for these identifier-
 * shaped signals. Stripping only removes text, so a currently-passing
 * (empty-hits) tripwire can never be flipped red by this refinement.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ') // block + JSDoc comments
    .replace(/\/\/[^\n]*/g, ' '); // line comments
}

/**
 * Returns repo-relative paths of files under `dirs` (plus `extraFiles`)
 * whose SHIPPING CODE (comments stripped, see `stripComments`) matches
 * `pattern`. `__tests__` directories are excluded: a substrate is "landed"
 * when it exists in shipping code, not when a src-colocated test merely
 * names it (graph-identity's own tests already name graphIdentityHash
 * today).
 */
function filesMatching(dirs: readonly string[], ext: string, pattern: RegExp, extraFiles: readonly string[] = []): string[] {
  const hits: string[] = [];
  const paths: string[] = [];
  for (const dir of dirs) paths.push(...walkFiles(join(REPO_ROOT, dir), ext));
  for (const f of extraFiles) {
    const abs = join(REPO_ROOT, f);
    if (existsSync(abs)) paths.push(abs);
  }
  expect(paths.length, `substrate scan found no ${ext} files under [${dirs.join(', ')}] — the tripwire is scanning nothing`).toBeGreaterThan(0);
  for (const abs of paths) {
    if (pattern.test(stripComments(readFileSync(abs, 'utf-8')))) hits.push(repoRel(abs));
  }
  return hits;
}

// ── registry integrity ──────────────────────────────────────────────────────

describe('future-hooks registry — integrity', () => {
  it('every hook names an owner, a real substrate signal, and its unblocked expectation', () => {
    expect(FUTURE_HOOKS.length).toBe(5);
    for (const hook of FUTURE_HOOKS) {
      expect(hook.owner.length, `${hook.id}: owner missing`).toBeGreaterThan(0);
      expect(hook.substrateSignal.length, `${hook.id}: substrate signal missing`).toBeGreaterThan(0);
      expect(hook.expectedWhenUnblocked.length, `${hook.id}: unblocked expectation missing`).toBeGreaterThan(0);
      expect(hook.issue).toMatch(/^ISSUE-90\d\d$/);
    }
  });

  it('issue references are unique (they double as the skip-tracking markers)', () => {
    const issues = FUTURE_HOOKS.map((h) => h.issue);
    expect(new Set(issues).size).toBe(issues.length);
  });
});

// ── HOOK 1: A3 CAS observe-mode (ISSUE-9023) ───────────────────────────────

describe('hook a3-cas-observe-mode (ISSUE-9023, owner: Canonical State / A3, PR #346)', () => {
  // ISSUE-9023 CONVERTED (2026-07-07): PR #346 landed CEE_V5_GRAPH_CAS_MODE and
  // observe-mode was flipped on staging with Paul's authorisation. Tripwire
  // deleted per its own instructions; enforcing coverage below. Deliberately
  // NOT asserted: atomic CAS enforcement — A3 is app-side stale-write
  // OBSERVATION with a TOCTOU window; true atomicity is future RPC v3 work.

  it('ENFORCING: A3 substrate is present in src/config', () => {
    const hits = filesMatching(['src/config'], '.ts', /CEE_V5_GRAPH_CAS_MODE|CEE_GRAPH_IDENTITY_CAS_MODE/);
    expect(hits, 'A3 CAS-mode flag disappeared from src/config — ISSUE-9023 regressed').not.toEqual([]);
  });

  it('ENFORCING: observe mode is default-off and enforce cannot engage accidentally in prod', () => {
    // Raw source (not stripComments): an earlier string literal containing "/*"
    // makes the comment-stripper swallow the flag-definition region. Behavioural
    // enforcement lives in tests/unit/config.graph-cas-mode.test.ts; these are
    // source pins against silent default/lockdown edits.
    const configSrc = readFileSync(join(REPO_ROOT, 'src/config/index.ts'), 'utf-8');
    // Code default is "off": flag absent ⇒ zero behaviour change.
    expect(
      /graphCasMode:\s*createEnvEnforcedMode\(\s*"off"\s*,\s*"CEE_V5_GRAPH_CAS_MODE"\s*\)/.test(configSrc),
      'graphCasMode code default must remain "off" (default-off invariant)',
    ).toBe(true);
    // Prod lockdown: requested enforce downgrades to observe, never boots into
    // a blocking mode on a non-atomic app-side check.
    expect(
      /env\s*===\s*"prod"\s*&&\s*requested\s*===\s*"enforce"/.test(configSrc),
      'prod enforce→observe downgrade guard missing from createEnvEnforcedMode',
    ).toBe(true);
  });

  it('ENFORCING: observe mode is diagnostic-only (telemetry registered) and behaviourally covered', () => {
    // Diagnostic surface: the observation event is a registered telemetry name.
    const telemetrySrc = readFileSync(join(REPO_ROOT, 'src/utils/telemetry.ts'), 'utf-8');
    expect(
      telemetrySrc.includes('v5.graph_cas.evaluated'),
      'v5.graph_cas.evaluated must stay a registered telemetry event (diagnostic-only contract)',
    ).toBe(true);
    // Non-blocking behaviour is owned by the A3 suites shipped with #346 —
    // assert they still exist so the behavioural contract cannot silently
    // vanish while this registry test stays green.
    for (const rel of [
      'tests/unit/config.graph-cas-mode.test.ts',
      'src/orchestrator-v5/session/__tests__/supabase-store-graph-cas.test.ts',
      'src/orchestrator-v5/context/__tests__/graph-cas-conflict.test.ts',
    ]) {
      expect(existsSync(join(REPO_ROOT, rel)), `A3 behavioural suite missing: ${rel}`).toBe(true);
    }
  });
});

// ── HOOK 2: graph-identity wire exposure (ISSUE-9024) ──────────────────────

describe('hook graph-identity-exposure (ISSUE-9024, owner: Canonical State)', () => {
  it('TRIPWIRE: graphIdentityHash is not on any wire/diagnostic surface yet', () => {
    const hits = filesMatching(
      ['src/schemas', 'src/orchestrator-v5/compose', 'src/orchestrator-v5/context/frame'],
      '.ts',
      /graphIdentityHash|graph_identity_hash/,
      ['src/orchestrator-v5/context/build-context-summary.ts', 'src/orchestrator-v5/context/context-summary-from-frame.ts'],
    );
    expect(
      hits,
      'graphIdentityHash appears to have reached a wire/diagnostic surface (schemas / compose / frame / ' +
        'context-summary). Convert deliberately: (1) un-skip the ISSUE-9024 case — assert the identity signal ' +
        'is observable, 64-hex, and DISTINCT from the 16-hex analysis-affecting hash; (2) convert the A3 ' +
        'label-only blind-spot pin in tests/unit/golden-journey-harness/label-only-freshness.test.ts ' +
        '(ISSUE-9021) into an enforcing durability check; (3) relax the 64-hex fixture tripwire in ' +
        'architecture-protection.test.ts for the NEW identity field only; (4) delete this tripwire.',
    ).toEqual([]);
  });

  // TODO: ISSUE-9024 — identity-hash parity assertions; blocked until identity
  // exposure ships on a wire/diagnostic surface. Owner: Canonical State.
  it.skip('ENFORCING (when unblocked): identity hash observable, 64-hex, distinct from the analysis-affecting hash; label-only durability becomes provable', () => {
    expect.unreachable('blocked-future: graphIdentityHash has zero production call sites and no wire surface');
  });
});

// ── HOOK 3: model-versions substrate (ISSUE-9025) ──────────────────────────

describe('hook model-versions-substrate (ISSUE-9025, owner: Model Management)', () => {
  // ISSUE-9025 PARTIALLY CONVERTED (2026-07-07): the model_versions substrate
  // landed dark via PR #349 (+#354–#357 stack). Tripwire deleted per its own
  // instructions; substrate-presence and dark-by-default are enforced below.
  // The wording-honesty half stays skipped (narrowed precondition below):
  // with zero live call sites no restore/version claim can occur, and
  // ISSUE-9022's src-side claim detection has not shipped.

  it('ENFORCING: model_versions substrate is present in migrations and src', () => {
    const sqlHits = filesMatching(['supabase/migrations'], '.sql', /model_versions/);
    const tsHits = filesMatching(['src'], '.ts', /\bmodel_versions\b/);
    expect(sqlHits, 'model_versions migration disappeared — ISSUE-9025 regressed').not.toEqual([]);
    expect(tsHits, 'model_versions service module disappeared — ISSUE-9025 regressed').not.toEqual([]);
  });

  it('ENFORCING: Model Management stays dark by default (env-enforced flag, prod-locked)', () => {
    // Raw source (not stripComments — see the A3 hook note above).
    const configSrc = readFileSync(join(REPO_ROOT, 'src/config/index.ts'), 'utf-8');
    expect(
      /createEnvEnforcedBoolean\(\s*false\s*,\s*"CEE_MODEL_VERSIONS_ENABLED"\s*\)/.test(configSrc),
      'CEE_MODEL_VERSIONS_ENABLED must remain env-enforced default-false (dark invariant)',
    ).toBe(true);
    // The module's own gates must keep existing: flag-off no-op behaviour and
    // the migration's security-load-bearing lines are pinned by these suites.
    for (const rel of [
      'src/orchestrator-v5/model-management/__tests__/service-flag-gate.test.ts',
      'src/orchestrator-v5/model-management/__tests__/migration-static-guards.test.ts',
      'src/orchestrator-v5/model-management/__tests__/store-adapter.test.ts',
    ]) {
      expect(existsSync(join(REPO_ROOT, rel)), `MM guard suite missing: ${rel}`).toBe(true);
    }
  });

  // TODO: ISSUE-9025 (narrowed) — restore/version/compare wording honesty
  // against real version state; blocked until ISSUE-9022's src-side
  // restore/version claim detection ships. NOTE (lane 8, 2026-07-07): MM
  // gained its FIRST live call site — the flag-gated commit-seam saveVersion
  // hook in commit.ts (fire-and-forget, never surfaces version PROSE to the
  // user), so the "no version claim can occur" premise is now narrowed to
  // user-facing surfaces: restore/compare remain dark and CEE still emits no
  // version wording. Owner: Model Management.
  it.skip('ENFORCING (when unblocked): restore/version/compare wording is grounded in real version state; uncommitted claims swap or block', () => {
    expect.unreachable('blocked-future: MM is dark with zero live call sites — no version claim can reach a user yet');
  });
});

// ── HOOK 4: ratified CandidateMutationEnvelope (ISSUE-9026) ────────────────

describe('hook candidate-mutation-envelope-ratified (ISSUE-9026, owner: Track 4 / contract ratification)', () => {
  // ISSUE-9026 FULLY CONVERTED (lane 8, 2026-07-07): the deferred repoint of
  // tests/unit/t4-contract/candidate-mutation-envelope.test.ts onto the
  // module export is DONE — drift was reconciled assertion-by-assertion (six
  // documented payload deltas, all in the ratified fail-closed direction;
  // see the spec's header + the lane-8 evidence report) and the inline shape
  // is RETIRED. Live wiring landed the SAME session (Paul's GM/MM mandate):
  // the edit_graph dispatch consumes the module behind CEE_GRAPH_MANAGEMENT_
  // MODE (env-enforced, default off, prod live→shadow downgrade), so the
  // old "zero live imports" isolation pin is replaced by SCHEMA-OWNERSHIP
  // enforcement — the envelope's Zod definition stays module-owned; every
  // other src reference is a consumer import, never a second definition.

  it('ENFORCING: the envelope schema DEFINITION stays owned by the graph-management module', () => {
    const definitionHits = filesMatching(['src'], '.ts', /CandidateMutationEnvelopeV1\s*=/);
    expect(
      definitionHits,
      'CandidateMutationEnvelopeV1 definition vanished from src — ISSUE-9026 regressed',
    ).not.toEqual([]);
    for (const hit of definitionHits) {
      expect(
        hit.startsWith('src/orchestrator-v5/graph-management/'),
        `A second CandidateMutationEnvelopeV1 definition exists outside the owning module: ${hit} — ` +
          'consumers must import the shared export, never re-define the shape',
      ).toBe(true);
    }
  });

  it('ENFORCING: the envelope is consumed on the live edit path behind the mode flag', () => {
    const wiringHits = filesMatching(['src/orchestrator-v5/handlers'], '.ts', /graph-management/);
    expect(
      wiringHits,
      'The edit dispatch no longer references graph-management — the lane-8 live wiring regressed',
    ).not.toEqual([]);
    const configSrc = readFileSync(join(REPO_ROOT, 'src/config/index.ts'), 'utf-8');
    expect(
      /graphManagementMode:\s*createEnvEnforcedGraphManagementMode\(\s*"off"\s*,\s*"CEE_GRAPH_MANAGEMENT_MODE"\s*,?\s*\)/.test(
        configSrc,
      ),
      'CEE_GRAPH_MANAGEMENT_MODE must remain env-enforced default-off (dark-by-default invariant)',
    ).toBe(true);
  });

  it('ENFORCING: the module ships its own envelope-schema and isolation suites', () => {
    for (const rel of [
      'src/orchestrator-v5/graph-management/__tests__/envelope-schema.test.ts',
      'src/orchestrator-v5/graph-management/__tests__/isolation-guards.test.ts',
    ]) {
      expect(existsSync(join(REPO_ROOT, rel)), `GM guard suite missing: ${rel}`).toBe(true);
    }
  });

  it('ENFORCING (ISSUE-9026 un-skipped): the t4-contract spec asserts against the shared export, not a local shape', () => {
    const specPath = join(REPO_ROOT, 'tests/unit/t4-contract/candidate-mutation-envelope.test.ts');
    expect(existsSync(specPath), 't4-contract spec missing').toBe(true);
    const spec = readFileSync(specPath, 'utf-8');
    // Repointed: imports the shared module export …
    expect(
      /from\s+['"][^'"]*src\/orchestrator-v5\/graph-management\/index\.js['"]/.test(spec),
      't4-contract spec must import CandidateMutationEnvelopeV1 from the graph-management module',
    ).toBe(true);
    // … and the inline shape is retired (no local discriminated-union rebuild).
    expect(
      /discriminatedUnion/.test(spec),
      't4-contract spec must not re-define the envelope inline (both shapes alive)',
    ).toBe(false);
  });
});

// ── HOOK 5: Track 4 proposal-card surface (ISSUE-9027) ─────────────────────

describe('hook track4-proposal-card (ISSUE-9027, owner: Track 4 UI)', () => {
  it('TRIPWIRE: no proposal-card surface exists in src yet (best-effort signal)', () => {
    const hits = filesMatching(
      ['src/schemas', 'src/orchestrator-v5/compose'],
      '.ts',
      /proposal_card|proposalCard/,
    );
    expect(
      hits,
      'A proposal-card surface appears in src compose/schemas (best-effort signal — if Track 4 shipped its ' +
        'card under another name, treat that as the same trigger). Convert deliberately: (1) un-skip the ' +
        'ISSUE-9027 case — proposal visibility asserted from pending_confirmation + proposed_* pendings + ' +
        'render-safe copy, NEVER inferred from prose; (2) delete this tripwire.',
    ).toEqual([]);
  });

  // TODO: ISSUE-9027 — proposal-card visibility checks; blocked until the
  // Track 4 proposal-card surface exists. Owner: Track 4 UI.
  it.skip('ENFORCING (when unblocked): proposal cards surface the pending/proposed state honestly (proposed ≠ applied)', () => {
    expect.unreachable('blocked-future: no proposal-card surface exists');
  });
});
