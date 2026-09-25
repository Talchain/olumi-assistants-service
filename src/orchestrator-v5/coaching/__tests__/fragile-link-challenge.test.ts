/**
 * THE RUN-TURN FRAGILE-LINK CHALLENGE — DSK-P-003 (consider the opposite) as
 * ONE typed, run-bound coaching block with ONE safe action.
 *
 * Every input here is a served agent-lane wire response (c19, CEE `8428207`),
 * trimmed; see `fragile-link-challenge-fixtures.ts` for how the capture is
 * reconstructed. Tests are named for the contract's letters (i)–(ix); (viii) is
 * in `fragile-link-challenge.reload.test.ts` because it mocks the session store.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AnalysisRunStateSchema, CoachingBlockSchema, type CoachingBlock } from '@talchain/schemas/boundary';

import { runTurnCoaching } from '../../agent-lane/analysis-coaching-pass-through.js';
import { AMEND_CHIP, approvalChipsFor, typedApprovalOf } from '../../agent-lane/approval-chips.js';
import { REFUSAL_REASON_UNSPECIFIED } from '../../compose/analysis-state-v1.js';
import { deterministicBlockId } from '../../compose/block-id.js';
import { buildAutoRunProvenance } from '../../context/run-initiator.js';
import { RUN_OFFER_CHIP, typedRunOf } from '../../../routes/agent-v1-turn.js';
import {
  RUN_TURN_COACHING_CONTRACT,
  buildFragileLinkChallenge,
  composeFragileLinkChallenge,
  fragileLinkBodyForms,
} from '../fragile-link-challenge.js';
import { selectGroundedCounterCase } from '../grounded-counter-case.js';
import {
  PAYLOAD_FILE,
  buildFragileLinkChallengePayload,
  firstPassCase,
  fixtureUrl,
  runTurnCase,
  type RunTurnCase,
} from './fragile-link-challenge-fixtures.js';

const FIRST_PASS_PREFIX = 'Before relying on this first pass on Olumi\'s estimates, ';
const LEADER_WORDS = /option in front|winner|recommend|best option|leading option/i;
const USER_FACING = ['title', 'body', 'action_label', 'action_prompt'] as const;

function fragileLinkCards(blocks: readonly CoachingBlock[]): CoachingBlock[] {
  return blocks.filter((b) => b.signal_id.startsWith('coach:fragile_link:'));
}

/** The bundle's own record for DSK-P-003's linked claim — never typed here. */
function dskClaimFromBundle(): { claim_id: string; claim_title: string; evidence_strength: string; protocol_id: string } {
  const bundle = JSON.parse(readFileSync(new URL('../../../../data/dsk/v1.json', import.meta.url), 'utf8')) as {
    objects: { id: string; type: string; title: string; evidence_strength: string; linked_claim_id?: string }[];
  };
  const protocol = bundle.objects.find((o) => o.id === 'DSK-P-003' && o.type === 'protocol');
  const claim = bundle.objects.find((o) => o.id === protocol?.linked_claim_id && o.type === 'claim');
  if (protocol === undefined || claim === undefined) throw new Error('DSK-P-003 or its linked claim is missing from the bundle');
  return { claim_id: claim.id, claim_title: claim.title, evidence_strength: claim.evidence_strength, protocol_id: protocol.id };
}

function withResult(c: RunTurnCase, mutate: (result: Record<string, any>) => void): RunTurnCase {
  const captured = structuredClone(c.captured);
  const final = structuredClone(c.final);
  mutate(captured.blocks![0] as Record<string, any>);
  mutate(final.analysisResult as Record<string, any>);
  return { ...c, captured, final };
}

/**
 * Relabel the row the selector GROUNDS — found by its (from_id, to_id) after
 * `mutate`, not by array position — on both the capture and the readback.
 */
function withGroundedLabels(
  c: RunTurnCase,
  fromLabel: string,
  toLabel: string,
  mutate: (result: Record<string, any>) => void = () => {},
): RunTurnCase {
  return withResult(c, (r) => {
    mutate(r);
    const { fromId, toId } = selectGroundedCounterCase(r.enrichment).grounded!;
    const row = r.enrichment.robustness.fragile_edges.find((e: any) => e.from_id === fromId && e.to_id === toId);
    row.from_label = fromLabel;
    row.to_label = toLabel;
  });
}

function withComputedAt(c: RunTurnCase, computedAt: string): RunTurnCase {
  const captured = structuredClone(c.captured);
  const final = structuredClone(c.final);
  (captured.analysis_state as any).run_state.computed_at = computedAt;
  (final.analysisState as any).run_state.computed_at = computedAt;
  return { ...c, captured, final };
}

