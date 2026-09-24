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
import { CoachingBlockSchema, type CoachingBlock } from '@talchain/schemas/boundary';

import { runTurnCoaching } from '../../agent-lane/analysis-coaching-pass-through.js';
import { AMEND_CHIP, approvalChipsFor, typedApprovalOf } from '../../agent-lane/approval-chips.js';
import { deterministicBlockId } from '../../compose/block-id.js';
import { buildAutoRunProvenance } from '../../context/run-initiator.js';
import { RUN_OFFER_CHIP, typedRunOf } from '../../../routes/agent-v1-turn.js';
import {
  RUN_TURN_COACHING_CONTRACT,
  buildFragileLinkChallenge,
  composeFragileLinkChallenge,
} from '../fragile-link-challenge.js';
import { selectGroundedCounterCase } from '../grounded-counter-case.js';
import {
  PAYLOAD_FILE,
  buildFragileLinkChallengePayload,
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
      `coach:fragile_link:${grounded.edgeIdentity}:${c.turn.graph_hash}:${c.turn.analysis_state.run_state.computed_at}`,
    );
    expect(card.block_id).toBe(deterministicBlockId(card.signal_id));
    expect(card.target_refs).toEqual([{ id: grounded.edgeIdentity, kind: 'edge', label: 'Developer capacity → Velocity' }]);
    expect(card).toMatchObject({
      type: 'coaching',
      coaching_kind: RUN_TURN_COACHING_CONTRACT.block.coaching_kind,
      source: 'deterministic_signal',
      source_handler: 'run_analysis',
      freshness: 'fresh',
      title: 'Pressure-test a fragile link',
      action_label: 'Pressure-test this link',
    });
    expect(card.coaching_kind).toBe('bias_signal');
    expect(card.dsk_claim_provenance).toEqual(dskClaimFromBundle());
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
      'The robustness check flagged the link from Pro subscriber base to MRR as fragile — a modest change in how strongly Pro subscriber base drives MRR could change how the options compare.',
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
      'Before relying on this first pass on Olumi\'s estimates, note that the robustness check flagged the link from Pro subscriber base to MRR as fragile — a modest change in how strongly Pro subscriber base drives MRR could change how the options compare.',
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
    for (const key of ['explicit_run', 'auto_first_pass', 'permitted_explicit_run']) {
      expect(committed[key].eligibility).toEqual({ eligible: true });
      expect(committed[key].blocks).toHaveLength(1);
      expect(CoachingBlockSchema.safeParse(committed[key].blocks[0]).success).toBe(true);
    }
  });
});
