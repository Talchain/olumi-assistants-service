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

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  assembleContextPack,
  type ContextPack,
} from '../context-pack-assembler.js';
import { ContextPackSchema } from '../context-pack-schema.js';
import {
  buildUserMessage,
  COACHING_CONTEXT_INSTRUCTION,
  SUMMARY_PRECEDENCE_INSTRUCTION,
  FOCUS_INSTRUCTION,
  READINESS_INSTRUCTION,
  GOAL_TARGET_INSTRUCTION,
  BRIEF_INSTRUCTION,
  GRAPH_CONTEXT_INSTRUCTION,
  SOURCE_QUOTES_INSTRUCTION,
} from '../../routing/route-with-tool-use.js';
import { compactSelectedGraphForContextPack } from '../compact-graph-for-contextpack.js';
import { selectContextGraphSnapshot } from '../context-graph-snapshot.js';
import { bindCanonicalNodeSourceEvidence } from '../node-source-quote-context.js';
import { makeMessagePayload } from '../../__tests__/fixtures.js';
// ONE shared extractor. This gate and the context-policy conformance anchor read
// the same serialised bytes; a private copy here would be a third variant of a
// parser whose naive form was a real defect in the anchor (see the helper's note).
import { observeSerialisedPack } from './observe-serialised-pack.js';

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
const SERVED_PROMPT_SHA256_16 = 'adcc5128d4e6e6bc'; // orchestrator_default v120
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
const CODE_OWNED_INSTRUCTIONS = [
  ['GRAPH_CONTEXT_INSTRUCTION', GRAPH_CONTEXT_INSTRUCTION],
  ['COACHING_CONTEXT_INSTRUCTION', COACHING_CONTEXT_INSTRUCTION],
  ['SUMMARY_PRECEDENCE_INSTRUCTION', SUMMARY_PRECEDENCE_INSTRUCTION],
  // Hop 4 (selection-aware answering). Emitted by the SAME condition that puts
  // `focus` on the pack, so a field sanctioned only here is genuinely
  // sanctioned — the same reasoning as its two siblings above.
  ['FOCUS_INSTRUCTION', FOCUS_INSTRUCTION],
  // Readiness. Emitted by the SAME condition that puts `readiness` on the pack
  // — same reasoning as its three siblings above. The served PMS prompt cannot
  // sanction it (it is operator-managed and not editable from this repo), which
  // is precisely why the instruction is code-owned.
  ['READINESS_INSTRUCTION', READINESS_INSTRUCTION],
  // Success target. Emitted by the SAME condition that puts `goal_target` on
  // the pack — same reasoning as its four siblings above. Like `readiness`, the
  // served PMS prompt cannot sanction it (operator-managed, not editable from
  // this repo), which is exactly why the instruction is code-owned.
  ['GOAL_TARGET_INSTRUCTION', GOAL_TARGET_INSTRUCTION],
  // Saved opening framing. Emitted by the SAME condition that puts `brief` on
  // the pack. It licences continuity while keeping historical framing below
  // the current Living Model and explicit current-user corrections.
  ['BRIEF_INSTRUCTION', BRIEF_INSTRUCTION],
  // Exact recorded node wording. The maximal fixture below uses the real
  // selector-aware strict compaction path and contains both one retained quote
  // and one 513-code-point withheld quote, so emission cannot pass vacuously.
  ['SOURCE_QUOTES_INSTRUCTION', SOURCE_QUOTES_INSTRUCTION],
] as const satisfies ReadonlyArray<readonly [string, string]>;

const MODEL_FACING_CORPUS = [
  SERVED_PROMPT,
  ...CODE_OWNED_INSTRUCTIONS.map(([, text]) => text),
].join('\n\n');

/** The same corpus composition, built from the v119 historical control prompt. */
const HISTORICAL_V119_CORPUS = [
  HISTORICAL_V119,
  COACHING_CONTEXT_INSTRUCTION,
  SUMMARY_PRECEDENCE_INSTRUCTION,
].join('\n\n');

