/**
 * THE RUN-TURN NO-FLAGGED-LINK CARD — the second run-turn coaching card, for a run
 * whose robustness check marked NO single link as fragile.
 *
 * Every positive input is a served agent-lane wire response, trimmed (c10 CEE
 * `d2afc2c` — a near tie; c11 CEE `0415b19` — not a near tie; see
 * `fragile-link-challenge-fixtures.ts`). The copy strings below are the spec's,
 * typed here on purpose: the test pins the words that ship, not the module's
 * own constants.
 */
import { describe, expect, it } from 'vitest';
import { CoachingBlockSchema, type CoachingBlock } from '@talchain/schemas/boundary';

import { runTurnCoaching } from '../../agent-lane/analysis-coaching-pass-through.js';
import { AMEND_CHIP, approvalChipsFor, typedApprovalOf } from '../../agent-lane/approval-chips.js';
import { deterministicBlockId } from '../../compose/block-id.js';
import { findForbiddenPhraseHit } from '../../compose/forbidden-user-facing-phrases.js';
import { buildAutoRunProvenance } from '../../context/run-initiator.js';
import { RUN_OFFER_CHIP, typedRunOf } from '../../../routes/agent-v1-turn.js';
import { passesGroundedProseGates } from '../grounded-counter-case.js';
import { composeNoFlaggedLinkCard } from '../no-flagged-link-card.js';
import {
  firstPassCase,
  runTurnCase,
  type FixtureLetter,
  type RunTurnCase,
} from './fragile-link-challenge-fixtures.js';

const TITLE = 'What the robustness check can\'t show';
const BODY_EXPLICIT =
  'The robustness check didn\'t single out any one link in the model. That doesn\'t show the estimates are right, '
  + 'and the check can only test what is already in the model, not what the model leaves out. Both are worth a look.';
const BODY_FIRST_PASS =
  'Before relying on this first pass on Olumi\'s estimates, note that the robustness check can only test what is '
  + 'already in the model, not what the model leaves out. It didn\'t single out any one link, but that doesn\'t show '
  + 'the estimates are right. Both are worth a look.';

/**
 * ⛔ WHAT THE BODY MAY NOT SAY (review of 1619d73, claims lens):
 *   · that the check "only looks at links" — ISL also samples FACTOR values
 *     (FactorSampler / _compute_factor_sensitivity), and the same run's footer
 *     can read "varying any one of the factors we could test…";
 *   · the verdict's own word "fragile" — on every served run that gets this card
 *     the overall display_verdict IS "fragile", so "no link was fragile" beside
 *     it reads as a contradiction, or as reassurance.
 */
const BODY_FORBIDDEN = /only looks at links|fragile/i;
const ACTION_LABEL = 'Look for weak spots and gaps';
const ACTION_PROMPT =
  'Ask me questions to help me spot which estimates in the model I\'m least sure of, and what matters to this decision '
  + 'but isn\'t in the model, including anything I could still find out. Don\'t choose for me, and don\'t change the '
  + 'model or re-run anything yet.';

const LEADER_WORDS = /option in front|winner|recommend|best option|leading option/i;
const USER_FACING = ['title', 'body', 'action_label', 'action_prompt'] as const;
const LIMITS = { title: 80, body: 300, action_label: 40, action_prompt: 300 } as const;
const NO_FLAG_PREFIX = 'coach:no_flagged_link:';
const RUN_CARD_PREFIXES = ['coach:fragile_link:', NO_FLAG_PREFIX] as const;

const noFlagCards = (blocks: readonly CoachingBlock[]) => blocks.filter((b) => b.signal_id.startsWith(NO_FLAG_PREFIX));
const runCards = (blocks: readonly CoachingBlock[]) => blocks.filter((b) => RUN_CARD_PREFIXES.some((p) => b.signal_id.startsWith(p)));
const run = (c: RunTurnCase) => runTurnCoaching(c.captured, c.final);
const refused = (reason: string) => ({ blocks: [], eligibility: { eligible: false, reason } });

