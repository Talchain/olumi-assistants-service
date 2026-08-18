/**
 * A REFUSAL MAY WITHDRAW A VERDICT. IT MAY NOT DENY THE USER'S MODEL EXISTS.
 *
 * THE MEASURED DEFECT (staging, 18 Aug 2026 — build 1f5eb2b, and reproduced at
 * 10d0aba5 the same night).
 *
 * The core two-turn journey failed on 4 of 13 runs. Turn 1 drafted a healthy
 * model — 14-15 nodes, `goal:1`, `option:4`, `analysis_ready.goal_node_id =
 * "378f195a"`, four options. Turn 2 ("Use your best guess for the rest and
 * draft the model now.") came back with:
 *
 *     status="blocked" goal_node_id="" options=[] blocked_reason="MISSING_OPTION_VALUE"
 *     readiness_issues=absent bias_findings=absent
 *     freshness="unknown"/"no_successful_run_analysis_fact"
 *     graph_hash="cfded3af0aa14ebd"   ← IDENTICAL to turn 1's
 *
 * Every field of that is a fingerprint, and together they name one producer:
 *
 *   · exactly four keys, `options`/`goal_node_id`/`status`/`blocked_reason`,
 *     with NO `readiness_issues` and NO `bias_findings` — that is
 *     `buildAnalysisRefusalReadiness` and nothing else. The
 *     `assessCanonicalAnalysisReadiness` fallback (analysis-ready-helper.ts:1122)
 *     ALWAYS sets `readiness_issues`; the freshness-only carrier
 *     (compose/analysis-ready-emit.ts:59) ALWAYS sets `bias_findings`; the
 *     `SCHEMA_INVALID` exit (:976) emits no block at all.
 *   · `freshness: 'unknown'` carrying reason `no_successful_run_analysis_fact`
 *     is producible ONLY by `clampRefusalFreshness`. The raw derivation's
 *     no-fact branch emits `'none'` with that reason (context/freshness.ts:677),
 *     and `enforceInvariants` cannot coerce it — both coercions require
 *     `graph_hash_at_run !== null`, which the no-fact branch sets to `null`.
 *   · the graph_hash is IDENTICAL on both turns, so the read returned the model
 *     that was committed. Nothing was lost, stale or foreign.
 *
 * So the turn ROUTED TO THE ANALYSE HANDLER, the handler correctly refused
 * (the fresh draft has options with no effect values — the PASSING runs report
 * exactly that, nine `MISSING_OPTION_VALUE` issues), and the refusal payload
 * then REPLACED the turn's structural readiness with an empty carrier.
 *
 * TWO CORRECT PIECES, ONE HARM — CLAUDE.md trap 21. The refusal exists so a
 * declined run cannot ship `status: 'ready'`; that is right. The empty carrier
 * exists because an adversarial review MEASURED that carrying real options
 * flips the deployed `DecisionOverviewCard` from `unassessed` to `needs_input`
 * and auto-expands "Olumi needs a little more from you"; that is also right —
 * FOR THE CASE IT WAS MEASURED ON, where the model was complete and only a
 * scale gate refused, so "needs input" was FALSE.
 *
 * On a fresh turn 2 the model is genuinely incomplete and the UI holds nothing
 * yet. There the empty carrier preserves no user state — it IS the user's only
 * readiness payload, and it asserts a goal-less, option-less model while the
 * authoritative persisted state (same hash, same bytes) holds a goal and four
 * options. That is P5: a product claim about the user's model contradicted by
 * the canonical read it was projected from.
 *
 * THE RULE THIS PINS, and it is P3's mirror: a producer may replace a
 * consumer's payload only with something AT LEAST AS TRUE. The discriminator is
 * the structural projection's own status —
 *
 *   · structural says NOT ready → "the model needs input" is TRUE, so
 *     preserving its identity is strictly more truthful than denying it, and
 *     the measured UI harm cannot occur (the card is describing a real gap).
 *   · structural says `ready`   → "needs input" would be FALSE, so the empty
 *     carrier stays, exactly as the review required.
 *
 * Both directions are pinned below. Neither is bought with the other.
 */
import { describe, it, expect } from 'vitest';

import {
  buildAnalysisRefusalReadiness,
  ANALYSIS_READY_BLOCKED_STATUS,
} from '../analysis-ready-helper.js';
import type { AnalysisReadyPayload } from '../analysis-ready-helper.js';

/**
 * The structural projection a fresh turn 2 actually holds, taken from the
 * PASSING staging runs of the same journey on the same build (run
 * 32094522827): a real goal id and four identifiable options, status
 * `needs_user_input`. Not invented — this is what the product emits on the
 * runs that work, so a fix validated against it is validated against the
 * payload the defect destroys.
 */
const STRUCTURAL_NOT_READY: AnalysisReadyPayload = {
  status: 'needs_user_input',
  goal_node_id: '378f195a',
  options: [
    { option_id: 'opt_a', label: 'Open in Leeds city centre', status: 'needs_user_mapping' },
    { option_id: 'opt_b', label: 'Open in a Leeds suburb', status: 'needs_user_mapping' },
    { option_id: 'opt_c', label: 'Delay to Q3', status: 'needs_user_mapping' },
    { option_id: 'opt_d', label: 'Do not expand', status: 'needs_user_mapping' },
  ],
} as unknown as AnalysisReadyPayload;

/** The reviewers' case: the model IS complete and only the scale gate refused. */
const STRUCTURAL_READY: AnalysisReadyPayload = {
  ...STRUCTURAL_NOT_READY,
  status: 'ready',
} as unknown as AnalysisReadyPayload;