/**
 * Waivers for divergences already FOUND and TRIAGED but not yet fixed (the
 * prompt is owned by another lane). Each is keyed to the prompt hash it was
 * ratified against: when the prompt changes, every waiver EXPIRES and the gate
 * goes RED demanding re-ratification. A waiver can therefore never quietly
 * outlive the prompt it was granted for — and the gate is never permanently
 * red, which would make it an alarm everyone learns to ignore.
 */
const KNOWN_UNSANCTIONED: ReadonlyArray<{
  readonly field: string;
  readonly promptSha: string;
  readonly note: string;
}> = [
  {
    field: 'analysis.staleness_reason',
    promptSha: 'adcc5128d4e6e6bc',
    note: 'FOUND BY THIS GATE (PHANTOM — the INVERSE drift), STILL OPEN AT v120. The served prompt tells the model to use "analysis.staleness_reason (acknowledge before citing results)", but state-trust phase 0 deliberately removed that field from the prompt-visible projection and ContextPackAnalysisSchema is .strict(), so it CANNOT reappear. A dead instruction on every turn. Carried unchanged from v119 into v120.',
  },
];

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

/** Keys `buildUserMessage` deliberately strips before serialising. */
const STRIPPED_BY_SERIALISER = ['display_analysis', 'display_graph', 'analysis_state'] as const;

/**
 * DERIVED severity discriminator: does this field's REALISED serialised value
 * carry natural language the model could quote or ground a claim on? A field of
 * identifiers, booleans, enums or numbers (`scenario_id`, `compound_detected`)
 * is control metadata the model never speaks; a field carrying sentences is
 * content the model must be told it may trust.
 */
function proseLeaves(v: unknown): string[] {
  const out: string[] = [];
  const walk = (x: unknown): void => {
    if (typeof x === 'string') {
      if (x.trim().split(/\s+/).length >= 4) out.push(x.trim());
      return;
    }
    if (Array.isArray(x)) return x.forEach(walk);
    if (x && typeof x === 'object') Object.values(x as object).forEach(walk);
  };
  walk(v);
  return out;
}

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
function unsanctionableProse(v: unknown, userMessage: string): string[] {
  const hay = userMessage.toLowerCase();
  return proseLeaves(v).filter((leaf) => !hay.includes(leaf.toLowerCase()));
}

/** Whole-token match — `graph` must not be satisfied by `display_graph`. */
function namedInCorpus(field: string, corpus = MODEL_FACING_CORPUS): boolean {
  return new RegExp(`(?<![A-Za-z0-9_])${field}(?![A-Za-z0-9_])`).test(corpus);
}

// ---------------------------------------------------------------------------
// The MAXIMAL fixture — every optional field populated (see FIXTURE_COMPLETENESS)
// ---------------------------------------------------------------------------

/** The single user turn — production passes the SAME text to the assembler
 *  payload and to buildUserMessage, so the fixture must too. */
const USER_MESSAGE = 'increase the price to 45000 and run the analysis';

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

function buildAttestedSourceQuoteFixture() {
  const graph = {
    nodes: [
      {
        id: 'dec_hire',
        kind: 'decision',
        label: 'Hire two senior engineers locally',
        source_quote: 'Should we build the team locally?',
        label_authored: true,
      },
      {
        id: 'goal_rev',
        kind: 'goal',
        label: 'Revenue growth over the next year',
        source_quote: 'x'.repeat(513),
        label_authored: true,
      },
      { id: 'opt_local', kind: 'option', label: 'Hire locally' },
      { id: 'factor_salary', kind: 'factor', label: 'Engineer salary in the local market' },
    ],
    edges: [
      {
        from: 'factor_salary',
        to: 'goal_rev',
        strength: { mean: 0.4, std: 0.1 },
        exists_probability: 0.9,
        effect_direction: 'positive',
        provenance: { source: 'brief_extraction' },
      },
    ],
  } as never;
  const selection = selectContextGraphSnapshot({
    canonicalRead: { status: 'ok_present', graph },
    requestGraph: null,
  });
  const outcome = compactSelectedGraphForContextPack(selection, {
    requestId: 'req-prompt-sanction-source-quotes',
  });
  if (outcome.kind !== 'compacted' || outcome.via !== 'strict_parse') {
    throw new Error('prompt sanction fixture must produce canonical strict compaction');
  }
  return outcome.compact;
}