function withResult(c: RunTurnCase, mutate: (result: Record<string, any>) => void): RunTurnCase {
  const captured = structuredClone(c.captured);
  const final = structuredClone(c.final);
  mutate(captured.blocks![0] as Record<string, any>);
  mutate(final.analysisResult as Record<string, any>);
  return { ...c, captured, final };
}
const rob = (r: Record<string, any>) => r.enrichment.robustness as Record<string, any>;

function withComputedAt(c: RunTurnCase, computedAt: string): RunTurnCase {
  const captured = structuredClone(c.captured);
  const final = structuredClone(c.final);
  (captured.analysis_state as any).run_state.computed_at = computedAt;
  (final.analysisState as any).run_state.computed_at = computedAt;
  return { ...c, captured, final };
}

function soleNoFlagCard(c: RunTurnCase, name = ''): CoachingBlock {
  const out = run(c);
  expect(out.eligibility, name).toEqual({ eligible: true });
  expect(runCards(out.blocks), name).toHaveLength(1);
  const cards = noFlagCards(out.blocks);
  expect(cards, name).toHaveLength(1);
  expect(CoachingBlockSchema.safeParse(cards[0]).success, name).toBe(true);
  return cards[0]!;
}

function expectedSignal(c: RunTurnCase, trigger: 'explicit_run' | 'auto_first_pass'): string {
  return `${NO_FLAG_PREFIX}${c.turn.graph_hash}:${c.turn.analysis_state.run_state.computed_at}:${trigger}`;
}

