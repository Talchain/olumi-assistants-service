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
 *   3. Deferred slices land without their acceptance tests. Section 3 is
 *      the todo inventory: each `it.todo` names the decision or branch
 *      that unblocks it, so the follow-up slice has a checklist and
 *      reviewers can see what is deliberately NOT asserted yet.
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
// Section 3 — deferred-slice todo inventory (each names its unblocker)
// ============================================================================

describe('deferred slice: Group A canonical state / graph identity (unblocks: Group A A3 branch — graphIdentityHash + normalisation, draft PR #343)', () => {
  it.todo(
    'graph-identity invariant: graphIdentityHash is stable under node/edge reordering and cosmetic-field permutations [unblocked by: A3 canonical-normalisation merge]',
  );
  it.todo(
    'graph-identity invariant: analysisAffectingHash golden pins remain unchanged by identity-hash adoption [unblocked by: A3 canonical-normalisation merge]',
  );
  it.todo(
    'CAS observe-mode: a stale write is DETECTED and reported without being rejected while enforcement is observe-only [unblocked by: A3/A4 write-time CAS interface]',
  );
  it.todo(
    'CAS off-mode parity: with the CAS flag OFF, persistence behaviour is byte-identical to pre-CAS staging [unblocked by: A3/A4 write-time CAS interface]',
  );
  it.todo(
    'stale-write telemetry: observed/rejected writes emit the agreed telemetry event carrying the expected/actual hash pair [unblocked by: A3/A4 telemetry contract]',
  );
  it.todo(
    'conflict-category acceptance: each write-conflict category maps to its typed recoverable response, not a raw 500 [unblocked by: stacked slice on the A3 branch]',
  );
});

describe('deferred slice: Model Management snapshot/restore/compare (blocked on: substrate decision)', () => {
  it.todo(
    'snapshot: capturing a named model snapshot preserves graph identity + analysis linkage [blocked on: Model Management substrate decision]',
  );
  it.todo(
    'restore: restoring a snapshot re-derives freshness against the restored graph, never inherits the pre-restore verdict [blocked on: Model Management substrate decision]',
  );
  it.todo(
    'compare: comparing two snapshots uses persisted-first identity, never request-supplied IDs [blocked on: Model Management substrate decision]',
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