const ATTESTED_SOURCE_QUOTE_COMPACT = buildAttestedSourceQuoteFixture();

function assembleMaximalPack(
  overrides: Partial<Parameters<typeof assembleContextPack>[0]> = {},
): ContextPack {
  const input: Parameters<typeof assembleContextPack>[0] = {
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
    priorFacts: [],
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
        { label: 'Churn rate', has_value: true, provenance: 'user_stated' },
        { label: 'Onboarding time', has_value: false, provenance: 'ai_drafted' },
        { label: 'Support load', has_value: false, provenance: 'unattributed' },
      ],
      without_value_count: 2,
      factors_omitted: 1,
    } as never,
    // Real selector-aware canonical strict compaction. Its retained quote plus
    // 513-code-point withheld sibling populate BOTH the display feature and
    // `context_budget.source_quotes`, so the sanction/emission gate proves the
    // actual path rather than a hand-built marker.
    compactedGraph: ATTESTED_SOURCE_QUOTE_COMPACT,
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
  };
  const basePack = assembleContextPack(input);
  return bindCanonicalNodeSourceEvidence({
    basePack,
    compactedGraph: input.compactedGraph ?? null,
    message: input.payload.message,
  });
}

// ---------------------------------------------------------------------------
// The two DISCRIMINATORS, as pure functions (so the controls below can drive
// them with arbitrary prompt/pack pairs — a gate whose logic is only reachable
// through its own happy path cannot be proven to discriminate).
// ---------------------------------------------------------------------------

/** Model-facing fields carrying prose the corpus never names. */
export function findUnsanctionedFields(
  corpus: string,
  serialised: Record<string, unknown>,
  userMessage: string,
): string[] {
  return Object.keys(serialised)
    .filter((k) => unsanctionableProse(serialised[k], userMessage).length > 0)
    .filter((k) => !namedInCorpus(k, corpus));
}

