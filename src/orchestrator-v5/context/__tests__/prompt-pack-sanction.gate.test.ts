/**
 * PROMPT ↔ PACK SANCTION GATE
 * ===========================
 *
 * Motivating defect (2026-07-25): the served coach prompt `orchestrator_default`
 * v119 (hash 4e8e69f3d721c864, authored 2026-07-23) contains ZERO references to
 * `older_relevant_facts`, which PR #662 added to the ContextPack on 2026-07-24 —
 * while the same prompt instructs the model to "Use when present: <list>",
 * "Never reason over absent fields", and calls ungrounded continuity
 * "fabrication". The coach consequently denied decision records that were
 * verifiably in its pack and retracted its own correct answer as a fabrication
 * (9/13 turns). Nothing went red. See
 * parallel-briefs/COACH-RECORD-DENIAL-PROBE-2026-07-25.md.
 *
 * WHAT THIS GATE ASSERTS
 * ----------------------
 * Every PROSE-BEARING, model-facing ContextPack field must be NAMED somewhere in
 * the text the model actually receives — the PMS-served system prompt plus the
 * code-owned instruction blocks `buildUserMessage` appends.
 *
 * DERIVED, NOT MIRRORED (platform CLAUDE.md trap #12)
 * --------------------------------------------------
 *   - the field universe is read from `ContextPackSchema.shape` (static, no fixture);
 *   - the model-facing key set is OBSERVED from the REAL serialiser
 *     (`buildUserMessage` over a REAL `assembleContextPack` pack) — including
 *     `buildUserMessage`'s display_* → analysis/graph renames;
 *   - "prose-bearing" is computed from the field's REALISED serialised value,
 *     not from a list of "important" fields;
 *   - the served prompt is the PMS BYTES, identity-pinned by hash.
 *
 * THE FIXTURE CANNOT BE BLIND (trap #13)
 * -------------------------------------
 * A field the fixture leaves empty would look non-prose and the gate would pass
 * by testing nothing. {@link FIXTURE_COMPLETENESS} therefore asserts the fixture
 * populates EVERY schema-declared key before any sanction check runs. If a new
 * optional field is added and the fixture does not populate it, this gate goes
 * RED demanding fixture coverage — it never silently narrows its own scope.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname,join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe,expect,it } from 'vitest';

import {
assembleContextPack,
type ContextPack,
} from '../context-pack-assembler.js';
import { ContextPackSchema } from '../context-pack-schema.js';

import { makeMessagePayload } from '../../__tests__/fixtures.js';
// ONE shared extractor. This gate and the context-policy conformance anchor read
// the same serialised bytes; a private copy here would be a third variant of a
// parser whose naive form was a real defect in the anchor (see the helper's note).

const HERE = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// The served prompt — BYTES + identity pin
// ---------------------------------------------------------------------------

/**
 * The PMS-served routing prompt, checked in as a SNAPSHOT so CI is hermetic.
 *
 * A snapshot is a mirror, so it is pinned FAIL-LOUD two ways:
 *   - {@link SERVED_PROMPT_SHA256_16} pins these exact bytes; and
 *   - the LIVE tier (`scripts/verify-served-prompt.mjs`, run on deploy and on a
 *     schedule) re-reads `/admin/prompts/status` and fails when the live
 *     `sent_hash` differs from this pin. The prompt is re-pinnable in PMS with
 *     NO deploy, so CI alone can never be the whole gate.
 */
const SERVED_PROMPT_PATH = join(HERE, 'fixtures', 'served-orchestrator-prompt.txt');
// ⚠ AHEAD OF PMS from 2026-08-29 until the operator uploads these bytes as
// orchestrator_default v121 and re-pins staging. Live still serves v120
// (`adcc5128d4e6e6bc`), so the LIVE tier below is EXPECTED to red in that
// window — that is the alarm working, not a broken one. See the
// `pending_pms_upload` block on the `routing` row of Prompts/canonical/manifest.json.
const SERVED_PROMPT_SHA256_16 = 'bec840a648800928'; // orchestrator_default v121 (pending upload)
const SERVED_PROMPT = readFileSync(SERVED_PROMPT_PATH, 'utf8');