describe('run-turn no-flagged-link card', () => {
  it('CARD-RED-1 explicit Run with no fragile link (c10, near tie) → exactly one card: spec copy, run-bound identity, no pills, no badge', () => {
    const c = runTurnCase('c10', 't5', 'explicit_run');
    // Controls: the served run really has no fragile link, robust links, and is a near tie.
    expect(c.turn.tools_called).toContain('run_analysis');
    expect(c.turn.analysis_result.enrichment.robustness.fragile_edges).toEqual([]);
    expect((c.turn.analysis_result.enrichment.robustness.robust_edges as unknown[]).length).toBeGreaterThan(0);
    expect(c.turn.analysis_result.enrichment.robustness.near_tie).toMatchObject({ is_tie: true });

    const out = run(c);
    expect(out.eligibility).toEqual({ eligible: true });
    expect(out.blocks).toHaveLength(1);
    const card = soleNoFlagCard(c);
    const hash = c.turn.graph_hash;
    const computedAt = c.turn.analysis_state.run_state.computed_at;
    expect(card.signal_id).toBe(`coach:no_flagged_link:${hash}:${computedAt}:explicit_run`);
    expect(card.block_id).toBe(deterministicBlockId(card.signal_id));
    expect(card.target_refs).toEqual([]);
    expect(Object.hasOwn(card, 'dsk_claim_provenance')).toBe(false);
    expect(Object.hasOwn(card, 'action_intent')).toBe(false);
    expect({ title: card.title, body: card.body, action_label: card.action_label, action_prompt: card.action_prompt }).toEqual({
      title: TITLE, body: BODY_EXPLICIT, action_label: ACTION_LABEL, action_prompt: ACTION_PROMPT,
    });
    expect(card).toMatchObject({
      type: 'coaching',
      coaching_kind: 'assumption_check',
      source: 'deterministic_signal',
      source_handler: 'run_analysis',
      freshness: 'fresh',
      priority_rank: 15,
      created_at: computedAt,
      graph_hash_at_generation: hash,
    });
  });

  it('CARD-2 near_tie is never an input: c11 (not a near tie) gets the same card; so do c10 with near_tie removed, flipped or malformed', () => {
    const c11 = runTurnCase('c11', 't5', 'explicit_run');
    expect(c11.turn.analysis_result.enrichment.robustness.near_tie).toMatchObject({ is_tie: false });
    const card = soleNoFlagCard(c11, 'c11');
    expect(card.signal_id).toBe(expectedSignal(c11, 'explicit_run'));
    expect([card.title, card.body, card.action_label, card.action_prompt]).toEqual([TITLE, BODY_EXPLICIT, ACTION_LABEL, ACTION_PROMPT]);

    const base = soleNoFlagCard(runTurnCase('c10', 't5', 'explicit_run'), 'c10');
    const variants: [string, (r: Record<string, any>) => void][] = [
      ['near_tie removed', (r) => { delete rob(r).near_tie; }],
      ['near_tie is_tie false', (r) => { rob(r).near_tie.is_tie = false; }],
      ['near_tie malformed', (r) => { rob(r).near_tie = 'close'; }],
      ['is_robust true, level high', (r) => { Object.assign(rob(r), { is_robust: true, level: 'high' }); }],
      ['win_probabilities removed', (r) => { delete r.win_probabilities; }],
    ];
    for (const [name, mutate] of variants) {
      expect(soleNoFlagCard(withResult(runTurnCase('c10', 't5', 'explicit_run'), mutate), name), name).toEqual(base);
    }
  });

  it('CARD-3 trigger: the REAL first pass (confined readback) is refused — its guards are not observable; an automatic run on a readback that shows them carries the first-pass copy', () => {
    for (const letter of ['c10', 'c11'] as const) {
      const confined = firstPassCase(letter, 't5');
      const robustness = (confined.final.analysisResult as Record<string, any>).enrichment.robustness as Record<string, unknown>;
      // Control: the confinement kept the positive evidence and dropped the guards.
      expect(Object.keys(robustness).sort(), letter).toEqual(['fragile_edges', 'near_tie', 'robust_edges']);
      expect((robustness.robust_edges as unknown[]).length, letter).toBeGreaterThan(0);
      expect(run(confined), `${letter} first pass`).toEqual(refused('edge_sensitivity_not_evidenced'));
      // Contrast: the explicit Run of the same served run gets the card.
      expect(run(runTurnCase(letter, 't5', 'explicit_run')).eligibility, letter).toEqual({ eligible: true });

      // An automatic trigger whose readback still shows the guards: the first-pass wording and identity.
      const auto = runTurnCase(letter, 't5', 'auto_first_pass');
      const card = soleNoFlagCard(auto, `${letter} auto`);
      expect(card.body).toBe(BODY_FIRST_PASS);
      expect(card.signal_id).toBe(expectedSignal(auto, 'auto_first_pass'));
      expect(card.block_id).toBe(deterministicBlockId(expectedSignal(auto, 'auto_first_pass')));
      // The run's own provenance stamp marks it automatic even when the trigger says explicit.
      const stamped = withResult(runTurnCase(letter, 't5', 'explicit_run'), (r) => {
        r.enrichment.run_provenance = buildAutoRunProvenance('11111111-1111-4111-8111-111111111111');
      });
      expect(soleNoFlagCard(stamped, `${letter} stamped`).body).toBe(BODY_FIRST_PASS);
    }
  });

  it('CARD-3b normalization errors with robust rows are refused on BOTH triggers (explicit: seen; first pass: confined away, so unobservable)', () => {
    const errors = [{ edge_type: 'fragile', error: 'unparseable edge id', raw_value: 'x' }];
    const explicit = withResult(runTurnCase('c10', 't5', 'explicit_run'), (r) => { rob(r).normalization_errors = errors; });
    expect(run(explicit)).toEqual(refused('edge_sensitivity_not_evidenced'));
    const firstPass = firstPassCase('c10', 't5', (r) => { r.enrichment.robustness.normalization_errors = errors; });
    const robustness = (firstPass.final.analysisResult as Record<string, any>).enrichment.robustness as Record<string, unknown>;
    expect(Object.hasOwn(robustness, 'normalization_errors')).toBe(false);
    expect(run(firstPass)).toEqual(refused('edge_sensitivity_not_evidenced'));
    // Contrast: an EMPTY list is no error.
    expect(run(withResult(runTurnCase('c10', 't5', 'explicit_run'), (r) => { rob(r).normalization_errors = []; })).eligibility).toEqual({ eligible: true });
  });

  it('CARD-4 refusals carry their exact reasons', () => {
    const cases: [string, (r: Record<string, any>) => void, string][] = [
      ['PLoT synthesised {fragile_edges:[],robust_edges:[]}', (r) => { r.enrichment.robustness = { fragile_edges: [], robust_edges: [] }; }, 'edge_sensitivity_not_evidenced'],
      ['robustness absent', (r) => { delete r.enrichment.robustness; }, 'edge_sensitivity_not_evidenced'],
      ['robustness not an object', (r) => { r.enrichment.robustness = 'fragile'; }, 'edge_sensitivity_not_evidenced'],
      ['enrichment absent', (r) => { delete r.enrichment; }, 'edge_sensitivity_not_evidenced'],
      ["robust rows present, display_verdict 'not_assessed'", (r) => { rob(r).display_verdict = 'not_assessed'; }, 'edge_sensitivity_not_evidenced'],
      ['robust rows present, display_verdict absent (unobservable)', (r) => { delete rob(r).display_verdict; }, 'edge_sensitivity_not_evidenced'],
      ['normalization_errors non-empty', (r) => { rob(r).normalization_errors = [{ edge_type: 'fragile', error: 'bad row' }]; }, 'edge_sensitivity_not_evidenced'],
      ['normalization_errors not a list', (r) => { rob(r).normalization_errors = 'bad'; }, 'edge_sensitivity_not_evidenced'],
      ['fragile_edges absent', (r) => { delete rob(r).fragile_edges; }, 'edge_sensitivity_not_evidenced'],
      ['robust_edges empty', (r) => { rob(r).robust_edges = []; }, 'edge_sensitivity_not_evidenced'],
      ['robust_edges with no object row', (r) => { rob(r).robust_edges = ['a->b', null]; }, 'edge_sensitivity_not_evidenced'],
      ["companion unsafe (robustness_status 'failed')", (r) => { r.enrichment.robustness_status = 'failed'; }, 'claim_not_usable'],
    ];
    for (const [name, mutate, reason] of cases) {
      expect(run(withResult(runTurnCase('c10', 't5', 'explicit_run'), mutate)), name).toEqual(refused(reason));
    }
    // A hash the readback's result was not computed against.
    const c = runTurnCase('c10', 't5', 'explicit_run');
    expect(run({ ...c, final: { ...c.final, graphHash: 'fedcba9876543210' } })).toEqual(refused('identity_mismatch'));
    // Contrast: the unmodified run and an explicit 'computed' status build the card.
    expect(run(c).eligibility).toEqual({ eligible: true });
    expect(run(withResult(c, (r) => { r.enrichment.robustness_status = 'computed'; })).eligibility).toEqual({ eligible: true });
  });

  it('CARD-4b the builder is total on its own: identity repeated, freshness required', async () => {
    const { buildNoFlaggedLinkCard } = await import('../no-flagged-link-card.js');
    const c = runTurnCase('c10', 't5', 'explicit_run');
    const input = {
      analysisResult: structuredClone(c.final.analysisResult),
      graphHash: c.turn.graph_hash,
      computedAt: c.turn.analysis_state.run_state.computed_at,
      trigger: 'explicit_run' as const,
      freshness: 'fresh' as const,
    };
    expect(buildNoFlaggedLinkCard(input).reason).toBeNull();
    expect(buildNoFlaggedLinkCard({ ...input, graphHash: 'fedcba9876543210' })).toEqual({ block: null, reason: 'identity_mismatch' });
    expect(buildNoFlaggedLinkCard({ ...input, analysisResult: null })).toEqual({ block: null, reason: 'identity_mismatch' });
    expect(buildNoFlaggedLinkCard({ ...input, analysisResult: 'analysis_result' })).toEqual({ block: null, reason: 'identity_mismatch' });
    expect(buildNoFlaggedLinkCard({ ...input, freshness: null })).toEqual({ block: null, reason: 'claim_not_usable' });
    expect(buildNoFlaggedLinkCard({ ...input, freshness: 'stale' })).toEqual({ block: null, reason: 'claim_not_usable' });
  });

  it('CARD-5 the fragile ARRAY decides, not the fragile card\'s reason: an ungroundable fragile row means no card at all', () => {
    const unlabelled = withResult(runTurnCase('c10', 't5', 'explicit_run'), (r) => {
      rob(r).fragile_edges = [{ edge_id: 'a->b', from_id: 'a', to_id: 'b' }];
    });
    expect(run(unlabelled)).toEqual(refused('no_groundable_fragile_edge'));
    const idless = withResult(runTurnCase('c10', 't5', 'explicit_run'), (r) => {
      rob(r).fragile_edges = [{ from_label: 'Tech lead capacity', to_label: 'Velocity' }];
    });
    expect(run(idless)).toEqual(refused('no_groundable_fragile_edge'));
  });

  it('CARD-5b one run-turn card per run, on every fixture and trigger', () => {
    const runs: [FixtureLetter, string][] = [['A', 't5'], ['A', 't7'], ['B', 't2'], ['C', 'A2r'], ['c16', 't5'], ['c10', 't5'], ['c11', 't5']];
    let fragileSeen = 0;
    let noFlagSeen = 0;
    for (const [letter, turn] of runs) {
      for (const [label, c] of [
        ['explicit', runTurnCase(letter, turn, 'explicit_run')],
        ['auto trigger', runTurnCase(letter, turn, 'auto_first_pass')],
        ['first pass', firstPassCase(letter, turn)],
      ] as const) {
        const cards = runCards(run(c).blocks);
        expect(cards.length, `${letter}/${turn}/${label}`).toBeLessThanOrEqual(1);
        fragileSeen += cards.filter((b) => b.signal_id.startsWith('coach:fragile_link:')).length;
        noFlagSeen += noFlagCards(cards).length;
      }
    }
    // Controls: both card types occur in this sweep.
    expect(fragileSeen).toBeGreaterThan(0);
    expect(noFlagSeen).toBeGreaterThan(0);
  });

  it('CARD-6a the body says the check can only test what is in the model — never that it "only looks at links", and never the verdict\'s word "fragile"', () => {
    for (const firstPass of [false, true]) {
      const { body } = composeNoFlaggedLinkCard(firstPass);
      expect(body, `firstPass=${firstPass}`).not.toMatch(BODY_FORBIDDEN);
      expect(body, `firstPass=${firstPass}`).toMatch(/can only test what is already in the model, not what the model leaves out/);
      expect(body, `firstPass=${firstPass}`).toMatch(/single out any one link/);
    }
  });

  it('CARD-6 claim scope: bounded, gated, leader-free, number-free; the body names the flag and the check\'s limits, never a verdict', () => {
    const cards = [
      soleNoFlagCard(runTurnCase('c10', 't5', 'explicit_run')),
      soleNoFlagCard(runTurnCase('c11', 't5', 'auto_first_pass')),
    ];
    expect(cards.map((c) => c.body)).toEqual([BODY_EXPLICIT, BODY_FIRST_PASS]);
    for (const card of cards) {
      for (const field of USER_FACING) {
        const text = String(card[field]);
        expect(text.length, field).toBeLessThanOrEqual(LIMITS[field]);
        expect(passesGroundedProseGates(text), field).toBe(true);
        expect(text, field).not.toMatch(LEADER_WORDS);
        expect(findForbiddenPhraseHit(text), field).toBeNull();
        expect(text, field).not.toMatch(/\d/);
      }
      expect(card.body).not.toMatch(/\b(robust|stable|settled|held up|decides|assumption|factor)\b/i);
      // It says what the run shows about single links — none singled out — not a
      // sensitivity finding it does not have, and not in the verdict's word (CARD-6a).
      expect(card.body).toMatch(/didn't single out any one link/);
      expect(card.body).not.toMatch(/sensitive|insensitive/i);
      // Both directions stay open: what is in the model, and what it leaves out.
      expect(card.body).toMatch(/estimates are right/);
      expect(card.body).toMatch(/what the model leaves out/);
    }
    // Every option label of both runs stays out of every field.
    for (const letter of ['c10', 'c11'] as const) {
      const c = runTurnCase(letter, 't5', 'explicit_run');
      const card = soleNoFlagCard(c);
      for (const option of c.turn.analysis_ready.options) {
        for (const field of USER_FACING) expect(String(card[field]).toLowerCase(), `${letter} ${option.label}`).not.toContain(option.label.toLowerCase());
      }
    }
  });

  it('CARD-7 the click is not a typed Run or approval: a question turn that forbids choosing, changing or re-running', () => {
    const card = soleNoFlagCard(runTurnCase('c10', 't5', 'explicit_run'));
    expect(Object.hasOwn(card, 'action_intent')).toBe(false);
    expect(card.action_prompt).not.toBe(RUN_OFFER_CHIP.message);
    expect(card.action_label).not.toBe(RUN_OFFER_CHIP.label);
    expect(typedRunOf({ kind: 'message', message: card.action_prompt })).toBe(false);
    expect(typedApprovalOf({ kind: 'message', message: card.action_prompt })).toBeUndefined();
    const approvalMessages = ['propose_starting_point', 'propose_assumptions', 'propose_option_interventions', 'propose_model_change', 'propose_new_option']
      .flatMap((name) => approvalChipsFor([{ name, ok: true, mutated: false, proposal_id: 'prop_0123456789abcdef' }]))
      .map((chip) => chip.message);
    expect(approvalMessages).toContain(AMEND_CHIP.message);
    for (const message of approvalMessages) expect(card.action_prompt).not.toBe(message);
    expect(card.action_prompt).not.toMatch(/^\s*(?:yes|ok(?:ay)?|approve|go ahead|run)\b/i);
    expect(card.action_prompt).toContain('Don\'t choose for me');
    expect(card.action_prompt).toContain('don\'t change the model or re-run anything yet');
  });

  it('CARD-8 identity and currency bind like the fragile-link card: a re-run is a new block_id; one id never names two bodies', () => {
    const base = runTurnCase('c10', 't5', 'explicit_run');
    const moved = withComputedAt(base, '2026-09-24T16:52:00.000Z');
    const x = soleNoFlagCard(base);
    const y = soleNoFlagCard(moved);
    expect(y.block_id).not.toBe(x.block_id);
    expect(y.created_at).toBe('2026-09-24T16:52:00.000Z');
    expect(y.graph_hash_at_generation).toBe(x.graph_hash_at_generation);
    // The UI's currency rule for run_analysis cards reads exactly these three fields.
    expect(x.source_handler).toBe('run_analysis');
    expect(x.graph_hash_at_generation).toBe(base.turn.analysis_ready.current_graph_hash);
    expect(x.created_at).toBe(base.turn.analysis_state.run_state.computed_at);
    // Two triggers, two ids, two bodies; the same trigger again, the same id.
    const auto = soleNoFlagCard(runTurnCase('c10', 't5', 'auto_first_pass'));
    expect(auto.block_id).not.toBe(x.block_id);
    expect(auto.body).not.toBe(x.body);
    expect(soleNoFlagCard(runTurnCase('c10', 't5', 'auto_first_pass')).block_id).toBe(auto.block_id);
  });
});