describe('run-turn fragile-link challenge', () => {
  it('(i) explicit Run on A (leader permitted) → exactly one card, schema-valid, bound to the run and its revision', () => {
    const c = runTurnCase('A', 't5', 'explicit_run');
    expect(c.turn.tools_called).toContain('run_analysis');
    const out = runTurnCoaching(c.captured, c.final);
    expect(out.eligibility).toEqual({ eligible: true });
    expect(out.blocks).toHaveLength(1);
    const cards = fragileLinkCards(out.blocks);
    expect(cards).toHaveLength(1);
    const card = cards[0]!;
    expect(CoachingBlockSchema.safeParse(card).success).toBe(true);
    expect(card.graph_hash_at_generation).toBe(c.turn.graph_hash);
    expect(card.graph_hash_at_generation).toBe(c.turn.analysis_result.computed_against_hash);
    expect(card.created_at).toBe(c.turn.analysis_state.run_state.computed_at);

    const grounded = selectGroundedCounterCase(c.turn.analysis_result.enrichment).grounded!;
    expect(grounded.edgeIdentity).toBe('developer_capacity→velocity');
    expect(card.signal_id).toBe(
      `coach:fragile_link:${grounded.edgeIdentity}:${c.turn.graph_hash}:${c.turn.analysis_state.run_state.computed_at}:explicit_run`,
    );
    expect(card.block_id).toBe(deterministicBlockId(card.signal_id));
    expect(card.target_refs).toEqual([{ id: grounded.edgeIdentity, kind: 'edge', label: 'Developer capacity → Velocity' }]);
    expect(card).toMatchObject({
      type: 'coaching',
      coaching_kind: RUN_TURN_COACHING_CONTRACT.block.coaching_kind,
      source: 'deterministic_signal',
      source_handler: 'run_analysis',
      freshness: 'fresh',
      title: 'Pressure-test a sensitive link',
      action_label: 'Pressure-test this link',
    });
    expect(card.coaching_kind).toBe('assumption_check');
    // A is "slightly ahead" (gap 0.32 but is_robust false, verdict 'fragile'): not the clear
    // winner DSK-P-003 requires, so the badge is withheld (see the DSK-P-003 badge block below).
    expect(Object.hasOwn(card, 'dsk_claim_provenance')).toBe(false);
    expect(card.body.length).toBeLessThanOrEqual(300);
    // A permitted leader does not license leader copy on this card.
    for (const field of USER_FACING) expect(String(card[field])).not.toMatch(LEADER_WORDS);
    for (const option of c.turn.analysis_ready.options) {
      for (const field of USER_FACING) expect(String(card[field]).toLowerCase()).not.toContain(option.label.toLowerCase());
    }
  });

  it('(ii) constrained Run on B (leader withheld) → the card, leader-free: no leader words, no option label, no number', () => {
    const c = runTurnCase('B', 't2', 'explicit_run');
    expect(c.turn.analysis_state.leader_claim).toMatchObject({ permitted: false });
    const out = runTurnCoaching(c.captured, c.final);
    expect(out.eligibility).toEqual({ eligible: true });
    const cards = fragileLinkCards(out.blocks);
    expect(cards).toHaveLength(1);
    const card = cards[0]!;
    expect(CoachingBlockSchema.safeParse(card).success).toBe(true);
    expect(card.target_refs).toEqual([{ id: 'pro_subscriber_base→mrr', kind: 'edge', label: 'Pro subscriber base → MRR' }]);
    expect(card.body).toBe(
      'The robustness check flagged the link from Pro subscriber base to MRR as sensitive — worth checking what the estimate of how strongly Pro subscriber base drives MRR rests on.',
    );
    expect(card.body.startsWith(FIRST_PASS_PREFIX)).toBe(false);

    const optionLabels = c.turn.analysis_ready.options.map((o) => o.label);
    expect(optionLabels.length).toBe(3);
    const alternativeWinnerLabels = c.turn.analysis_result.enrichment.robustness.fragile_edges
      .map((e) => e.alternative_winner_label)
      .filter((l): l is string => typeof l === 'string');
    expect(alternativeWinnerLabels.length).toBeGreaterThan(0);
    for (const field of USER_FACING) {
      const text = String(card[field]);
      expect(text).not.toMatch(LEADER_WORDS);
      expect(text).not.toMatch(/\d/);
      for (const label of [...optionLabels, ...alternativeWinnerLabels]) {
        expect(text.toLowerCase()).not.toContain(label.toLowerCase());
      }
    }
  });

  it('(iii) auto first pass on B → the card with the first-pass prefix (trigger, and run_provenance variant)', () => {
    const auto = runTurnCase('B', 't2', 'auto_first_pass');
    const out = runTurnCoaching(auto.captured, auto.final);
    expect(out.eligibility).toEqual({ eligible: true });
    const card = fragileLinkCards(out.blocks)[0]!;
    expect(CoachingBlockSchema.safeParse(card).success).toBe(true);
    expect(card.body).toBe(
      'Before relying on this first pass on Olumi\'s estimates, note that the robustness check flagged the link from Pro subscriber base to MRR as sensitive — worth checking what the estimate of how strongly Pro subscriber base drives MRR rests on.',
    );
    expect(card.body.length).toBeLessThanOrEqual(300);

    // The run's own provenance stamp marks it automatic even when the trigger says explicit.
    const stamped = withResult(runTurnCase('B', 't2', 'explicit_run'), (r) => {
      r.enrichment.run_provenance = buildAutoRunProvenance('11111111-1111-4111-8111-111111111111');
    });
    const viaProvenance = runTurnCoaching(stamped.captured, stamped.final);
    expect(viaProvenance.eligibility).toEqual({ eligible: true });
    expect(fragileLinkCards(viaProvenance.blocks)[0]!.body).toBe(card.body);

    // Contrast: the same explicit run without the stamp carries no prefix.
    const plain = runTurnCase('B', 't2', 'explicit_run');
    expect(fragileLinkCards(runTurnCoaching(plain.captured, plain.final).blocks)[0]!.body.startsWith(FIRST_PASS_PREFIX)).toBe(false);
  });

  it('(iii-b) first pass with served labels the long wording cannot fit → the card, its second clause saying "this link"', () => {
    // Served labels (construction witness c16-fd312b5, 23 Sep). With the
    // flag-naming wording, 17 of the 222 distinct served fragile-edge label
    // pairs still overflow the long first-pass form; this is one of them.
    const from = 'Engineering coordination quality';
    const to = 'Engineering delivery velocity';
    const [longFirstPass, shortFirstPass] = fragileLinkBodyForms(from, to, true);
    // The contract's long wording cannot ship here, so this exercises the fallback.
    expect(longFirstPass!.length).toBeGreaterThan(300);

    const auto = withGroundedLabels(runTurnCase('B', 't2', 'auto_first_pass'), from, to);
    const out = runTurnCoaching(auto.captured, auto.final);
    expect(out.eligibility).toEqual({ eligible: true });
    const card = fragileLinkCards(out.blocks)[0]!;
    expect(CoachingBlockSchema.safeParse(card).success).toBe(true);
    expect(card.body).toBe(
      'Before relying on this first pass on Olumi\'s estimates, note that the robustness check flagged the link from Engineering coordination quality to Engineering delivery velocity as sensitive — worth checking what this link\'s estimated strength rests on.',
    );
    expect(card.body).toBe(shortFirstPass);
    expect(card.body.length).toBeLessThanOrEqual(300);
    expect(card.target_refs).toEqual([{ id: card.target_refs[0]!.id, kind: 'edge', label: 'Engineering coordination quality → Engineering delivery velocity' }]);

    // Contrast: the explicit Run on the same labels keeps the contract's long wording.
    const explicit = withGroundedLabels(runTurnCase('B', 't2', 'explicit_run'), from, to);
    const explicitOut = runTurnCoaching(explicit.captured, explicit.final);
    expect(explicitOut.eligibility).toEqual({ eligible: true });
    expect(fragileLinkCards(explicitOut.blocks)[0]!.body).toBe(
      'The robustness check flagged the link from Engineering coordination quality to Engineering delivery velocity as sensitive — worth checking what the estimate of how strongly Engineering coordination quality drives Engineering delivery velocity rests on.',
    );

    // And the pair that USED to need the short form (pre-a693ba6-A) now fits the
    // long one on the first pass: the shorter wording names both ends twice there.
    const [nowFits] = fragileLinkBodyForms('Engineering delivery capacity', 'Delivery throughput', true);
    expect(nowFits!.length).toBeLessThanOrEqual(300);
  });

  it('(iii-c) every label pair the selector admits fits a card on both triggers; one character more and the selector itself refuses', () => {
    const labels = (total: number): [string, string] => ['A'.repeat(Math.ceil(total / 2)), 'B'.repeat(Math.floor(total / 2))];
    const variants: [string, (r: Record<string, any>) => void, boolean][] = [
      // The selector's sentence is shorter without a finite switch probability,
      // so it admits longer labels — long enough to overflow the explicit wording too.
      ['served rows (finite switch probability)', () => {}, false],
      ['rows without a switch probability', (r) => { for (const e of r.enrichment.robustness.fragile_edges) delete e.switch_probability; }, true],
    ];
    for (const [name, mutate, explicitOverflows] of variants) {
      const groundable = (total: number) => {
        const c = withGroundedLabels(runTurnCase('B', 't2', 'explicit_run'), ...labels(total), mutate);
        return selectGroundedCounterCase((c.final.analysisResult as Record<string, any>).enrichment).grounded !== null;
      };
      let max = 0;
      for (let total = 2; total <= 200 && groundable(total); total += 1) max = total;
      expect(max, name).toBeGreaterThanOrEqual(60);
      expect(groundable(max + 1), name).toBe(false);

      const [from, to] = labels(max);
      expect(fragileLinkBodyForms(from, to, true)[0]!.length, name).toBeGreaterThan(300);
      expect(fragileLinkBodyForms(from, to, false)[0]!.length > 300, name).toBe(explicitOverflows);
      for (const trigger of ['explicit_run', 'auto_first_pass'] as const) {
        const c = withGroundedLabels(runTurnCase('B', 't2', trigger), from, to, mutate);
        const out = runTurnCoaching(c.captured, c.final);
        expect(out.eligibility, `${name} / ${trigger}`).toEqual({ eligible: true });
        const card = fragileLinkCards(out.blocks)[0]!;
        expect(card.body.length).toBeLessThanOrEqual(300);
        expect(CoachingBlockSchema.safeParse(card).success).toBe(true);

        const over = withGroundedLabels(runTurnCase('B', 't2', trigger), from, to, mutate);
        const overResult = (r: Record<string, any>) => {
          const row = r.enrichment.robustness.fragile_edges.find((e: any) => e.to_label === to);
          row.to_label = `${to}B`;
        };
        overResult(over.captured.blocks![0] as Record<string, any>);
        overResult(over.final.analysisResult as Record<string, any>);
        expect(runTurnCoaching(over.captured, over.final), `${name} / ${trigger} / +1`).toEqual({
          blocks: [], eligibility: { eligible: false, reason: 'copy_gate' },
        });
      }
    }
  });

  it('(iii-d) the copy claims only what a fragile_edges row establishes (the check FLAGGED the link) — never what it means for the result, a ranking change or its size', () => {
    // ISL lists an edge in `fragile_edges` when the FIRST-LISTED option's expected
    // goal value moves by more than 10% of its own baseline as the link's strength
    // changes (robustness_analyzer_v2.py @3cfadcfc: ref_option = options[0] at
    // :1138/:1203/:1257; elasticity :1237-1240; FRAGILE_THRESHOLD 0.1). That is a
    // flag on one option's outcome, not on "the result". Whether the
    // ranking flips is a SEPARATE measurement (`is_robust`, `switch_probability`)
    // ranking flips is a SEPARATE measurement (`is_robust`, `switch_probability`)
    // that this card never reads. So on a robust, decisive run the card still
    // ships — the link is still worth checking — and no wording may say the
    // options could swap or that a "modest" change would do it.
    const RANKING_OR_MAGNITUDE = /options compare|could change|could shift|which option|modest|small change|slight|likely|overturn|flip|swap|switch|reverse|tip/i;
    const robustDecisive = (r: Record<string, any>) => {
      Object.assign(r.enrichment.robustness, {
        level: 'high',
        is_robust: true,
        confidence: 0.97,
        display_verdict: 'robust',
        display_verdict_reason: 'the result held across the changes to your assumptions that were tested',
        near_tie: { gap: 0.96, is_tie: false, threshold: 0.1 },
      });
      for (const e of r.enrichment.robustness.fragile_edges) {
        Object.assign(e, { switch_probability: 0, marginal_switch_probability: 0, alternative_winner_id: null, alternative_winner_label: null });
      }
    };
    const noMetric = (r: Record<string, any>) => {
      for (const e of r.enrichment.robustness.fragile_edges) {
        delete e.switch_probability;
        delete e.marginal_switch_probability;
        delete e.alternative_winner_id;
        delete e.alternative_winner_label;
      }
    };
    const briefs: [string, RunTurnCase][] = [
      ['B robust and decisive, switch_probability 0', withResult(runTurnCase('B', 't2', 'explicit_run'), robustDecisive)],
      ['A as served (low robustness)', runTurnCase('A', 't5', 'explicit_run')],
      ['B robust and decisive, first pass', withResult(runTurnCase('B', 't2', 'auto_first_pass'), robustDecisive)],
      ['B with no switch metric on any row', withResult(runTurnCase('B', 't2', 'explicit_run'), noMetric)],
    ];
    for (const [name, c] of briefs) {
      const out = runTurnCoaching(c.captured, c.final);
      expect(out.eligibility, name).toEqual({ eligible: true });
      const card = fragileLinkCards(out.blocks)[0]!;
      for (const field of USER_FACING) expect(String(card[field]), `${name} / ${field}`).not.toMatch(RANKING_OR_MAGNITUDE);
      expect(card.body, name).toMatch(/flagged the link from .+ as sensitive —/);
      // Names the flag, not a meaning the run did not measure.
      expect(card.body, name).not.toMatch(/the result|the outcome|the decision/i);
    }
    // Every wording the module can ship, on served labels and on the longest the selector admits.
    for (const [from, to] of [['Pro subscriber base', 'MRR'], ['Engineering delivery capacity', 'Delivery throughput']] as const) {
      for (const firstPass of [false, true]) {
        for (const form of fragileLinkBodyForms(from, to, firstPass)) expect(form).not.toMatch(RANKING_OR_MAGNITUDE);
        const copy = composeFragileLinkChallenge(from, to, firstPass);
        for (const field of USER_FACING) expect(copy[field]).not.toMatch(RANKING_OR_MAGNITUDE);
      }
    }
  });

  it('(iv) no groundable edge (fragile_edges removed; labels removed) → no card, no_groundable_fragile_edge', () => {
    const noEdges = withResult(runTurnCase('B', 't2', 'explicit_run'), (r) => { r.enrichment.robustness.fragile_edges = []; });
    expect(runTurnCoaching(noEdges.captured, noEdges.final)).toEqual({
      blocks: [], eligibility: { eligible: false, reason: 'no_groundable_fragile_edge' },
    });
    const noLabels = withResult(runTurnCase('B', 't2', 'explicit_run'), (r) => {
      for (const e of r.enrichment.robustness.fragile_edges) { delete e.from_label; delete e.to_label; }
    });
    expect(runTurnCoaching(noLabels.captured, noLabels.final)).toEqual({
      blocks: [], eligibility: { eligible: false, reason: 'no_groundable_fragile_edge' },
    });
  });

  it('(v) no run this turn (no capture; failed run; no trigger; foreign trigger) → no card, no_run_this_turn', () => {
    const c = runTurnCase('B', 't2', 'explicit_run');
    const none = { blocks: [], eligibility: { eligible: false, reason: 'no_run_this_turn' } };
    expect(runTurnCoaching(undefined, c.final)).toEqual(none);
    expect(runTurnCoaching({ ...c.captured, status: 500 }, c.final)).toEqual(none);
    const { trigger: _dropped, ...untriggered } = c.captured;
    expect(runTurnCoaching(untriggered, c.final)).toEqual(none);
    expect(runTurnCoaching({ ...c.captured, trigger: 'board_edit' as never }, c.final)).toEqual(none);
  });

  it('(vi) edited graph (final graph hash differs from the run\'s) → no card, identity_mismatch', () => {
    const c = runTurnCase('B', 't2', 'explicit_run');
    expect(runTurnCoaching(c.captured, { ...c.final, graphHash: 'fedcba9876543210' })).toEqual({
      blocks: [], eligibility: { eligible: false, reason: 'identity_mismatch' },
    });
  });

  it('(vi-b) run_state other than complete_current on the capture, the readback or both → no card, identity_mismatch', () => {
    // complete_current on both sides is the ONLY licence for the freshness
    // 'fresh' runTurnCoaching hands the claim cage; a refused run is kept out
    // only by this gate (refusal freshness is clamped to stale | unknown).
    const base = runTurnCase('B', 't2', 'explicit_run');
    const computedAt = base.turn.analysis_state.run_state.computed_at;
    // Kind swapped, computed_at KEPT: nothing but the kind gate can refuse these.
    const kindOnly = ['unknown_degraded', 'complete_stale', 'refused'].map((kind) => ({ kind, computed_at: computedAt }));
    // The contract's own shapes for a degraded, stale and refused run.
    const schemaShapes = [
      { kind: 'unknown_degraded', cause: 'refusal_unverified' },
      { kind: 'unknown_degraded', cause: 'store_unreadable' },
      { kind: 'complete_stale', computed_at: computedAt, cause: 'graph_changed' },
      { kind: 'refused', reason_code: REFUSAL_REASON_UNSPECIFIED },
    ];
    for (const shape of schemaShapes) expect(AnalysisRunStateSchema.safeParse(shape).success, shape.kind).toBe(true);

    const refused = { blocks: [], eligibility: { eligible: false, reason: 'identity_mismatch' } };
    for (const runState of [...kindOnly, ...schemaShapes]) {
      for (const side of ['capture', 'readback', 'both'] as const) {
        for (const trigger of ['explicit_run', 'auto_first_pass'] as const) {
          const c = runTurnCase('B', 't2', trigger);
          if (side !== 'readback') (c.captured.analysis_state as Record<string, any>).run_state = structuredClone(runState);
          if (side !== 'capture') (c.final.analysisState as Record<string, any>).run_state = structuredClone(runState);
          expect(runTurnCoaching(c.captured, c.final), `${JSON.stringify(runState)} on ${side} / ${trigger}`).toEqual(refused);
        }
      }
    }
    // Contrast: complete_current on both sides builds the card, on both triggers.
    for (const trigger of ['explicit_run', 'auto_first_pass'] as const) {
      const c = runTurnCase('B', 't2', trigger);
      expect(runTurnCoaching(c.captured, c.final).eligibility).toEqual({ eligible: true });
    }
  });

  it('(vii) re-run on the same graph (different computed_at) → a different block_id', () => {
    // Served: A t5 and A t7 are two Runs on the same revision.
    const first = runTurnCase('A', 't5', 'explicit_run');
    const rerun = runTurnCase('A', 't7', 'explicit_run');
    expect(rerun.turn.graph_hash).toBe(first.turn.graph_hash);
    expect(rerun.turn.analysis_state.run_state.computed_at).not.toBe(first.turn.analysis_state.run_state.computed_at);
    const a = fragileLinkCards(runTurnCoaching(first.captured, first.final).blocks)[0]!;
    const b = fragileLinkCards(runTurnCoaching(rerun.captured, rerun.final).blocks)[0]!;
    expect(a.graph_hash_at_generation).toBe(b.graph_hash_at_generation);
    expect(b.block_id).not.toBe(a.block_id);
    expect(b.created_at).toBe(rerun.turn.analysis_state.run_state.computed_at);

    // Same on B with only computed_at moved.
    const base = runTurnCase('B', 't2', 'explicit_run');
    const moved = withComputedAt(base, '2026-09-24T16:52:00.000Z');
    const x = fragileLinkCards(runTurnCoaching(base.captured, base.final).blocks)[0]!;
    const y = fragileLinkCards(runTurnCoaching(moved.captured, moved.final).blocks)[0]!;
    expect(y.block_id).not.toBe(x.block_id);
  });

  it('(ix) the action is not a typed Run or approval: no action_intent; not the Run chip; not an approval', () => {
    const c = runTurnCase('B', 't2', 'explicit_run');
    const card = fragileLinkCards(runTurnCoaching(c.captured, c.final).blocks)[0]!;
    expect(Object.hasOwn(card, 'action_intent')).toBe(false);
    expect(card.action_prompt).toBe(
      'Talk me through what would change if the link from Pro subscriber base to MRR were weaker or stronger. Don\'t change the model or re-run anything yet.',
    );
    expect(card.action_prompt).not.toBe(RUN_OFFER_CHIP.message);
    expect(card.action_label).not.toBe(RUN_OFFER_CHIP.label);
    // Dispatched verbatim as a message turn, it is neither a typed Run nor a typed approval.
    expect(typedRunOf({ kind: 'message', message: card.action_prompt })).toBe(false);
    expect(typedApprovalOf({ kind: 'message', message: card.action_prompt })).toBeUndefined();
    // Nor the words any approval chip sends.
    const approvalMessages = ['propose_starting_point', 'propose_assumptions', 'propose_option_interventions', 'propose_model_change', 'propose_new_option']
      .flatMap((name) => approvalChipsFor([{ name, ok: true, mutated: false, proposal_id: 'prop_0123456789abcdef' }]))
      .map((chip) => chip.message);
    expect(approvalMessages).toContain(AMEND_CHIP.message);
    expect(approvalMessages.filter((m) => m.startsWith('Yes')).length).toBeGreaterThanOrEqual(3);
    for (const message of approvalMessages) expect(card.action_prompt).not.toBe(message);
    expect(card.action_prompt).not.toMatch(/^\s*(?:yes|ok(?:ay)?|approve|go ahead|run)\b/i);
  });

  describe('buildFragileLinkChallenge gates (3)–(5), driven directly on the served B readback', () => {
    const input = (mutate: (result: Record<string, any>) => void = () => {}, over: Record<string, unknown> = {}) => {
      const c = runTurnCase('B', 't2', 'explicit_run');
      const result = structuredClone(c.final.analysisResult) as Record<string, any>;
      mutate(result);
      return {
        analysisResult: result,
        graphHash: c.turn.graph_hash,
        computedAt: c.turn.analysis_state.run_state.computed_at,
        trigger: 'explicit_run' as const,
        freshness: 'fresh' as const,
        ...over,
      };
    };

    it('contrast: the unmodified readback builds the card', () => {
      expect(buildFragileLinkChallenge(input()).reason).toBeNull();
    });

    it('a result not computed against the given graph → identity_mismatch', () => {
      expect(buildFragileLinkChallenge(input(undefined, { graphHash: 'fedcba9876543210' }))).toEqual({ block: null, reason: 'identity_mismatch' });
    });

    it('(4) claim cage: a non-fresh verdict, or a robustness_status other than computed → claim_not_usable', () => {
      expect(buildFragileLinkChallenge(input(undefined, { freshness: null }))).toEqual({ block: null, reason: 'claim_not_usable' });
      expect(buildFragileLinkChallenge(input(undefined, { freshness: 'stale' }))).toEqual({ block: null, reason: 'claim_not_usable' });
      expect(buildFragileLinkChallenge(input((r) => { r.enrichment.robustness_status = 'failed'; }))).toEqual({ block: null, reason: 'claim_not_usable' });
      expect(buildFragileLinkChallenge(input((r) => { r.enrichment.robustness_status = 'computed'; })).reason).toBeNull();
    });

    it('(5) copy gate: a raw decimal, an id-shaped token, leader words, an option name or an over-long label → copy_gate', () => {
      const relabel = (from: string, to = 'MRR') => input((r) => {
        const head = r.enrichment.robustness.fragile_edges[0];
        head.from_label = from;
        head.to_label = to;
      });
      expect(buildFragileLinkChallenge(relabel('Churn at 0.5 per month')).reason).toBe('copy_gate');
      expect(buildFragileLinkChallenge(relabel('factor_pro_base_2')).reason).toBe('copy_gate');
      expect(buildFragileLinkChallenge(relabel('Recommended bundle')).reason).toBe('copy_gate');
      expect(buildFragileLinkChallenge(relabel('Raise Price at Release')).reason).toBe('copy_gate');
      expect(buildFragileLinkChallenge(relabel('Effect of raise price at release timing')).reason).toBe('copy_gate');
      expect(buildFragileLinkChallenge(relabel('A'.repeat(60), 'B'.repeat(60))).reason).toBe('copy_gate');
      // Contrast: an ordinary relabel still builds.
      expect(buildFragileLinkChallenge(relabel('Pro subscriber base')).reason).toBeNull();
    });
  });

  it('copy is one definition: composeFragileLinkChallenge yields the shipped strings', () => {
    const copy = composeFragileLinkChallenge('Pro subscriber base', 'MRR', false);
    const c = runTurnCase('B', 't2', 'explicit_run');
    const card = fragileLinkCards(runTurnCoaching(c.captured, c.final).blocks)[0]!;
    expect({ title: card.title, body: card.body, action_label: card.action_label, action_prompt: card.action_prompt }).toEqual(copy);
  });

  it('golden: the committed payload equals fresh producer output', () => {
    const fresh = JSON.parse(JSON.stringify(buildFragileLinkChallengePayload())) as Record<string, any>;
    if (process.env.UPDATE_FRAGILE_LINK_PAYLOAD === '1') {
      writeFileSync(fixtureUrl(PAYLOAD_FILE), `${JSON.stringify(fresh, null, 2)}\n`);
    }
    const committed = JSON.parse(readFileSync(fixtureUrl(PAYLOAD_FILE), 'utf8')) as Record<string, any>;
    expect(committed).toEqual(fresh);
    expect(committed.contract_version).toBe('run-turn-coaching/v1');
    for (const key of ['explicit_run', 'auto_first_pass', 'permitted_explicit_run', 'clear_winner_explicit_run']) {
      expect(committed[key].eligibility).toEqual({ eligible: true });
      expect(committed[key].blocks).toHaveLength(1);
      expect(CoachingBlockSchema.safeParse(committed[key].blocks[0]).success).toBe(true);
    }
    // Exactly one badged card: the clear winner. The three c19 inputs show no clear winner.
    const badged = Object.entries(committed).filter(([, v]) => (v as any)?.blocks?.[0]?.dsk_claim_provenance !== undefined).map(([k]) => k);
    expect(badged).toEqual(['clear_winner_explicit_run']);
    expect(committed.clear_winner_explicit_run.blocks[0].dsk_claim_provenance).toEqual(dskClaimFromBundle());
  });
});

