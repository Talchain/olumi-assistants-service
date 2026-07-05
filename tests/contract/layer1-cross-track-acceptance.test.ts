/**
 * Layer-1 cross-track integration assurance — BASE SLICE.
 *
 * Purpose: catch cross-track integration drift automatically. Several
 * workstreams land in parallel (Track 2 pending-confirmation truth,
 * Track 3 graph-management referee, Group A canonical-state foundation,
 * V6 dual-model draft, post-analysis loop). Each is individually tested;
 * the failure mode this file guards is the SEAMS between them:
 *
 *   1. A dark lane's default flips silently (a merge enables what was
 *      approved as default-OFF, or disables a documented default-ON
 *      kill-switch). Section 1 pins the parsed config default for every
 *      such flag from a clean environment, AND pins the env-var → config
 *      key wiring (a rename that orphans the documented env var is drift
 *      too).
 *
 *   2. A wire payload that typechecks stops parsing at runtime (Zod
 *      refinements are invisible to tsc — see the boundary-fixture
 *      discipline in tests/contract/fixtures-schema.test.ts). Section 2
 *      adds ONLY the gap: the Track-2 propose-then-confirm egress shape
 *      (a `prop_*` chip carrying `action_type`) is not exercised by any
 *      existing v5-turn fixture, and the strictness negatives that keep
 *      internal pending-action mechanics off the wire are pinned nowhere
 *      else at runtime.
 *
 *   3. A merged foundation's cross-track invariants drift after the merge.
 *      Section 3 pins the Group A (#343) graph-identity contract that
 *      downstream lanes (pending-gate freshness, the #346 CAS lane, Model
 *      Management restore/compare) build on: identity-hash order
 *      invariance, the two-hash cosmetic-vs-substantive split, exact
 *      analysisAffectingHash golden values, and the versioned envelope
 *      literals.
 *
 *   4. Deferred slices land without their acceptance tests. Section 4 is
 *      the todo inventory: each `it.todo` names the decision or PR that
 *      unblocks it, so the follow-up slice has a checklist and reviewers
 *      can see what is deliberately NOT asserted yet.
 *
 * Relationship to existing harnesses (extends, never forks):
 *   - tests/contract/v5-golden-path-acceptance.test.ts — black-box
 *     product-shape acceptance gate (this file follows its no-internal-
 *     state-peeking convention).
 *   - tests/contract/fixtures-schema.test.ts — cross-service fixture
 *     safeParse (covers explain/failure v5-turn shapes; this file adds
 *     the proposed-change shape inline rather than duplicating the
 *     fixture plumbing for a payload no other test consumes).
 *   - tests/contract/cee-egress-wire-surface-pin.test.ts — Zod
 *     introspection pins for the 0.13.0 wire surface (pins ActionSchema
 *     KEYS; this file adds the runtime accept/reject behaviour).
 *   - tests/unit/config.test.ts — the clean-env + dynamic-import pattern
 *     Section 1 reuses.
 *
 * Deterministic and in-process: no network, no LLM, no service build.
 * Runs in the required gate (tests/contract/ is collected by
 * vitest.required.config.ts).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { OlumiResponseSchema } from '@talchain/schemas/boundary';

import { computeAnalysisAffectingGraphHash } from '../../src/orchestrator-v5/context/graph-hash.js';
import { computeGraphIdentityHash } from '../../src/orchestrator-v5/context/graph-identity.js';

// ============================================================================
// Section 1 — dark-flag / kill-switch default pins
// ============================================================================

/**
 * Every entry pins THREE things, verified against src/config/index.ts:
 *   - the parsed default from a clean env (`expectedDefault`),
 *   - the env var documented to control it (`envVar`),
 *   - the config key it lands on (`path`).
 *
 * `expectedDefault: false` entries are dark lanes: code is merged but must
 * not activate without an explicit env flip (and, for the V6 lane, its own
 * gated activation protocol). `expectedDefault: true` entries are
 * kill-switches: current product behaviour depends on them staying ON by
 * default; flipping one silently reverts a shipped fix.
 */
interface FlagPin {
  readonly envVar: string;
  readonly path: readonly [string, string];
  readonly expectedDefault: boolean;
  readonly why: string;
}