/**
 * PERMANENT historical control fixture — `orchestrator_default` v119
 * (`4e8e69f3d721c864`), the prompt that was live when the coach denied stored
 * decision records and called its own correct answer a fabrication.
 *
 * It is pinned SEPARATELY from the live snapshot on purpose. The positive
 * controls below must keep proving this gate catches the ORIGINAL defect no
 * matter how many times the served prompt is re-pinned. When the live snapshot
 * moved v119 -> v120 those controls silently went VACUOUS (v120 sanctions
 * `older_relevant_facts`, so "the gate catches it" was passing by testing
 * nothing) — the exact trap #13 shape, inside the controls written to prevent it.
 */
const HISTORICAL_V119_PATH = join(HERE, 'fixtures', 'served-orchestrator-prompt-v119-historical.txt');
const HISTORICAL_V119_SHA256_16 = '4e8e69f3d721c864';
const HISTORICAL_V119 = readFileSync(HISTORICAL_V119_PATH, 'utf8');

function shortSha256(s: string): string {
  return createHash('sha256').update(s).digest('hex').slice(0, 16);
}

/**
 * The COMPLETE text the model receives about pack fields: the PMS system prompt
 * plus the two code-owned instruction blocks `buildUserMessage` appends. Both
 * blocks are emitted by the SAME condition that puts their field on the pack
 * (co-located conditional sanctioning), so a field sanctioned only there is
 * genuinely sanctioned — checking the PMS prompt alone would false-fire on
 * `conversation_summary` and `coaching_context`.
 */
/**
 * The code-owned instruction blocks, NAMED so the corpus and the emission
 * assertion below are single-sourced (CLAUDE.md trap 12 — a second hand-written
 * list of these would drift silently, and the drift always reads as green).
 * Adding an instruction here puts it in the sanctioning corpus AND under the
 * EMISSION check in one edit; there is no way to gain sanctioning power without
 * also having to prove the prompt actually carries it.
 */




/** The same corpus composition, built from the v119 historical control prompt. */


/**
 * Waivers for divergences already FOUND and TRIAGED but not yet fixed (the
 * prompt is owned by another lane). Each is keyed to the prompt hash it was
 * ratified against: when the prompt changes, every waiver EXPIRES and the gate
 * goes RED demanding re-ratification. A waiver can therefore never quietly
 * outlive the prompt it was granted for — and the gate is never permanently
 * red, which would make it an alarm everyone learns to ignore.
 */


// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

/** Keys `buildUserMessage` deliberately strips before serialising. */


/**
 * DERIVED severity discriminator: does this field's REALISED serialised value
 * carry natural language the model could quote or ground a claim on? A field of
 * identifiers, booleans, enums or numbers (`scenario_id`, `compound_detected`)
 * is control metadata the model never speaks; a field carrying sentences is
 * content the model must be told it may trust.
 */


/**
 * A field is AT RISK only if it carries prose the model cannot ground anywhere
 * else. The served prompt's own rule 1 reads:
 *
 *   "GROUND. Every decision-specific or quantitative claim comes from
 *    ContextPack **or the user's message**."
 *
 * so prose that is merely a restatement of the CURRENT user turn is grounded by
 * rule 1 regardless of whether its field is named. `compound_segments` (a
 * substring decomposition of the user's own message) is the case this excludes —
 * it flagged on the first run and is a genuine false positive, because the model
 * has the user's message verbatim. `older_relevant_facts` and `brief` carry
 * prose that appears NOWHERE else, so they remain at risk.
 */


/** Whole-token match — `graph` must not be satisfied by `display_graph`. */


