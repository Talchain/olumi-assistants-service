/**
 * Proposal-staleness hash doctrine — regression pin at the RESUME GATE.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `Docs/v5/group-a-canonical-state-foundation.md:70` ratifies (PR #343):
 *
 *   "Pending-action stale-gate — Unchanged. Still owned by
 *    `analysisAffectingHash` … `graphIdentityHash` is **not** used for
 *    proposal/pending staleness."
 *
 * `cosmetic-edit-pending-gate.test.ts` already pins that doctrine at the
 * COMMIT-time gate (`computeSurvivingPriorPendings`). It does NOT cover the
 * pre-LLM RESUME gate — `resolveProposalResume`, whose live call sites are
 * `edit-graph-dispatch.ts:1542` (proposal-continuation intercept) and `:1844`
 * (recovery gate). That gap is load-bearing: a reviewer reading the analysis
 * hash's node whitelist (`graph-hash.ts:214-223`) sees `label` absent,
 * concludes "a rename slips past the staleness gate", and swaps the call site
 * to `computeGraphIdentityHash`. Nothing in the suite goes red today.
 *
 * That swap is wrong in three independent ways, each pinned below:
 *
 *  1. It is a DOCTRINE REVERSAL, not a bug fix. A cosmetic edit must not
 *     silently discard a valid pending proposal — the proposal applies by
 *     `target_entity_ids` (node ids), which a rename does not move.
 *  2. It does not fail closed; it fails CATASTROPHIC. Every writer stamps
 *     `preconditions.graph_hash` with the 16-hex analysis hash
 *     (`derive-pending-actions.ts:154`, `proposal-continuation.ts:1163`,
 *     `edit-graph-dispatch.ts:1484`, `hold-thread-through.ts:327`). The
 *     identity hash is 64-hex. Swapping the READER alone compares 64-hex
 *     against stored 16-hex — never equal — so EVERY proposal resume is
 *     rejected `graph_hash_changed`, on an UNCHANGED graph.
 *  3. It over-fires on layout. Canvas position/layout is deliberately INSIDE
 *     the identity projection (`graph-identity.ts:93-97`, contract §10
 *     "display identity"), so even a writer-side migration would invalidate a
 *     pending proposal on every node drag.
 *
 * Each `it` below is written so that re-homing this gate onto the identity
 * hash turns it RED with a message naming the reason.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  buildProposalPendingAction,
  resolveProposalResume,
} from '../coaching/proposal-continuation.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import { computeGraphIdentityHash } from '../context/graph-identity.js';

import type { GraphStateIngress } from '../boundary/request-extensions.js';
import type { PendingAction } from '../session/pending-action.js';

const SCENARIO = 'sc-staleness-doctrine';
const CONCEPT = 'team morale or cultural fit';
const EMITTED_AT = '2026-05-28T09:55:00.000Z';
const NOW_MS = Date.parse('2026-05-28T10:00:00.001Z');

// Single `unknown`-typed cast (not a double cast, which the boundary-pattern
// ratchet counts) — the fixture is a loose wire-shaped graph.
function ingress(graph: unknown): GraphStateIngress {
  return graph as GraphStateIngress;
}

const factor = (
  id: string,
  value: number,
  label: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> => ({
  id,
  kind: 'factor',
  label,
  category: 'controllable',
  observed_state: { value, baseline: value, unit: 'GBP', source: 'brief_extraction' },
  ...extra,
});

function buildGraph(nodes: unknown[]): GraphStateIngress {
  return ingress({ nodes, edges: [] });
}

/**
 * A pending proposal whose precondition carries the hash the live writers
 * actually stamp: the analysis-affecting hash of the graph at emit time.
 */
function pendingAgainst(graph: GraphStateIngress): PendingAction {
  return buildProposalPendingAction({
    concept: CONCEPT,
    preferred_kind: 'factor',
    scenario_id: SCENARIO,
    emitted_at_iso: EMITTED_AT,
    graph_hash: computeAnalysisAffectingGraphHash(graph) ?? undefined,
  });
}

/** Run the real resume gate the way `edit-graph-dispatch.ts:1542` runs it. */
function resumeAgainst(pending: PendingAction, currentGraph: GraphStateIngress) {
  return resolveProposalResume({
    message: "That's a good idea.",
    pendingActions: [pending],
    nodes: null,
    currentGraphHash: computeAnalysisAffectingGraphHash(currentGraph),
    nowMs: NOW_MS,
  });
}

const BASE = buildGraph([factor('budget', 100, 'Budget')]);