/** ContextPack paths the prompt's <CONTEXT_PACK> zone names but the pack lacks. */
export function findPhantomFields(
  prompt: string,
  serialised: Record<string, unknown>,
): string[] {
  const open = prompt.indexOf('<CONTEXT_PACK>');
  const close = prompt.indexOf('</CONTEXT_PACK>');
  if (open < 0 || close < 0) {
    throw new Error('served prompt has no <CONTEXT_PACK> zone — the gate cannot locate the field sanctioning block');
  }
  const zone = prompt.slice(open, close);
  const named = [...zone.matchAll(/(?<![A-Za-z0-9_.])([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+)/g)].map((m) => m[1]!);
  const exists = (path: string): boolean => {
    let cur: unknown = serialised;
    for (const seg of path.split('.')) {
      if (!cur || typeof cur !== 'object' || !(seg in (cur as object))) return false;
      cur = (cur as Record<string, unknown>)[seg];
    }
    return true;
  };
  return [...new Set(named)].filter((p) => !exists(p));
}

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

/** Hash-keyed waivers, applied uniformly to both discriminators. */
function applyWaivers(found: string[], promptSha: string): string[] {
  return found.filter(
    (f) => !KNOWN_UNSANCTIONED.some((w) => w.field === f && w.promptSha === promptSha),
  );
}

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

const PACK = assembleMaximalPack();
/**
 * The message `buildUserMessage` ACTUALLY renders — kept, not discarded. The
 * gate previously parsed the pack out of this and threw the prompt away, which
 * is why it could certify a field as sanctioned by an instruction the prompt
 * did not contain (see EMISSION below).
 */
const RENDERED = buildUserMessage(PACK, USER_MESSAGE);
const SERIALISED = observeSerialisedPack(RENDERED);
const LIVE_SHA = shortSha256(SERVED_PROMPT);

describe('prompt ↔ pack sanction gate', () => {
  it('IDENTITY — both pinned prompts are the bytes they claim to be', () => {
    expect(shortSha256(SERVED_PROMPT)).toBe(SERVED_PROMPT_SHA256_16);
    // The historical control fixture must never silently drift either.
    expect(shortSha256(HISTORICAL_V119)).toBe(HISTORICAL_V119_SHA256_16);
  });

  it('FIXTURE_COMPLETENESS — the fixture populates every schema-declared key (this gate can never be blind)', () => {
    const unpopulated = findUnpopulatedFields(PACK);
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
  });

  it('SERIALISER_PARITY — every schema key is either serialised to the model or deliberately stripped', () => {
    const facing = new Set(Object.keys(SERIALISED));
    expect(
      Object.keys(ContextPackSchema.shape).filter(
        (k) => !facing.has(k) && !(STRIPPED_BY_SERIALISER as readonly string[]).includes(k),
      ),
    ).toEqual([]);
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
  it('EMISSION — every code-owned instruction in the corpus is actually rendered into the prompt', () => {
    // PRECONDITIONS PINNED IN-TEST: an assertion over an empty corpus, or over
    // a prompt that failed to render, would pass by testing nothing (trap #13).
    expect(
      CODE_OWNED_INSTRUCTIONS.length,
      'the corpus must carry code-owned instructions or this check is vacuous',
    ).toBeGreaterThan(0);
    expect(RENDERED).toContain('## ContextPack');

    const missing = CODE_OWNED_INSTRUCTIONS.filter(([, text]) => !RENDERED.includes(text)).map(
      ([name]) => name,
    );
    expect(
      missing,
      `These instructions are counted as SANCTIONING text by MODEL_FACING_CORPUS, but ` +
        `buildUserMessage did not render them into the prompt for a pack that populates every ` +
        `schema key: ${missing.join(', ')}. Either the emission is missing (the model never ` +
        `sees the licence, so any waiver removed on its authority is a false claim), or the ` +
        `instruction is no longer code-owned and must leave MODEL_FACING_CORPUS.`,
    ).toEqual([]);
  });

  it.each(['canonical', 'provisional', 'absent', 'unavailable'] as const)(
    'GRAPH AUTHORITY — serialises %s exactly and emits its interpretation block once',
    (status) => {
      const rendered = buildUserMessage(
        { ...PACK, graph_context: { status } },
        USER_MESSAGE,
      );
      const serialised = observeSerialisedPack(rendered);

      expect(serialised.graph_context).toEqual({ status });
      expect(rendered.split(GRAPH_CONTEXT_INSTRUCTION)).toHaveLength(2);
    },
  );

  it('GRAPH AUTHORITY — legacy graph_context omission resolves exactly to unavailable', () => {
    const rendered = buildUserMessage(
      { ...PACK, graph_context: undefined },
      USER_MESSAGE,
    );
    const serialised = observeSerialisedPack(rendered);

    expect(serialised.graph_context).toEqual({ status: 'unavailable' });
    expect(rendered.split(GRAPH_CONTEXT_INSTRUCTION)).toHaveLength(2);
  });

  it('SOURCE WORDING — fixture carries real retained bytes, a real withholding marker and its instruction once', () => {
    const graph = SERIALISED.graph as {
      nodes: ReadonlyArray<Record<string, unknown>>;
    };
    const contextBudget = SERIALISED.context_budget as {
      source_quotes?: Record<string, unknown>;
    };

    expect(
      graph.nodes.some(
        (node) => node.source_quote === 'Should we build the team locally?',
      ),
    ).toBe(true);
    expect(contextBudget.source_quotes).toMatchObject({
      policy: 'exact_or_withheld',
      version: 1,
      per_quote_code_point_limit: 512,
      candidate_node_limit: 50,
      prompt_delta_utf16_limit: 4096,
      candidate_count: 2,
      retained_count: 2,
      empty_quote_withheld_count: 0,
      per_quote_withheld_count: 1,
    });
    expect(RENDERED.split(SOURCE_QUOTES_INSTRUCTION)).toHaveLength(2);
  });

  it('THE GATE — every prose-bearing model-facing field is NAMED in the text the model receives', () => {
    const found = findUnsanctionedFields(MODEL_FACING_CORPUS, SERIALISED, USER_MESSAGE);
    expect(
      applyWaivers(found, LIVE_SHA),
      'These ContextPack fields carry natural-language content to the model, but the served ' +
        'prompt never names them. Under the prompt\'s "Use when present / never reason over ' +
        'absent fields" rules the model may DENY them — the 2026-07-25 record-denial defect.',
    ).toEqual([]);
  });

  it('PHANTOM — every ContextPack field the prompt names actually exists on the pack', () => {
    const found = findPhantomFields(SERVED_PROMPT, SERIALISED);
    expect(
      applyWaivers(found, LIVE_SHA),
      'The served prompt instructs the model to use these ContextPack paths, but the ' +
        'assembler never emits them.',
    ).toEqual([]);
  });

  it('NO STALE WAIVERS — every waiver still describes a live divergence', () => {
    const live = new Set([
      ...findUnsanctionedFields(MODEL_FACING_CORPUS, SERIALISED, USER_MESSAGE),
      ...findPhantomFields(SERVED_PROMPT, SERIALISED),
    ]);
    const stale = KNOWN_UNSANCTIONED.filter((w) => w.promptSha === LIVE_SHA && !live.has(w.field));
    expect(stale.map((w) => w.field), 'waiver no longer needed — remove it').toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// POSITIVE CONTROLS — trap #13. An absence assertion is vacuous unless the
// instrument is first PROVEN able to see a presence. Every control below drives
// the REAL discriminators with the REAL served prompt bytes.
// ---------------------------------------------------------------------------

describe('POSITIVE CONTROLS — the gate catches the defect that motivated it', () => {
  it('THE HISTORICAL CASE — prompt v119 + a pack carrying older_relevant_facts is CAUGHT', () => {
    // Exactly the 2026-07-25 production state: prompt 4e8e69f3d721c864 (authored
    // 07-23) against a pack carrying the field #662 added on 07-24. NO waivers.
    // Driven from the PERMANENT v119 fixture, so re-pinning the served prompt
    // can never make this control vacuous (it did, once — see the fixture note).
    expect(shortSha256(HISTORICAL_V119)).toBe('4e8e69f3d721c864');
    expect(Object.keys(SERIALISED)).toContain('older_relevant_facts');
    const found = findUnsanctionedFields(HISTORICAL_V119_CORPUS, SERIALISED, USER_MESSAGE);
    expect(found).toContain('older_relevant_facts');
  });

  it('THE FIX IS VERIFIED INDEPENDENTLY — the SERVED prompt now sanctions older_relevant_facts', () => {
    // The counterpart to the control above: same pack, same rules, the prompt
    // lane's v120. This is the gate ratifying someone else's fix at the bytes.
    const found = findUnsanctionedFields(MODEL_FACING_CORPUS, SERIALISED, USER_MESSAGE);
    expect(found).not.toContain('older_relevant_facts');
  });

  it('THE TEMPORAL REPRODUCTION — the gate is QUIET before #662 and goes RED the moment #662 lands', () => {
    // Pre-#662: the assembler omits the key entirely for record-less scenarios.
    const prePack = assembleMaximalPack({ olderRelevantFacts: undefined });
    const preSerialised = observeSerialisedPack(buildUserMessage(prePack, USER_MESSAGE));
    expect(Object.keys(preSerialised)).not.toContain('older_relevant_facts');
    const before = findUnsanctionedFields(HISTORICAL_V119_CORPUS, preSerialised, USER_MESSAGE);
    expect(before).not.toContain('older_relevant_facts');

    // #662 lands — the same (v119) prompt, the pack gains the field.
    const after = findUnsanctionedFields(HISTORICAL_V119_CORPUS, SERIALISED, USER_MESSAGE);
    expect(after).toContain('older_relevant_facts');
    // ...and it is a NEW divergence, not pre-existing noise.
    expect(after.filter((f) => !before.includes(f))).toEqual(['older_relevant_facts']);
  });

  it('DISCRIMINATION — the gate responds to the PROMPT side: naming the field turns it GREEN', () => {
    // Proves the gate is not firing for some pack-side reason. Same pack, same
    // rules; the ONLY change is a prompt that sanctions the field.
    const fixedPrompt = HISTORICAL_V119.replace(
      'Use when present: parsed_quantities',
      'Use when present: older_relevant_facts (stored decision records for this scenario — authoritative), parsed_quantities',
    );
    expect(fixedPrompt).not.toBe(HISTORICAL_V119); // the edit actually applied
    const corpus = [fixedPrompt, COACHING_CONTEXT_INSTRUCTION, SUMMARY_PRECEDENCE_INSTRUCTION].join('\n\n');
    expect(findUnsanctionedFields(corpus, SERIALISED, USER_MESSAGE)).not.toContain('older_relevant_facts');
    // and `brief` — unnamed by that edit — is STILL caught (no blanket pass).
    expect(findUnsanctionedFields(corpus, SERIALISED, USER_MESSAGE)).toContain('brief');
  });

  it('PHANTOM CONTROL — the phantom check sees a real phantom and clears a real field', () => {
    expect(findPhantomFields(SERVED_PROMPT, SERIALISED)).toContain('analysis.staleness_reason');
    // conversation.recent_turns is named by the SAME zone and DOES exist → not flagged.
    expect(findPhantomFields(SERVED_PROMPT, SERIALISED)).not.toContain('conversation.recent_turns');
  });

  it('WAIVER EXPIRY — EVERY waiver granted for v119 expires on a prompt change, on BOTH discriminators', () => {
    // The waiver path must be exercised by REAL waivers, not a synthetic one —
    // an untested waiver path is the same guarantee theatre this gate hunts.
    // The remaining live divergence flows through it on the phantom-field
    // discriminator. The brief sanction is now code-owned and needs no waiver.
    const otherSha = 'deadbeefdeadbeef';
    const sanction = findUnsanctionedFields(MODEL_FACING_CORPUS, SERIALISED, USER_MESSAGE);
    const phantom = findPhantomFields(SERVED_PROMPT, SERIALISED);

    // Every waiver in the list is keyed to the prompt we actually serve.
    expect(KNOWN_UNSANCTIONED.length).toBeGreaterThan(0);
    for (const w of KNOWN_UNSANCTIONED) expect(w.promptSha).toBe(LIVE_SHA);

    // TODAY: waived on both discriminators → the gate is green.
    expect(applyWaivers(sanction, LIVE_SHA)).toEqual([]);
    expect(applyWaivers(phantom, LIVE_SHA)).toEqual([]);

    // AFTER A RE-PIN: every waiver expires and every divergence resurfaces.
    expect(applyWaivers(sanction, otherSha)).toEqual([]);
    expect(applyWaivers(phantom, otherSha)).toEqual(['analysis.staleness_reason']);

    // No waiver is inert: each one is doing real suppression work today.
    for (const w of KNOWN_UNSANCTIONED) {
      expect([...sanction, ...phantom], `waiver '${w.field}' suppresses nothing`).toContain(w.field);
    }
  });

  it('NEGATIVE CONTROL — the gate is QUIET on control-metadata fields (it does not fire on everything)', () => {
    const found = findUnsanctionedFields(MODEL_FACING_CORPUS, SERIALISED, USER_MESSAGE);
    for (const quiet of [
      'version', 'scenario_id', 'stage', 'compound_detected',
      'compound_pattern_matched', 'compound_segments', 'system_event',
      'conversation', 'conversation_summary', 'coaching_context',
      'recent_changes', 'analysis', 'graph', 'parsed_quantities',
      'older_relevant_facts', // sanctioned by v120
    ]) {
      expect(found, `${quiet} should not fire`).not.toContain(quiet);
    }
    // No live sanction finding remains at v120: older_relevant_facts is named
    // by the served prompt and `brief` is conditionally sanctioned in code.
    expect(found).toEqual([]);
  });

  it('FIXTURE-BLINDNESS CONTROL — an unpopulated field is CAUGHT, not silently skipped', () => {
    // Simulates "a new optional field lands and nobody updates the fixture".
    const thinPack = assembleMaximalPack({ brief: undefined });
    // Drives the GATE'S OWN function — so an always-pass mutation of it goes RED.
    expect(findUnpopulatedFields(thinPack)).toContain('brief');
    // ...and the real fixture is complete, so the check discriminates both ways.
    expect(findUnpopulatedFields(PACK)).toEqual([]);
  });
});