// ---------------------------------------------------------------------------
// The MAXIMAL fixture — every optional field populated (see FIXTURE_COMPLETENESS)
// ---------------------------------------------------------------------------

/** The single user turn — production passes the SAME text to the assembler
 *  payload and to buildUserMessage, so the fixture must too. */
const USER_MESSAGE = 'increase the price to 45000 and run the analysis';

/**
 * FIXTURE_COMPLETENESS for `run_delta`: the maximal fixture must POPULATE the
 * field or the gate narrows its own scope (trap #13). That takes a genuine
 * pair — `buildRunDelta` is a real producer over real persisted facts and
 * refuses anything it cannot honestly classify, so there is no way to fake this
 * field into existence, which is precisely the property that makes it worth
 * having.
 *
 * REALISTIC, NOT MAXIMAL-IN-THE-ABSTRACT (the `systemEvent` lesson below): the
 * option ids are the SAME ids the `ANALYSIS` fixture carries, because in
 * production the model resolves a `run_delta` option id to a label through the
 * `analysis` block. A pair with unrelated ids would populate the key while
 * describing a pack that could never occur.
 *
 * Each fact carries the four PRODUCER ECHOES the producer requires
 * (`seed_used`, `graph_hash_at_run`, `_meta.builds`, `n_samples`) plus its own
 * leader-claim verdict — all read off the envelope, never self-reported.
 */
function runAnalysisFact(
  win: readonly (readonly [string, number])[],
  seed: string,
  hash: string,
  at: string,
): unknown {
  return {
    fact_type: 'run_analysis',
    noop: false,
    result: {
      enrichment: {
        analysis_status: 'completed',
        results: win.map(([option_id, win_probability]) => ({
          option_id,
          option_label: option_id === 'opt_local' ? 'Hire locally' : 'Offshore partner',
          win_probability,
        })),
        meta: { seed_used: seed, n_samples: 10_000 },
        _meta: { builds: { plot: 'p1', isl: 'i1' } },
      },
      computed_at: at,
      graph_hash_at_run: hash,
      constraint_verdict: {
        may_name_leading_option: true,
        constraint_verdict_state: 'evaluated_feasible',
      },
    },
  };
}

/** Newest-first, exactly how the turn loader delivers `prior_facts`. */
/**
 * FIXTURE_COMPLETENESS: `stated_objections` is a schema-declared key, so the
 * maximal fixture must populate it or this gate narrows its own scope.
 *
 * ⚠ THE STATEMENT IS DELIBERATELY PROSE-LENGTH, and that is not cosmetic — it
 * is what makes THE GATE cover this field at all. `proseLeaves` only collects
 * strings of >= 4 words; a one-word objection scores ZERO prose leaves and the
 * gate would pass the field by testing nothing. That is the same fixture-
 * contingent blindness measured on `factor_values` above, and a real user's
 * stated reason is prose by construction — the contract bounds it at 2000
 * characters precisely because people write sentences.
 *
 * ⚠ APPENDED OLDEST (last) so the two-newest `run_analysis` selection that
 * `run_delta` depends on is untouched by this addition.
 */
const FINDING_DISSENT_FACT = {
  fact_type: 'finding_dissent',
  fact_version: 1,
  noop: false,
  result: {
    finding_id: 'strengthen:robustness',
    analysis_id: 'hash-b',
    statement:
      'The ranking is called fragile because the salary estimate moves it, but our local salary band is fixed by a pay framework we renegotiate only in April, so that input cannot move this year.',
    provenance: 'user_set',
  },
} as unknown;

const RUN_DELTA_PRIOR_FACTS = [
  runAnalysisFact([['opt_local', 0.62], ['opt_offshore', 0.38]], '222', 'hash-b', '2026-07-25T00:00:00Z'),
  runAnalysisFact([['opt_local', 0.41], ['opt_offshore', 0.59]], '111', 'hash-a', '2026-07-24T00:00:00Z'),
  FINDING_DISSENT_FACT,
];