describe('analyse refusal — the model keeps its identity when the refusal is not about identity', () => {
  it('PRESERVES goal_node_id and the option identities when the structural projection is NOT ready', () => {
    const out = buildAnalysisRefusalReadiness('MISSING_OPTION_VALUE', STRUCTURAL_NOT_READY);
    // Bound by IDENTITY, never by a count: `options.length === 4` is satisfied
    // by any four objects, and "a different set of four options" is the exact
    // fabrication class the journey gate's continuity check exists to catch.
    expect(out.goal_node_id).toBe('378f195a');
    expect(out.options.map((o) => (o as { option_id: string }).option_id)).toEqual([
      'opt_a',
      'opt_b',
      'opt_c',
      'opt_d',
    ]);
  });

  it('still WITHDRAWS the verdict — the refusal is not silently downgraded to a pass', () => {
    // The whole point of the refusal carrier. Preserving identity must not cost
    // the `blocked` status or the specific reason; if it did, this fix would
    // re-open the defect the carrier was introduced for (a declined run
    // shipping `status: 'ready'`).
    const out = buildAnalysisRefusalReadiness('MISSING_OPTION_VALUE', STRUCTURAL_NOT_READY);
    expect(out.status).toBe(ANALYSIS_READY_BLOCKED_STATUS);
    expect(out.blocked_reason).toBe('MISSING_OPTION_VALUE');
    expect(out.status).not.toBe(STRUCTURAL_NOT_READY.status);
  });

  it('OPPOSITE-DIRECTION TWIN: a `ready` structural projection still gets the EMPTY carrier', () => {
    // The reviewers' measured case. If the model is complete, "needs input" is
    // false, and carrying the options would ship the false UI surface their
    // review found. This must not be traded away for the fix above.
    const out = buildAnalysisRefusalReadiness('scale_postcondition_violated', STRUCTURAL_READY);
    expect(out.goal_node_id).toBe('');
    expect(out.options).toEqual([]);
    expect(out.status).toBe(ANALYSIS_READY_BLOCKED_STATUS);
    expect(out.blocked_reason).toBe('scale_postcondition_violated');
  });

  it('OPPOSITE-DIRECTION TWIN: no structural projection at all still gets the EMPTY carrier', () => {
    // Unparseable / absent persisted graph. There is nothing truthful to
    // preserve, so inventing a goal or options here would be the fabrication
    // this whole family of rules exists to prevent. The one-argument call is
    // byte-identical to the pre-fix behaviour, so every existing caller that
    // has no structural payload is unchanged.
    const out = buildAnalysisRefusalReadiness('mixed_scale_unresolved');
    expect(out).toEqual({
      options: [],
      goal_node_id: '',
      status: 'blocked',
      blocked_reason: 'mixed_scale_unresolved',
    });
    expect(buildAnalysisRefusalReadiness('mixed_scale_unresolved', undefined)).toEqual(out);
  });

  it('writes NO science content — identity is carried, findings are not (ROADMAP 2.1134(a))', () => {
    // The carrier's founding property. `options` and `goal_node_id` are the
    // model's IDENTITY and come from the canonical readiness authority; blockers,
    // bias findings, model adjustments and repair proposals are OUTPUT this turn
    // did not produce, and smuggling them onto a refusal would make the refusal
    // claim work it declined to do.
    const noisy = {
      ...STRUCTURAL_NOT_READY,
      blockers: [{ kind: 'missing_value' }],
      bias_findings: [{ id: 'DSK-B-003' }],
      model_adjustments: [{ id: 'adj_1' }],
      readiness_issues: [{ code: 'MISSING_OPTION_VALUE' }],
      repair_proposal: { proposal_version: 'readiness_repair_v1' },
    } as unknown as AnalysisReadyPayload;
    const out = buildAnalysisRefusalReadiness('MISSING_OPTION_VALUE', noisy);
    expect(Object.keys(out).sort()).toEqual(
      ['blocked_reason', 'goal_node_id', 'options', 'status'].sort(),
    );
  });

  it('a structurally-not-ready projection with NO usable identity gets the EMPTY carrier', () => {
    // Guards the fix against carrying an emptier thing than the empty carrier:
    // an `options: []` or `goal_node_id: ''` structural payload is not more
    // truthful than the default, so there is nothing to prefer. Without this,
    // "preserve when not ready" would fire on payloads that preserve nothing
    // and the branch would report success on a no-op.
    for (const degenerate of [
      { status: 'blocked', goal_node_id: '', options: [] },
      { status: 'blocked', goal_node_id: 'g1', options: [] },
      { status: 'needs_user_input', goal_node_id: '', options: [{ option_id: 'o1' }] },
    ] as unknown as AnalysisReadyPayload[]) {
      const out = buildAnalysisRefusalReadiness('MISSING_OPTION_VALUE', degenerate);
      expect(out.goal_node_id, JSON.stringify(degenerate)).toBe('');
      expect(out.options, JSON.stringify(degenerate)).toEqual([]);
    }
  });

  it('does not MUTATE the structural payload it was handed', () => {
    // The caller (`turn-executor.ts:9355`) passes the very variable it is about
    // to overwrite, and the same object is read by the chip generator and the
    // canonical-state selector on the way out.
    const before = JSON.stringify(STRUCTURAL_NOT_READY);
    buildAnalysisRefusalReadiness('MISSING_OPTION_VALUE', STRUCTURAL_NOT_READY);
    expect(JSON.stringify(STRUCTURAL_NOT_READY)).toBe(before);
  });
});