const FLAG_PINS: readonly FlagPin[] = [
  // --- dark lanes (documented default OFF) ---
  {
    envVar: 'CEE_V6_DUAL_DRAFT_ENABLED',
    path: ['features', 'v6DualDraftEnabled'],
    expectedDefault: false,
    why: 'V6 dual-model draft merged inert (PR #326); activation is a gated, approval-required protocol',
  },
  {
    envVar: 'CEE_POST_ANALYSIS_LOOP_ENABLED',
    path: ['cee', 'postAnalysisLoopEnabled'],
    expectedDefault: false,
    why: 'V5 post-analysis conversational loop is flag-gated dark',
  },
  {
    envVar: 'CEE_CONTEXT_SUMMARY_ENABLED',
    path: ['cee', 'contextSummaryEnabled'],
    expectedDefault: false,
    why: 'canonical _context_summary is diagnostics/harness-only; never read by UI/prose/chip logic',
  },
  {
    envVar: 'CEE_COACHING_STATE_PACK_ENABLED',
    path: ['cee', 'coachingStatePackEnabled'],
    expectedDefault: false,
    why: 'coaching-state pack is diagnostic-only; reserved seam for a separately-approved activation',
  },
  {
    envVar: 'CEE_COACHING_CONTEXT_PROMPT_ENABLED',
    path: ['cee', 'coachingContextPromptEnabled'],
    expectedDefault: false,
    why: 'Coaching Context Pack v1 (#299) is an env-set canary, not a default: flag-off must stay byte-identical',
  },
  // --- kill-switches (documented default ON) ---
  {
    envVar: 'CEE_PENDING_CONFIRMATION_TRUTH_ENABLED',
    path: ['cee', 'pendingConfirmationTruthEnabled'],
    expectedDefault: true,
    why: 'Track 2 (#340): pending-confirmation truth threads real state into pack + frame; OFF reverts to constant-false',
  },
  {
    envVar: 'CEE_OPTION_IDENTITY_FRESHNESS_GUARD',
    path: ['cee', 'optionIdentityFreshnessGuard'],
    expectedDefault: true,
    why: 'PR1 (#307): downgrade-only option-identity staleness guard is the shipped default',
  },
  {
    envVar: 'CEE_RUN_ANALYSIS_NULL_GRAPH_RECOVERABLE',
    path: ['cee', 'runAnalysisNullGraphRecoverable'],
    expectedDefault: true,
    why: '#302: graphless run_analysis returns typed analysis_not_ready 200 instead of a raw 500',
  },
];

/**
 * Minimal clean environment: enough for ConfigSchema to parse, with NONE of
 * the pinned flag env vars present, so `.default(...)` is what decides each
 * value. Mirrors tests/unit/config.test.ts ("should load with minimal
 * environment variables").
 */
const CLEAN_ENV: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  LLM_PROVIDER: 'fixtures',
};

function readFlag(config: unknown, path: readonly [string, string]): unknown {
  const section = (config as Record<string, Record<string, unknown>>)[path[0]];
  return section?.[path[1]];
}

describe('layer-1 cross-track acceptance — dark-flag default pins', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Force a fresh config module instance so the Proxy cache cannot carry a
    // parse from another test file's environment.
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  it('parses every pinned flag to its documented default from a clean env', async () => {
    process.env = { ...CLEAN_ENV };
    const { config } = await import('../../src/config/index.js');

    for (const pin of FLAG_PINS) {
      expect(
        readFlag(config, pin.path),
        `${pin.envVar} (config.${pin.path.join('.')}) must default ${pin.expectedDefault ? 'ON' : 'OFF'} — ${pin.why}`,
      ).toBe(pin.expectedDefault);
    }
  });

  for (const pin of FLAG_PINS) {
    it(`${pin.envVar} still controls config.${pin.path.join('.')} (wiring pin)`, async () => {
      // Flip check: setting the documented env var to the opposite of the
      // default must flip the parsed value. Catches silent renames — a flag
      // moved to a new env var would leave this one orphaned (default still
      // "correct", operator control silently dead).
      process.env = { ...CLEAN_ENV, [pin.envVar]: String(!pin.expectedDefault) };
      const { config } = await import('../../src/config/index.js');

      expect(
        readFlag(config, pin.path),
        `setting ${pin.envVar}=${String(!pin.expectedDefault)} must flip config.${pin.path.join('.')}`,
      ).toBe(!pin.expectedDefault);
    });
  }
});

// ============================================================================
// Section 2 — boundary safeParse: the proposed-change egress gap
// ============================================================================

/**
 * Representative Track-2 propose-then-confirm turn egress. Mirrors what
 * src/orchestrator-v5/compose/proposed-change.ts materialises on the wire:
 * a `prop_<sha256-12hex>` chip whose `action_type` is one of the EXISTING
 * boundary ActionType literals (Option B: no `apply_proposed_change` wire
 * literal), alongside a plain text-prompt chip (no action_type). The
 * server-side PendingAction stays in CommitMetadata — never on this wire.
 *
 * Not covered elsewhere: the v5-turn fixtures in fixtures-schema.test.ts
 * carry only text-prompt chips, and cee-egress-wire-surface-pin.test.ts
 * pins ActionSchema's keys without runtime accept/reject checks.
 */