const ANALYSIS = {
  winner: { option_id: 'opt_local', option_label: 'Hire locally', win_probability: 0.62 },
  options: [
    { option_id: 'opt_local', option_label: 'Hire locally', win_probability: 0.62 },
    { option_id: 'opt_offshore', option_label: 'Offshore partner', win_probability: 0.38 },
  ],
  // The REAL upstream `DriverSummary` shape: `{factor_id, factor_label,
  // sensitivity, direction}`. This fixture previously used `sensitivity_value`,
  // which `projectTopDrivers` filters out via `isFiniteSensitivity(d.sensitivity)`
  // — so the pack carried `top_drivers: []` and this gate had never once seen
  // the field populated. Corrected; the gate stays green, so nothing was being
  // masked today, but it was one field away from being unable to see a leak.
  top_drivers: [
    { factor_id: 'factor_salary', factor_label: 'Engineer salary in the local market', sensitivity: 0.4, direction: 'positive' },
  ],
  robustness_level: 'moderate',
  fragile_edge_count: 1,
  margin: 0.24,
  margin_pp: 24,
  analysis_status: 'computed',
} as unknown as Parameters<typeof assembleContextPack>[0]['analysis'];

function assembleMaximalPack(
  overrides: Partial<Parameters<typeof assembleContextPack>[0]> = {},
): ContextPack {
  return assembleContextPack({
    payload: makeMessagePayload({
      scenario_id: 'scen-sanction-gate',
      // Trips the compound detector (action verb either side of a conjunction)
      // AND carries a parseable quantity, so `compound_detected`,
      // `compound_segments`, `compound_pattern_matched` and `parsed_quantities`
      // all populate.
      message: USER_MESSAGE,
    }),
    priorTurns: [
      {
        turn_id: 't1',
        turn_class: 'converse',
        handler_id: null,
        created_at: '2026-07-24T00:00:00Z',
        user_message: 'What are my options here, and which looks stronger?',
        assistant_message: 'You have two options set up on the canvas right now.',
      } as never,
    ],
    priorFacts: RUN_DELTA_PRIOR_FACTS as never,
    // FIXTURE_COMPLETENESS: `run_delta` is a schema-declared key, so the
    // maximal fixture must populate it. The MAXIMAL arm is the ENTITLED one —
    // leader ids present on both sides — so the gate sees the field at its
    // widest. The withheld arm and the refusal arm are exercised in
    // run-delta-wire.route-level.test.ts, which is where their defects live.
    mayNameLeadingOption: true,
    analysis: ANALYSIS,
    brief:
      'Should we hire two senior engineers locally or engage an offshore partner? Budget 250k, decision needed by Q3.',
    conversationSummary: {
      text: 'FRAME: a hiring decision for the new tier. RESOLVED: two options now sit on the canvas.',
      current_to_turn_id: 't1',
      lag_turns: 2,
      stale: false,
    } as never,
    olderRelevantFacts:
      'Prior decisions recorded on this scenario (most recent first):\n- [2026-07-25] Chose "Hybrid Deployment": contract signed off by Thistlewood-Okafor.',
    graphContext: { status: 'canonical' },
    // `systemEvent` is DELIBERATELY not supplied. A complete producer sweep of
    // the repo (`grep -rn 'systemEvent\s*:' src`) finds ZERO production callers:
    // system-event turns are handled in a deterministic pre-TurnExecutor branch
    // (turn-executor.ts:636) and never reach routing pack assembly. The
    // assembler emits `system_event: null` unconditionally, so the key IS
    // present for FIXTURE_COMPLETENESS, and `null` is its true production
    // state. Populating it with invented prose here manufactured a FALSE
    // POSITIVE on the first run of this gate — the fixture must be REALISTIC,
    // not maximal-in-the-abstract.
    // Hop 4 — FIXTURE_COMPLETENESS: `focus` is a schema-declared key, so the
    // maximal fixture must populate it or this gate narrows its own scope. A
    // REALISTIC selection: one element that resolves against the fixture graph
    // (so the projected labels are genuine prose the gate must see sanctioned),
    // plus one that does not, so the `unresolved` disclosure is exercised too.
    selection: {
      requested_ids: ['dec_hire', 'ghost_node'],
      elements: [
        {
          id: 'dec_hire',
          kind: 'decision',
          label: 'Hire two senior engineers locally',
        },
      ],
      unresolved_ids: ['ghost_node'],
      graph_read: 'ok_present',
      // Required on TurnSelection; empty for every node selection. This fixture
      // is cast `as never`, so the compiler cannot enforce it here — the
      // omission surfaced as a RUNTIME throw in this suite, not a type error.
      unreadable_ref_ids: [],
    } as never,
    coachingContext: {
      analysis_present: true,
      freshness: 'fresh',
      readiness_status: 'ready',
      rerun_required: false,
      usable_for_prose: true,
      usable_for_chips: true,
      blocked: false,
      actionable_blocker_count: 0,
    } as never,
    // FIXTURE_COMPLETENESS: `readiness` is a schema-declared key, so the
    // maximal fixture must populate it or this gate narrows its own scope.
    // REALISTIC, not maximal-in-the-abstract: the shape of the deployed defect
    // — a non-ready status with two human-input blockers, each carrying the
    // recovery authority's next step as genuine prose the gate must see
    // sanctioned.
    readiness: {
      status: 'needs_user_input',
      open_items: [
        {
          kind: 'option_needs_encoding',
          description: 'give "Churn rate" a value so the model can run',
          option_label: 'Churn rate',
        },
        {
          kind: 'option_needs_encoding',
          description: 'give "Onboarding time" a value so the model can run',
          option_label: 'Onboarding time',
        },
      ],
    } as never,
    // FIXTURE_COMPLETENESS: `goal_target` is a schema-declared key, so the
    // maximal fixture must populate it. The `set` arm is the MAXIMAL one (it
    // carries value AND unit); the `unset` arm is exercised by
    // record-vs-transcript-boundary.test.ts, which is where the defect this
    // field closes actually lives.
    goalTarget: { status: 'set', value: 15, unit: '%' } as never,
    // FIXTURE_COMPLETENESS: `factor_values` is a schema-declared key, so the
    // maximal fixture must populate it. MAXIMAL means every optional key AND a
    // mixed population — a valued factor, a valueless one, and the witnessed
    // shape (valueless YET stamped as an AI estimate), so the two axes cannot
    // silently collapse into one here either. The zero case
    // (`without_value_count: 0`) is exercised in factor-value-record.test.ts.
    factorValues: {
      factors: [
        // ⚠ AT LEAST ONE LABEL MUST BE PROSE-LENGTH, AND THAT IS NOT COSMETIC —
        // it is what makes THE GATE cover this field at all. `proseLeaves` only
        // collects strings of >= 4 words; with only short labels `factor_values`
        // scores ZERO prose leaves and the gate passes it by testing nothing.
        // MEASURED, three runs: short labels − registration → 21/21 GREEN (the
        // gate is blind); ONE six-word label − registration → THE GATE REDs
        // naming `factor_values`; long label + registration → GREEN. The gate
        // was one label away from being the thing that would have caught the
        // mute-field defect it exists to catch.
        //
        // These lengths are REPRESENTATIVE, not padding: `label` is
        // `z.string().min(1)` with NO maximum, and this very fixture already
        // carries `factor_label: 'Engineer salary in the local market'` (six
        // words) and eleven-word graph node labels.
        // FACTOR_VALUES_PROSE_COVERAGE below pins this so a tidy-up cannot
        // silently return the field to being uncovered.
        { label: 'Monthly churn rate across enterprise accounts', has_value: true, provenance: 'user_stated' },
        { label: 'Onboarding time for new enterprise customers', has_value: false, provenance: 'ai_drafted' },
        { label: 'Support load', has_value: false, provenance: 'unattributed' },
      ],
      without_value_count: 2,
      factors_omitted: 1,
    } as never,
    // A LARGE COMPACT graph — production supplies `compactedGraph`, and it is
    // the input the context-budget module actually trims, so this is what makes
    // the pack carry the `context_budget` disclosure key (FIXTURE_COMPLETENESS).
    compactedGraph: {
      nodes: [
        { id: 'dec_hire', kind: 'decision', label: 'Hire two senior engineers locally' },
        { id: 'goal_rev', kind: 'goal', label: 'Revenue growth over the next year' },
        ...Array.from({ length: 4000 }, (_, i) => ({
          id: `factor_${i}`,
          kind: 'factor',
          label: `Cost driver ${i} affecting the delivery schedule and the quarterly revenue outlook`,
          note: 'padding to push the compacted graph past the 25% graph slice of the context budget',
        })),
      ],
      edges: Array.from({ length: 4000 }, (_, i) => ({
        from: `factor_${i}`,
        to: 'goal_rev',
        relationship: 'increases',
      })),
      _node_count: 4002,
      _edge_count: 4000,
    } as never,
    graph: {
      nodes: [
        { id: 'dec_hire', kind: 'decision', label: 'Hire two senior engineers locally' },
        { id: 'goal_rev', kind: 'goal', label: 'Revenue growth over the next year' },
        ...Array.from({ length: 2200 }, (_, i) => ({
          id: `factor_${i}`,
          kind: 'factor',
          label: `Cost driver ${i} affecting the delivery schedule and the quarterly revenue outlook`,
        })),
      ],
      edges: [
        { from: 'dec_hire', to: 'goal_rev', strength: { mean: 0.4, std: 0.1 } },
        ...Array.from({ length: 2200 }, (_, i) => ({
          from: `factor_${i}`,
          to: 'goal_rev',
          strength: { mean: 0.3, std: 0.1 },
        })),
      ],
    } as never,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// The two DISCRIMINATORS, as pure functions (so the controls below can drive
// them with arbitrary prompt/pack pairs — a gate whose logic is only reachable
// through its own happy path cannot be proven to discriminate).
// ---------------------------------------------------------------------------

/** Model-facing fields carrying prose the corpus never names. */


/** ContextPack paths the prompt's <CONTEXT_PACK> zone names but the pack lacks. */


/**
 * Schema-declared keys the assembled pack does NOT carry. This is the gate's
 * anti-blindness check, extracted as a pure function so the control below
 * drives THIS code and not a re-implementation of it. (The first mutation run
 * of this gate proved why: an always-pass FIXTURE_COMPLETENESS turned nothing
 * red, because the control had re-derived the set itself.)
 */
export function findUnpopulatedFields(pack: ContextPack): string[] {
  const onPack = new Set(Object.keys(pack));
  return Object.keys(ContextPackSchema.shape).filter((k) => !onPack.has(k));
}

function findUnpopulatedFieldsAcross(packs: readonly ContextPack[]): string[] {
  const onPacks = new Set(packs.flatMap((pack) => Object.keys(pack)));
  return Object.keys(ContextPackSchema.shape).filter((key) => !onPacks.has(key));
}

/** Hash-keyed waivers, applied uniformly to both discriminators. */


// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

const PACK = assembleMaximalPack();
const UNAVAILABLE_PACK = assembleMaximalPack({
  modelFacingClaimSafety: {
    status: 'withheld',
    constraintVerdictState: null,
    provenance: 'fail_closed_unavailable',
  },
});
/**
 * `analysis_context.status` is ONE field with mutually exclusive values, so a
 * single maximal pack can never render both its instructions — which is exactly
 * why the corpus below is a set of packs rather than one. This is the
 * `provisional_figures` sibling: the analysis IS established and separable, and
 * the admission merely caps the mode, so the pack keeps its full
 * `display_analysis` and gains the qualification instruction.
 */
const PROVISIONAL_PACK = assembleMaximalPack({
  modelFacingClaimSafety: { status: 'qualified', mode: 'quantified_provisional' },
});
/**
 * The message `buildUserMessage` ACTUALLY renders — kept, not discarded. The
 * gate previously parsed the pack out of this and threw the prompt away, which
 * is why it could certify a field as sanctioned by an instruction the prompt
 * did not contain (see EMISSION below).
 */







describe('prompt ↔ pack sanction gate', () => {
  it('IDENTITY — both pinned prompts are the bytes they claim to be', () => {
    expect(shortSha256(SERVED_PROMPT)).toBe(SERVED_PROMPT_SHA256_16);
    // The historical control fixture must never silently drift either.
    expect(shortSha256(HISTORICAL_V119)).toBe(HISTORICAL_V119_SHA256_16);
  });

  it('FIXTURE_COMPLETENESS — the fixture populates every schema-declared key (this gate can never be blind)', () => {
    const unpopulated = findUnpopulatedFieldsAcross([PACK, UNAVAILABLE_PACK, PROVISIONAL_PACK]);
    expect(
      unpopulated,
      `The gate's fixture does not populate ${unpopulated.join(', ')}. A field the fixture ` +
        'leaves empty reads as non-prose and would pass this gate by testing nothing ' +
        '(trap #13). Populate it in assembleMaximalPack.',
    ).toEqual([]);
  });

  it('SCHEMA_PARITY — the assembler emits no key the schema does not declare (.passthrough() drift)', () => {
    const declared = new Set(Object.keys(ContextPackSchema.shape));
    expect(Object.keys(PACK).filter((k) => !declared.has(k))).toEqual([]);
    expect(Object.keys(UNAVAILABLE_PACK).filter((k) => !declared.has(k))).toEqual([]);
  });



  /**
   * F2 (independent review of PR #1111) — THE CORPUS MUST BE EVIDENCE, NOT A
   * CLAIM.
   *
   * `MODEL_FACING_CORPUS` is composed from exported CONSTANTS. Importing a
   * constant proves it was authored; it proves nothing about whether
   * `buildUserMessage` ever puts it in front of the model. So the gate could
   * certify a field as "sanctioned" on the strength of an instruction the
   * rendered prompt did not contain — and that is not hypothetical: deleting
   * the production emission block left this gate 15/15 GREEN while five tests
   * in sibling suites went red. A waiver removed from KNOWN_UNSANCTIONED on
   * that evidence would be trading a recorded known gap for a false claim.
   *
   * This assertion closes the loop by checking the ONE artefact that settles
   * it: the message the model actually receives. It REDs under that mutant.
   *
   * It is deliberately placed BEFORE `THE GATE`: it is the precondition that
   * makes the gate's corpus mean anything, and a reader should meet it first.
   */


  /**
   * ⭐⭐ THE UNMIRRORED LIST, DERIVED. `CODE_OWNED_INSTRUCTIONS` above is
   * hand-written, and on 2026-08-27 it was found SHORT: `buildUserMessage`
   * emitted NINE instruction blocks and this list registered EIGHT, so
   * `OLDER_RELEVANT_FACTS_INSTRUCTION` sat outside the EMISSION check entirely.
   * A hand-maintained list drifting silently, inside the gate built to catch a
   * hand-maintained list drifting silently (platform CLAUDE.md trap 12).
   *
   * This derives the emission set from the SOURCE of `buildUserMessage`, so the
   * registration list can never again be short without a RED. It is deliberately
   * one-directional: registered → rendered is already covered by EMISSION above;
   * this closes emitted → registered.
   */


  /**
   * ⭐ THIS GATE'S COVERAGE OF `factor_values` IS FIXTURE-CONTINGENT — pin it, or
   * it decays silently (trap 12b: a control that quietly stops discriminating).
   * `proseLeaves` needs >= 4 words; shorten these labels and the field scores
   * zero prose leaves and THE GATE passes it by testing nothing. Measured: that
   * is a 21/21 GREEN over a completely unsanctioned field.
   */












  it('ANALYSIS AUTHORITY — schema rejects broader statuses and extra members', () => {
    const schema = ContextPackSchema.shape.analysis_context;
    expect(schema.safeParse({ status: 'canonical' }).success).toBe(false);
    expect(
      schema.safeParse({ status: 'unavailable', reason: 'db_timeout' }).success,
    ).toBe(false);
    expect(schema.safeParse({ status: 'unavailable' }).success).toBe(true);
  });

  it('ANALYSIS AUTHORITY — schema rejects every contradictory unavailable prompt state', () => {
    expect(ContextPackSchema.safeParse(UNAVAILABLE_PACK).success).toBe(true);

    const displayContradiction = {
      ...UNAVAILABLE_PACK,
      display_analysis: { leading_option: { label: 'Forged leader' } },
    };
    expect(ContextPackSchema.safeParse(displayContradiction).success).toBe(
      false,
    );

    const focusContradiction = {
      ...UNAVAILABLE_PACK,
      focus: {
        ...UNAVAILABLE_PACK.focus!,
        elements: [
          {
            ...UNAVAILABLE_PACK.focus!.elements[0]!,
            analysis_link: 'analysis_unavailable' as const,
            analysis: { win_probability: '83%' },
          },
        ],
      },
    };
    expect(ContextPackSchema.safeParse(focusContradiction).success).toBe(false);

    const healthyAbsenceContradiction = {
      ...UNAVAILABLE_PACK,
      focus: {
        ...UNAVAILABLE_PACK.focus!,
        elements: [
          {
            ...UNAVAILABLE_PACK.focus!.elements[0]!,
            analysis_link: 'no_analysis' as const,
            analysis: undefined,
          },
        ],
      },
    };
    expect(ContextPackSchema.safeParse(healthyAbsenceContradiction).success).toBe(
      false,
    );

    const missingMarker = {
      ...UNAVAILABLE_PACK,
      analysis_context: undefined,
    };
    expect(ContextPackSchema.safeParse(missingMarker).success).toBe(false);

    const coachingContradiction = {
      ...UNAVAILABLE_PACK,
      coaching: {
        ...UNAVAILABLE_PACK.coaching,
        last_coaching_signal: {
          signal_id: 'FIRST_ANALYSIS_COMPLETE',
          turn_id: 'turn-forged',
          produced_at: '2026-08-27T09:00:00.000Z',
        },
      },
    };
    expect(ContextPackSchema.safeParse(coachingContradiction).success).toBe(
      false,
    );
  });










});

// ---------------------------------------------------------------------------
// POSITIVE CONTROLS — trap #13. An absence assertion is vacuous unless the
// instrument is first PROVEN able to see a presence. Every control below drives
// the REAL discriminators with the REAL served prompt bytes.
// ---------------------------------------------------------------------------

describe('POSITIVE CONTROLS — the gate catches the defect that motivated it', () => {














  it('FIXTURE-BLINDNESS CONTROL — an unpopulated field is CAUGHT, not silently skipped', () => {
    // Simulates "a new optional field lands and nobody updates the fixture".
    const thinPack = assembleMaximalPack({ brief: undefined });
    // Drives the GATE'S OWN function — so an always-pass mutation of it goes RED.
    expect(findUnpopulatedFields(thinPack)).toContain('brief');
    // ...and the two realistic mutually-exclusive fixtures are complete in
    // combination: healthy coaching and unavailable-analysis cannot share one
    // model-facing prompt without creating a false absence claim.
    expect(findUnpopulatedFieldsAcross([PACK, UNAVAILABLE_PACK])).toEqual([]);
  });
});