describe('run-turn coaching — identity carries the copy variant, captures without state, options named via analysis_ready', () => {
  const cardOf = (r: ReturnType<typeof runTurnCoaching>) => r.blocks.filter((b) => b.signal_id.startsWith('coach:fragile_link:'));

  it('(id) one run under the two triggers gives two block_ids — one id never names two bodies', () => {
    const explicit = cardOf(runTurnCoaching(runTurnCase('B', 't2', 'explicit_run').captured, runTurnCase('B', 't2', 'explicit_run').final))[0]!;
    const auto = cardOf(runTurnCoaching(runTurnCase('B', 't2', 'auto_first_pass').captured, runTurnCase('B', 't2', 'auto_first_pass').final))[0]!;
    expect(explicit.body).not.toBe(auto.body);
    expect(explicit.block_id).not.toBe(auto.block_id);
    expect(explicit.signal_id.endsWith(':explicit_run')).toBe(true);
    expect(auto.signal_id.endsWith(':auto_first_pass')).toBe(true);
    // Same trigger, same run: the id is stable.
    const again = cardOf(runTurnCoaching(runTurnCase('B', 't2', 'auto_first_pass').captured, runTurnCase('B', 't2', 'auto_first_pass').final))[0]!;
    expect(again.block_id).toBe(auto.block_id);
  });

  it('(F2) a capture that states NO analysis_state still binds to the readback run — the automatic first pass is not blank', () => {
    for (const trigger of ['auto_first_pass', 'explicit_run'] as const) {
      const c = runTurnCase('B', 't2', trigger);
      const { analysis_state: _dropped, ...stateless } = c.captured;
      const r = runTurnCoaching(stateless, c.final);
      expect(r.eligibility).toEqual({ eligible: true });
      const card = cardOf(r)[0]!;
      expect(card.graph_hash_at_generation).toBe(c.turn.graph_hash);
      expect(card.created_at).toBe(c.turn.analysis_state.run_state.computed_at);
    }
  });

  it('(F2) a stateless capture of a DIFFERENT run is still refused (hash or leader designation differs)', () => {
    const c = runTurnCase('B', 't2', 'auto_first_pass');
    const { analysis_state: _dropped, ...stateless } = c.captured;
    const otherHash = { ...stateless, blocks: [{ ...(stateless.blocks![0] as Record<string, unknown>), computed_against_hash: 'ffffffffffffffff' }] };
    expect(runTurnCoaching(otherHash, c.final)).toEqual({ blocks: [], eligibility: { eligible: false, reason: 'identity_mismatch' } });
    const otherLeader = { ...stateless, blocks: [{ ...(stateless.blocks![0] as Record<string, unknown>), leading_option_id: 'another-option' }] };
    expect(runTurnCoaching(otherLeader, c.final)).toEqual({ blocks: [], eligibility: { eligible: false, reason: 'identity_mismatch' } });
    // A capture that DOES state a run_state which disagrees is refused, not bypassed.
    const stale = { ...c.captured, analysis_state: { ...(c.captured.analysis_state as Record<string, unknown>), run_state: { kind: 'complete_stale', computed_at: c.turn.analysis_state.run_state.computed_at } } };
    expect(runTurnCoaching(stale, c.final).eligibility).toEqual({ eligible: false, reason: 'identity_mismatch' });
  });

  it('(F4) on an automatic-run shape (no win_probabilities) an endpoint that names an option is refused via analysis_ready.options', () => {
    const c = runTurnCase('B', 't2', 'auto_first_pass');
    const grounded = selectGroundedCounterCase(c.turn.analysis_result.enrichment).grounded!;
    const optionLabel = c.turn.analysis_ready.options[0]!.label;
    const retag = (result: Record<string, unknown>) => {
      const r = structuredClone(result) as Record<string, unknown> & { enrichment: { robustness: { fragile_edges: Record<string, unknown>[] } } };
      delete r.win_probabilities;
      for (const row of r.enrichment.robustness.fragile_edges) {
        if (row.from_id === grounded.fromId && row.to_id === grounded.toId) row.from_label = optionLabel;
      }
      return r;
    };
    const final = { ...c.final, analysisResult: retag(c.final.analysisResult as Record<string, unknown>) };
    const captured = { ...c.captured, blocks: [retag(c.captured.blocks![0] as Record<string, unknown>)] };
    expect(runTurnCoaching(captured, final).eligibility).toEqual({ eligible: false, reason: 'copy_gate' });
    // Contrast: without analysis_ready's options the guard has nothing to read, and the card ships.
    const { analysis_ready: _none, ...noReady } = captured;
    expect(runTurnCoaching(noReady, final).eligibility).toEqual({ eligible: true });
  });
});