function proposedChangeTurnResponse(): Record<string, unknown> {
  return {
    response_version: 2,
    assistant_text:
      'I can set Engineering Capacity to 5 people. Want me to apply that change?',
    blocks: [
      {
        type: 'text',
        content:
          'This updates one factor value. The current analysis will be marked out of date until you re-run it.',
      },
    ],
    suggested_actions: [
      {
        id: 'prop_a1b2c3d4e5f6',
        label: 'Set capacity to 5 people',
        message: 'Yes, apply that change.',
        action_type: 'set_factor_value',
      },
      {
        id: 'chip_prompt_keep_current_value',
        label: 'Keep it as it is',
        message: 'No, keep the current value.',
      },
    ],
    insights: [],
    stage_indicator: 'analyse',
  };
}

describe('layer-1 cross-track acceptance — proposed-change egress boundary', () => {
  it('proposed-change turn egress passes OlumiResponseSchema.safeParse at runtime', () => {
    const result = OlumiResponseSchema.safeParse(proposedChangeTurnResponse());
    if (!result.success) {
      // Surface the Zod issues — a failure here is either schema-bump drift
      // or a new runtime refinement invisible to tsc.
      console.error(
        'OlumiResponseSchema rejected the proposed-change egress:',
        JSON.stringify(result.error.format(), null, 2),
      );
    }
    expect(result.success).toBe(true);
  });

  it('rejects chips carrying internal pending-action fields (strict ActionSchema)', () => {
    // Cross-track invariant for the Track-3 apply-wiring: the server-side
    // pending-action mechanics (proposal_ref, inline_patch, expiry) must not
    // ride the public chip. The strict schema failing here is the contract
    // that keeps them off the wire without a coordinated schema bump.
    for (const [key, value] of [
      ['proposal_ref', 'prop_a1b2c3d4e5f6'],
      ['inline_patch', {}],
      ['expires_at', '2026-07-05T00:00:00.000Z'],
    ] as const) {
      const payload = proposedChangeTurnResponse();
      const chips = payload.suggested_actions as Array<Record<string, unknown>>;
      chips[0] = { ...chips[0], [key]: value };
      expect(
        OlumiResponseSchema.safeParse(payload).success,
        `chip field '${key}' must be rejected by the strict egress schema`,
      ).toBe(false);
    }
  });

  it("rejects 'apply_proposed_change' as a wire action_type (Option B pin)", () => {
    // Proposals ride EXISTING ActionType literals; apply_proposed_change is
    // a server-side pending-action kind only. If a future schema bump adds
    // it to the wire enum, this pin fails and forces the cross-repo
    // (DGAI/CEE) coordination that change requires.
    const payload = proposedChangeTurnResponse();
    const chips = payload.suggested_actions as Array<Record<string, unknown>>;
    chips[0] = { ...chips[0], action_type: 'apply_proposed_change' };
    expect(OlumiResponseSchema.safeParse(payload).success).toBe(false);
  });
});

// ============================================================================
// Section 3 — Group A graph-identity invariants (unblocked by #343 merge)
// ============================================================================

/**
 * Group A (#343, merged to staging as 93d39f1bf) landed the CEE-local
 * graph-identity module (src/orchestrator-v5/context/graph-identity.ts) and
 * with it the two-hash doctrine every downstream lane builds on:
 *
 *   graphIdentityHash      — FULL-FIDELITY (labels, descriptions, provenance
 *                            all count); strict-CAS / restore / compare
 *                            identity for the #346 lane and Model Management.
 *   analysisAffectingHash  — lossy WHITELIST (cosmetic fields excluded);
 *                            freshness + pending-proposal staleness.
 *
 * The module's co-located unit tests (src/orchestrator-v5/context/__tests__/)
 * verify the implementation; THIS section is the cross-track tripwire — it
 * pins the invariants from the consumer side with its own fixtures, so a
 * rewrite of module + unit tests together still cannot silently change the
 * contract other tracks assume.
 */

/**
 * Shared fixture for the ordering / two-hash / envelope tests. Returns a fresh
 * object per call so tests can mutate without aliasing. May evolve with the
 * contract — the GOLDEN fixtures below are the frozen ones.
 */