describe('proposal staleness is owned by the analysis hash, not graph identity (#343 doctrine)', () => {
  it('DOCTRINE: a label-only rename does NOT stale a pending proposal', () => {
    // Goes RED if this gate is re-homed onto computeGraphIdentityHash:
    // the identity projection is full-fidelity and DOES cover `label`.
    const pending = pendingAgainst(BASE);
    const renamed = buildGraph([factor('budget', 100, 'Total Budget')]);

    const outcome = resumeAgainst(pending, renamed);

    expect(
      outcome.rejection,
      'a rename must not discard a valid proposal — it applies by node id, '
        + 'which a rename does not move (Docs/v5/group-a-canonical-state-foundation.md:70)',
    ).not.toBe('graph_hash_changed');
  });

  it('POSITIVE CONTROL: a value edit DOES stale the proposal', () => {
    // Rule 13 — an absence assertion is vacuous unless the same harness can
    // observe a presence. This proves the gate discriminates at all.
    const pending = pendingAgainst(BASE);
    const revalued = buildGraph([factor('budget', 200, 'Budget')]);

    expect(resumeAgainst(pending, revalued).rejection).toBe('graph_hash_changed');
  });

  it('POSITIVE CONTROL: a structural edit DOES stale the proposal', () => {
    const pending = pendingAgainst(BASE);
    const grown = buildGraph([factor('budget', 100, 'Budget'), factor('risk', 5, 'Risk')]);

    expect(resumeAgainst(pending, grown).rejection).toBe('graph_hash_changed');
  });

  it('OVER-FIRING GUARD: moving a node on the canvas does NOT stale the proposal', () => {
    // Layout is inside the IDENTITY projection by contract §10 but outside the
    // analysis whitelist. Re-homing this gate would invalidate a live proposal
    // on every 1px drag.
    const pending = pendingAgainst(BASE);
    const dragged = buildGraph([
      factor('budget', 100, 'Budget', { position: { x: 11, y: 20 } }),
    ]);

    expect(
      resumeAgainst(pending, dragged).rejection,
      'canvas layout is display identity, not analysis state — dragging a node '
        + 'must never discard a pending proposal',
    ).not.toBe('graph_hash_changed');
  });

  it('the two hashes are structurally non-interchangeable at this gate', () => {
    // Makes the "one-line swap" trap fail loud rather than silently rejecting
    // every resume: the persisted precondition is 16-hex, identity is 64-hex.
    const analysis = computeAnalysisAffectingGraphHash(BASE)!;
    const identity = computeGraphIdentityHash(BASE)!.value;

    expect(analysis).toMatch(/^[0-9a-f]{16}$/);
    expect(identity).toMatch(/^[0-9a-f]{64}$/);
    expect(identity).not.toBe(analysis);

    // Swapping only the reader rejects an UNCHANGED graph.
    const pending = pendingAgainst(BASE);
    const swapped = resolveProposalResume({
      message: "That's a good idea.",
      pendingActions: [pending],
      nodes: null,
      currentGraphHash: identity,
      nowMs: NOW_MS,
    });
    expect(
      swapped.rejection,
      'a reader-only swap to the identity hash rejects every proposal on an '
        + 'unchanged graph — writers stamp the analysis hash',
    ).toBe('graph_hash_changed');
  });
});

/**
 * Static call-site guard. The behavioural pins above exercise
 * `resolveProposalResume` directly, so they do NOT bite if someone edits the
 * DISPATCH call site instead. This block does — it is the pin that turns RED
 * on the literal recommended change ("swap `edit-graph-dispatch.ts:1542` to
 * `computeGraphIdentityHash`").
 *
 * Mirrors the repo's source-scan guard idiom
 * (`context/__tests__/graph-identity-guards.test.ts`).
 */
describe('the edit-graph dispatch resume gate is fed by the ANALYSIS hash', () => {
  const DISPATCH = fileURLToPath(
    new URL('../handlers/edit-graph-dispatch.ts', import.meta.url),
  );
  // `readFileSync` (not grep): one file in this tree carries a literal NUL and
  // plain grep silently skips such files, which would make this guard pass by
  // reading nothing.
  const source = readFileSync(DISPATCH, 'utf8');

  it('does not import the identity hash into the dispatch module', () => {
    const importLines = source
      .split('\n')
      .filter((l) => /^\s*import\b/.test(l) || /\bfrom\s+['"]/.test(l));
    const offenders = importLines.filter(
      (l) => /computeGraphIdentityHash/.test(l) || /graph-identity(\.js)?['"]/.test(l),
    );
    expect(
      offenders,
      'proposal staleness must stay owned by the analysis-affecting hash — '
        + 'see Docs/v5/group-a-canonical-state-foundation.md:70 and the '
        + 'over-firing/blast-radius pins above before changing this',
    ).toEqual([]);
  });

  it('every currentGraphHash fed to resolveProposalResume derives from the analysis hash', () => {
    // Derive rather than mirror: find each `resolveProposalResume({...})` call,
    // read the identifier it passes as `currentGraphHash`, and require that
    // identifier to be assigned from `computeAnalysisAffectingGraphHash`.
    const callArgs = [...source.matchAll(/resolveProposalResume\(\{([\s\S]*?)\}\)/g)];
    expect(callArgs.length).toBeGreaterThan(0); // positive control: we found the call sites

    for (const [, args] of callArgs) {
      const m = /currentGraphHash\s*(?::\s*([A-Za-z0-9_]+))?\s*,/.exec(args);
      expect(m, `could not read currentGraphHash from:\n${args}`).not.toBeNull();
      const identifier = m![1] ?? 'currentGraphHash'; // shorthand property
      const assignment = new RegExp(
        `${identifier}\\s*=\\s*computeAnalysisAffectingGraphHash\\(`,
      );
      expect(
        assignment.test(source),
        `\`${identifier}\` is passed to the proposal resume gate but is not `
          + 'assigned from computeAnalysisAffectingGraphHash. Proposal staleness '
          + 'is analysis-affecting by doctrine (#343); the identity hash is '
          + '64-hex while every writer stamps the 16-hex analysis hash, so '
          + 'swapping it rejects EVERY resume on an unchanged graph.',
      ).toBe(true);
    }
  });
});