/**
 * THE DSK-P-003 BADGE IS KEPT ONLY WHERE THE RUN POSITIVELY SHOWS A CLEAR WINNER.
 *
 * DSK-P-003's required input is "analysis results showing a clear winner with high win
 * probability" and its first contraindication is "Do not run when the analysis shows a close
 * call" (data/dsk/v1.json); TR-003 fires on "win probability >70% AND robustness = 'robust' or
 * 'moderate'" and never on "a close call (separation <10%)". The card is a link check and ships
 * either way; only the science badge depends on these conditions, and anything unshown withholds it.
 */
describe('DSK-P-003 badge — kept only where the run positively shows a clear winner', () => {
  const soleCard = (c: RunTurnCase, name = ''): CoachingBlock => {
    const out = runTurnCoaching(c.captured, c.final);
    expect(out.eligibility, name).toEqual({ eligible: true });
    const cards = fragileLinkCards(out.blocks);
    expect(cards, name).toHaveLength(1);
    expect(CoachingBlockSchema.safeParse(cards[0]).success, name).toBe(true);
    return cards[0]!;
  };
  const expectedSignal = (c: RunTurnCase, trigger: 'explicit_run' | 'auto_first_pass'): string => {
    const readback = c.final.analysisResult as { enrichment: unknown };
    const grounded = selectGroundedCounterCase(readback.enrichment as never).grounded!;
    return `coach:fragile_link:${grounded.edgeIdentity}:${c.turn.graph_hash}:${c.turn.analysis_state.run_state.computed_at}:${trigger}`;
  };

  it('BADGE-RED-1: a near tie (c19-C, is_tie true) → the card ships WITHOUT the badge, identity unchanged, on both triggers', () => {
    const explicit = runTurnCase('C', 'A2r', 'explicit_run');
    expect(explicit.turn.tools_called).toContain('run_analysis');
    expect(explicit.turn.analysis_result.enrichment.robustness.near_tie).toMatchObject({ is_tie: true });
    const firstPass = firstPassCase('C', 'A2r');
    // Control: the first pass really is the confined shape.
    const confined = (firstPass.final.analysisResult as { enrichment: { robustness: Record<string, unknown> } }).enrichment.robustness;
    expect(Object.keys(confined).sort()).toEqual(['fragile_edges', 'near_tie', 'robust_edges']);
    expect(confined.near_tie).toMatchObject({ is_tie: true });
    for (const [trigger, c] of [['explicit_run', explicit], ['auto_first_pass', firstPass]] as const) {
      const card = soleCard(c, trigger);
      expect(Object.hasOwn(card, 'dsk_claim_provenance'), trigger).toBe(false);
      expect(card.signal_id, trigger).toBe(expectedSignal(c, trigger));
      expect(card.block_id, trigger).toBe(deterministicBlockId(expectedSignal(c, trigger)));
      expect(card.title, trigger).toBe('Pressure-test a sensitive link');
    }
  });

  it('BADGE-2 contrast: a clear winner (c16: not a tie, gap ≥ 0.25, is_robust, verdict moderate, leader named) keeps the badge on the explicit Run only', () => {
    const c = runTurnCase('c16', 't5', 'explicit_run');
    expect(c.turn.analysis_result.enrichment.robustness).toMatchObject({ is_robust: true, display_verdict: 'moderate', near_tie: { is_tie: false } });
    const card = soleCard(c);
    expect(card.dsk_claim_provenance).toEqual(dskClaimFromBundle());
    expect(card.signal_id).toBe(expectedSignal(c, 'explicit_run'));
    // The first pass of the SAME run cannot show a clear winner (verdict, is_robust, leader and
    // runner-up are confined away), so it withholds the badge — never the card.
    const firstPass = soleCard(firstPassCase('c16', 't5'), 'c16 first pass');
    expect(Object.hasOwn(firstPass, 'dsk_claim_provenance')).toBe(false);
  });

  it('BADGE-2b: the shipped goldens do not show a clear winner → no badge (c19-A slightly ahead and not robust; c19-B leader withheld)', () => {
    for (const [letter, turn, trigger] of [['A', 't5', 'explicit_run'], ['A', 't7', 'explicit_run'], ['B', 't2', 'explicit_run'], ['B', 't2', 'auto_first_pass']] as const) {
      const card = soleCard(runTurnCase(letter, turn, trigger), `${letter}/${turn}/${trigger}`);
      expect(Object.hasOwn(card, 'dsk_claim_provenance'), `${letter}/${turn}/${trigger}`).toBe(false);
    }
  });

  it('BADGE-3 fail closed: each unshown or failing condition withholds the badge, never the card', () => {
    const rob = (r: Record<string, any>) => r.enrichment.robustness as Record<string, any>;
    const rows: [string, (r: Record<string, any>) => void, ('explicit_run' | 'auto_first_pass')?][] = [
      ['near_tie absent', (r) => { delete rob(r).near_tie; }],
      ['near_tie null', (r) => { rob(r).near_tie = null; }],
      ['near_tie an array', (r) => { rob(r).near_tie = [rob(r).near_tie]; }],
      ["is_tie the string 'false'", (r) => { rob(r).near_tie.is_tie = 'false'; }],
      ['is_tie undefined', (r) => { delete rob(r).near_tie.is_tie; }],
      ['is_tie true', (r) => { rob(r).near_tie.is_tie = true; }],
      ['no runner-up (second_option_id absent)', (r) => { delete rob(r).near_tie.second_option_id; }],
      ['runner-up null (single-option branch)', (r) => { rob(r).near_tie.second_option_id = null; }],
      ['gap 1.0 (no comparison possible)', (r) => { rob(r).near_tie.gap = 1; }],
      ['gap below the clear-winner band', (r) => { rob(r).near_tie.gap = 0.24; }],
      ['gap not a number', (r) => { rob(r).near_tie.gap = '0.59'; }],
      ['is_robust false', (r) => { rob(r).is_robust = false; }],
      ['is_robust absent', (r) => { delete rob(r).is_robust; }],
      ["display_verdict 'fragile'", (r) => { rob(r).display_verdict = 'fragile'; }],
      ['display_verdict absent', (r) => { delete rob(r).display_verdict; }],
      ['leader withheld (leading_option_id null)', (r) => { r.leading_option_id = null; }],
      ['automatic first pass on the full explicit shape', () => {}, 'auto_first_pass'],
    ];
    // Contrast: the unmodified run keeps the badge.
    expect(soleCard(runTurnCase('c16', 't5', 'explicit_run')).dsk_claim_provenance).toEqual(dskClaimFromBundle());
    for (const [name, mutate, trigger = 'explicit_run'] of rows) {
      const card = soleCard(withResult(runTurnCase('c16', 't5', trigger), mutate), name);
      expect(Object.hasOwn(card, 'dsk_claim_provenance'), name).toBe(false);
      expect(card.title, name).toBe('Pressure-test a sensitive link');
    }
  });
});