function identityContractGraph() {
  return {
    nodes: [
      { id: 'n_goal', kind: 'outcome', label: 'Quarterly revenue' },
      {
        id: 'n_capacity',
        kind: 'factor',
        label: 'Engineering capacity',
        observed_state: { value: 4, baseline: 4 },
      },
      {
        id: 'n_price',
        kind: 'factor',
        label: 'Unit price',
        observed_state: { value: 9.99 },
      },
    ],
    edges: [
      { from: 'n_capacity', to: 'n_goal', strength: { mean: 0.6, std: 0.1 } },
      { from: 'n_price', to: 'n_goal', strength: { mean: -0.4, std: 0.2 } },
    ],
    goal_node_id: 'n_goal',
  };
}

describe('layer-1 cross-track acceptance — Group A graph identity (#343)', () => {
  it('graphIdentityHash is invariant to node/edge listing order (determinism)', () => {
    // Persistence and wire payloads carry arrays; array order is storage
    // accident, not identity. A reordered listing of the SAME graph must
    // produce the SAME identity envelope, or CAS would reject honest writes.
    const forward = computeGraphIdentityHash(identityContractGraph());

    const shuffled = identityContractGraph();
    shuffled.nodes.reverse();
    shuffled.edges.reverse();
    const reversed = computeGraphIdentityHash(shuffled);

    expect(forward).not.toBeNull();
    expect(reversed).toEqual(forward);
  });

  it('ordering is codepoint-stable: canonically-equivalent Unicode ids cannot leak insertion order', () => {
    // 'né' precomposed (U+00E9) vs decomposed ('e' + combining U+0301):
    // localeCompare treats the pair as EQUAL, so a locale-collation sort
    // would fall back to insertion order — the two listings below would hash
    // differently. The contract is codepoint (UTF-16 code unit) ordering,
    // which gives distinct strings a strict total order.
    const precomposed = { id: 'n\u00E9', kind: 'factor', label: 'precomposed id' };
    const decomposed = { id: 'ne\u0301', kind: 'factor', label: 'decomposed id' };

    const a = computeGraphIdentityHash({ nodes: [precomposed, decomposed], edges: [] });
    const b = computeGraphIdentityHash({ nodes: [decomposed, precomposed], edges: [] });

    expect(a).not.toBeNull();
    expect(b?.value).toBe(a?.value);
  });

  it('two-hash contract: a label-only edit moves graphIdentityHash but NOT analysisAffectingHash', () => {
    // This pair IS the cosmetic-vs-substantive split other tracks assume:
    // renaming a factor must not mark an analysis stale (freshness reads the
    // analysis hash), but it must register as a different persisted graph
    // (CAS/restore/compare read the identity hash). Full-fidelity identity
    // on one side, lossy whitelist on the other.
    const base = identityContractGraph();
    const relabelled = identityContractGraph();
    relabelled.nodes[1].label = 'Engineering capacity (people)';

    const baseIdentity = computeGraphIdentityHash(base);
    const relabelledIdentity = computeGraphIdentityHash(relabelled);
    expect(baseIdentity).not.toBeNull();
    expect(relabelledIdentity?.value).not.toBe(baseIdentity?.value);

    expect(computeAnalysisAffectingGraphHash(relabelled)).toBe(
      computeAnalysisAffectingGraphHash(base),
    );

    // Guard the split from degenerating: a SUBSTANTIVE edit (observed value)
    // must move BOTH hashes — proves the analysis hash above was unchanged
    // because labels are excluded, not because it is insensitive.
    const revalued = identityContractGraph();
    (revalued.nodes[1] as { observed_state?: unknown }).observed_state = {
      value: 5,
      baseline: 4,
    };
    expect(computeGraphIdentityHash(revalued)?.value).not.toBe(baseIdentity?.value);
    expect(computeAnalysisAffectingGraphHash(revalued)).not.toBe(
      computeAnalysisAffectingGraphHash(base),
    );
  });

  it('analysisAffectingHash golden pins hold (silent projection-drift tripwire)', () => {
    // Exact values computed ONCE at #343-merge time (staging 93d39f1bf) and
    // hard-coded. Rationale: persisted freshness verdicts and pending-proposal
    // staleness checks compare TODAY's hash against hashes computed EARLIER —
    // any projection change (including a refactor that "should" be neutral,
    // e.g. identity-hash adoption) that moves these values invalidates every
    // stored hash. A legitimate projection change must update these pins
    // consciously, with a migration story for persisted hashes.
    // The fixtures are FROZEN — do not edit them; add new ones instead.
    const goldenMinimal = {
      nodes: [
        { id: 'g_out', kind: 'outcome', label: 'Churn', goal_threshold: 0.05 },
        {
          id: 'g_price',
          kind: 'factor',
          label: 'Price',
          factor_type: 'controlled',
          // `unit` is whitelist-EXCLUDED: exercises the projection boundary.
          observed_state: { value: 9.99, baseline: 9.99, unit: 'GBP' },
        },
      ],
      edges: [
        {
          from: 'g_price',
          to: 'g_out',
          strength: { mean: -0.4, std: 0.2 },
          effect_direction: 'negative',
        },
      ],
      goal_node_id: 'g_out',
    };
    const goldenWithOptions = {
      nodes: [
        { id: 'g_out', kind: 'outcome', label: 'Churn' },
        { id: 'g_price', kind: 'factor', label: 'Price', observed_state: { value: 9.99 } },
      ],
      edges: [{ from: 'g_price', to: 'g_out', strength: { mean: -0.4, std: 0.2 } }],
      options: [
        {
          id: 'opt_discount',
          status: 'ready',
          interventions: { g_price: { value: 7.99, value_type: 'absolute' } },
        },
      ],
      goal_node_id: 'g_out',
    };

    expect(computeAnalysisAffectingGraphHash(goldenMinimal)).toBe('54bcc0a294fb8244');
    expect(computeAnalysisAffectingGraphHash(goldenWithOptions)).toBe('db5982dd53456a54');
  });

  it('graphIdentityHash returns the versioned envelope with pinned literals', () => {
    // These literals are the §9.2 versioning contract: consumers that persist
    // identity hashes key migration decisions off them. Renaming or bumping
    // one without a coordinated migration is silent drift — hence literal
    // pins, not introspection of the module's exported constants.
    const envelope = computeGraphIdentityHash(identityContractGraph());
    expect(envelope).not.toBeNull();
    expect(envelope).toMatchObject({
      kind: 'graph_identity_hash',
      algorithm: 'sha256',
      projection_version: 'identity.v1',
      graph_schema_version: 'graph_v3',
      normaliser_version: '1',
    });
    expect(envelope?.value).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ============================================================================
// Section 4 — deferred-slice todo inventory (each names its unblocker)
// ============================================================================

describe('deferred slice: Group A write-time CAS (blocked on: #346 merge)', () => {
  // CEE_V5_GRAPH_CAS_MODE is NOT in src/config on the current staging tip —
  // the write-time CAS mode flag and its enforcement live in unmerged #346.
  it.todo(
    'CAS observe-mode: a stale write is DETECTED and reported without being rejected while enforcement is observe-only [unblocked by: #346 merge — CEE_V5_GRAPH_CAS_MODE not yet in src/config]',
  );
  it.todo(
    'CAS off-mode parity: with the CAS flag OFF, persistence behaviour is byte-identical to pre-CAS staging [unblocked by: #346 merge — CEE_V5_GRAPH_CAS_MODE not yet in src/config]',
  );
  it.todo(
    'stale-write telemetry: observed/rejected writes emit the agreed telemetry event carrying the expected/actual hash pair [unblocked by: #346 merge — telemetry ships with the write-time CAS lane]',
  );
  it.todo(
    'conflict-category acceptance: each write-conflict category maps to its typed recoverable response, not a raw 500 [unblocked by: #346 merge — conflict mapping ships with the write-time CAS lane]',
  );
});

describe('deferred slice: Model Management snapshot/restore/compare (blocked on: L2 model-management lane + migration approval)', () => {
  it.todo(
    'snapshot: capturing a named model snapshot preserves graph identity + analysis linkage [blocked on: L2 model-management lane + migration approval]',
  );
  it.todo(
    'restore: restoring a snapshot re-derives freshness against the restored graph, never inherits the pre-restore verdict [blocked on: L2 model-management lane + migration approval]',
  );
  it.todo(
    'compare: comparing two snapshots uses persisted-first identity, never request-supplied IDs [blocked on: L2 model-management lane + migration approval]',
  );
});

describe('deferred slice: apply/reject proposal contract (blocked on: apply contract + CAS interface)', () => {
  it.todo(
    'apply: confirming a PROPOSED structural edit routes to the apply path, not a fresh edit_graph that no-ops [blocked on: Track 3 apply-wiring + apply contract]',
  );
  it.todo(
    'apply CAS: applying against a graph mutated since proposal time fails closed with a typed conflict [blocked on: CAS interface]',
  );
  it.todo(
    'reject: declining a proposal expires the pending action and leaves the graph byte-identical [blocked on: apply/reject contract]',
  );
  it.todo(
    'expiry: a pending proposal past its turn/wall TTL is not applicable and its chip resolves to a safe no-op response [blocked on: apply/reject contract]',
  );
});
