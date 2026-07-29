/**
 * MEMORY-RETENTION EVAL — floors + the per-fact retention table
 * (POC-STATE-ASSESSMENT rec 8; the `HARNESS-CONTEXT-ORCHESTRATOR-2026-07-30`
 * finding that the ≤1,600-char haiku rolling summary is the sole carrier of
 * conversational memory and nothing measures its retention).
 *
 * House style follows the #750 clarify-v2 floors pack: golden fixtures + floors
 * that import the PRODUCTION modules from src/ — never copies. The engine and
 * its honest limits are documented in `../scorer/memory-retention.ts`; read that
 * header before quoting any number out of this file.
 *
 * ── WHAT IS A FLOOR AND WHAT IS A MEASUREMENT ───────────────────────────────
 *
 * Retention of a mid-conversation constraint is GRADED, and gating on a graded
 * number would either be arbitrary or would freeze today's behaviour as correct.
 * So the deliverable is a TABLE, and only two things RED:
 *
 *   MEM-FLOOR 1  the DECISION GOAL or a USER CORRECTION is absent from the
 *                injected summary — the two losses a tester experiences
 *                directly as "it forgot what I said".
 *   MEM-FLOOR 2  a SUPERSEDED value survives while the correction that replaced
 *                it does not — an active falsehood, worse than forgetting.
 *
 * and three protect the measurement from being theatre:
 *
 *   MEM-FLOOR 3  the detector discriminates IN BOTH DIRECTIONS (a planted fact
 *                is FOUND; a never-stated one is MISSED; a fact removed from a
 *                planted summary makes the floors FIRE).
 *   MEM-FLOOR 4  no measured fact is present in the verbatim window at the
 *                measurement turn — otherwise the reading is the window's, not
 *                memory's — WITH a positive control proving that channel can
 *                report a presence.
 *   MEM-FLOOR 5  pack integrity / non-vacuity: the fixture is big enough, the
 *                summary actually injected, no pass was rejected or floored, and
 *                the faithful arm's output sits between the real
 *                SUMMARY_TARGET_MAX_CHARS and SUMMARY_HARD_CAP_CHARS — so the
 *                budget pressure the eval reports is produced by the production
 *                constants, not by a tuned fixture.
 *
 * NOT REQUIRED, and honestly so. `staging`'s only required check is
 * `Lint, TypeCheck, Unit Tests` (derived from the branch-protection API, 30
 * Jul), and this suite runs in `Conversation Harness Gates (advisory)`, which
 * triggers on `tools/conversation-harness/**` and `src/orchestrator-v5/**` — so
 * it DOES execute on every PR that can move the memory path, it simply does not
 * block. The brief's rule applies verbatim: the summariser call is live-LLM with
 * no replay seam in this repo, so the eval is advisory-not-required and says so
 * here rather than implying a guarantee it does not have.
 *
 * Run: pnpm exec vitest run --config tools/conversation-harness/vitest.config.ts
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  SUMMARY_HARD_CAP_CHARS,
  SUMMARY_REGEN_INTERVAL,
  SUMMARY_TARGET_MAX_CHARS,
} from '../../../src/orchestrator-v5/rolling-summary/summary-types.js';
import { CONTEXT_PACK_RECENT_TURNS_CAP } from '../../../src/orchestrator-v5/context/context-pack-schema.js';

import {
  assertStatementsAreSingleSentences,
  assertWitnessesAreDiscriminating,
  evaluateFloors,
  makeCompressorArm,
  makePlantedArm,
  normaliseForDetection,
  renderModelProvenanceHeader,
  renderRetentionTable,
  runRetentionEval,
  splitStatements,
  witnessPresent,
  DETECTOR_UNSOUND_FOR_FLOORS,
  type RetentionCase,
  type RetentionMeasurement,
  type RetentionRunResult,
} from '../scorer/memory-retention.js';

const fixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
  'memory-retention-cases.json',
);
const pack = JSON.parse(readFileSync(fixturePath, 'utf8')) as {
  cases: readonly RetentionCase[];
};
const kase = pack.cases[0]!;

/** The measurement turns, derived from the fixture (never hardcoded here). */
const MEASURE_TURNS = kase.measure_at_turns;
/** An in-window control turn: early enough that turn-5's fact is still verbatim. */
const IN_WINDOW_CONTROL_TURN = 12;

let faithful: RetentionRunResult;
let budgetOldest: RetentionRunResult;
let budgetNewest: RetentionRunResult;
let erasing: RetentionRunResult;

const at = (r: RetentionRunResult, turn: number): RetentionMeasurement => {
  const m = r.measurements.find((x) => x.at_turn === turn);
  if (!m) throw new Error(`no measurement at turn ${turn} for case ${r.case_id}`);
  return m;
};

beforeAll(async () => {
  faithful = await runRetentionEval({
    kase,
    model: makeCompressorArm({ budgetChars: null, dropOrder: 'oldest-first' }),
    measureAtTurns: [IN_WINDOW_CONTROL_TURN, ...MEASURE_TURNS],
  });
  budgetOldest = await runRetentionEval({
    kase,
    model: makeCompressorArm({
      budgetChars: SUMMARY_TARGET_MAX_CHARS,
      dropOrder: 'oldest-first',
    }),
  });
  budgetNewest = await runRetentionEval({
    kase,
    model: makeCompressorArm({
      budgetChars: SUMMARY_TARGET_MAX_CHARS,
      dropOrder: 'newest-first',
    }),
  });
  // ARM C: faithful until the measurement turn, then the estate's own measured
  // erasure defect (a doubt turn emptying a durable slot). See MEM-FLOOR 1's
  // ARM C block for why this is what gives the floor teeth on assemble.ts.
  erasing = await runRetentionEval({
    kase,
    model: makeCompressorArm({
      budgetChars: null,
      dropOrder: 'oldest-first',
      eraseConstraintsFromPass: MEASURE_TURNS[0]!,
    }),
    measureAtTurns: [MEASURE_TURNS[0]!],
  });

  // The report IS the deliverable, so it must survive a fully-green run: an eval
  // whose numbers only exist inside passing assertions has measured nothing a
  // human can read. Written to stdout directly (vitest buffers hook-level
  // console output), and to a file when a path is supplied.
  const report = [
    '===== MEMORY-RETENTION EVAL REPORT =====',
    '',
    // A1 (adversarial review of #757): the caveat rides WITH the numbers. This
    // artefact is extracted to a file, and a bare "retained 10/10" under this
    // title is how the next lane closes rec 8 off a stand-in's output. Derived
    // from the run, so substituting a live model rewrites it automatically —
    // never a hand-maintained sentence that could go stale (trap 12).
    renderModelProvenanceHeader(faithful),
    '',
    `case: ${kase.id} · verbatim window: ${CONTEXT_PACK_RECENT_TURNS_CAP} turns · ` +
      `regen interval: ${SUMMARY_REGEN_INTERVAL} · target ${SUMMARY_TARGET_MAX_CHARS} / ` +
      `hard cap ${SUMMARY_HARD_CAP_CHARS} chars`,
    '',
    renderRetentionTable('ARM A — faithful compressor (no budget pressure)', faithful),
    '',
    renderRetentionTable(
      `ARM B1 — budget ${SUMMARY_TARGET_MAX_CHARS} chars, oldest-first drop`,
      budgetOldest,
    ),
    '',
    renderRetentionTable(
      `ARM B2 — budget ${SUMMARY_TARGET_MAX_CHARS} chars, newest-first drop`,
      budgetNewest,
    ),
    '',
    ...['ARM A (faithful)', 'ARM B1 (oldest-first)'].flatMap((label, idx) => {
      const passes = (idx === 0 ? faithful.arm_passes : budgetOldest.arm_passes) ?? [];
      return [
        `#### per-pass accounting — ${label}`,
        '',
        '| pass | mode | shown utterances | carried | minted | dropped | emitted chars |',
        '|---|---|---|---|---|---|---|',
        ...passes.map(
          (p, i) =>
            `| ${i + 1} | ${p.mode} | ${p.shown_utterances} | ${p.carried_statements} | ` +
            `${p.minted_statements} | ${p.dropped_statements.length} | ${p.emitted_chars} |`,
        ),
        '',
        `peak emitted: ${Math.max(...passes.map((p) => p.emitted_chars))} chars ` +
          `(target ${SUMMARY_TARGET_MAX_CHARS}, hard cap ${SUMMARY_HARD_CAP_CHARS})`,
        '',
      ];
    }),
  ].join('\n');
  process.stdout.write(`\n${report}\n`);
  const out = process.env.MEMORY_RETENTION_REPORT_PATH;
  if (out !== undefined && out.length > 0) writeFileSync(out, report, 'utf8');
}, 120_000);

// ---------------------------------------------------------------------------
// MEM-FLOOR 5 — pack integrity / non-vacuity (run first: everything else
// depends on the pack being able to say anything at all)
// ---------------------------------------------------------------------------

describe('MEM-FLOOR 5 — pack integrity and non-vacuity', () => {
  it('the fixture covers the fact classes the brief asks for, with a negative control', () => {
    const kinds = new Set(kase.facts.map((f) => f.kind));
    expect(kase.facts.length, 'at least five seeded facts').toBeGreaterThanOrEqual(5);
    expect(kinds.has('decision_goal')).toBe(true);
    expect(kinds.has('numeric_constraint')).toBe(true);
    expect(kinds.has('option_name')).toBe(true);
    expect(kinds.has('preference')).toBe(true);
    expect(kinds.has('user_correction')).toBe(true);
    expect(kinds.has('never_stated_control')).toBe(true);
    expect(kase.facts.filter((f) => f.floor).length, 'the defect floor is non-empty').toBe(2);
    expect(kase.facts.some((f) => f.supersedes !== undefined)).toBe(true);
  });

  it('the turn list is well-formed and long enough to push facts out of the window', () => {
    kase.turns.forEach((t, i) => expect(t.n).toBe(i + 1));
    expect(kase.turns.length).toBeGreaterThan(CONTEXT_PACK_RECENT_TURNS_CAP);
    // Every measured fact must be stated OUTSIDE the verbatim window at every
    // measurement turn — derived from the real cap, not asserted as a constant.
    for (const turn of MEASURE_TURNS) {
      const firstVerbatim = turn - CONTEXT_PACK_RECENT_TURNS_CAP + 1;
      for (const f of kase.facts) {
        if (f.stated_at_turn === null) continue;
        expect(
          f.stated_at_turn,
          `${f.id} is stated at turn ${f.stated_at_turn}, inside the verbatim window at ` +
            `measurement turn ${turn} (window starts at ${firstVerbatim}) — its retention ` +
            'reading would be the window, not memory',
        ).toBeLessThan(firstVerbatim);
      }
    }
  });

  it('the fixture is discriminating and honours the statement-recovery contract', () => {
    expect(() => assertWitnessesAreDiscriminating(kase)).not.toThrow();
    expect(() => assertStatementsAreSingleSentences(kase)).not.toThrow();
  });

  it('the measurement turns straddle an incremental chain AND a full regen', () => {
    const modes = MEASURE_TURNS.map((t) => (t % SUMMARY_REGEN_INTERVAL === 0 ? 'regen' : 'incremental'));
    expect(new Set(modes), 'measure both the compounding path and the repair path').toEqual(
      new Set(['incremental', 'regen']),
    );
    for (const t of MEASURE_TURNS) {
      expect(at(faithful, t).stored_generator).toBe(
        t % SUMMARY_REGEN_INTERVAL === 0 ? 'regen' : 'incremental',
      );
    }
  });

  it('a summary was actually injected, fresh, at every measurement turn', () => {
    for (const t of MEASURE_TURNS) {
      const m = at(faithful, t);
      expect(m.injected, 'no injected block means the whole eval measured nothing').toBe(true);
      expect(m.section_text.length).toBeGreaterThan(0);
      expect(m.stale, 'a stale/withheld block would change what the table means').toBe(false);
      expect(m.note).toBeNull();
      expect(m.summarised_turns).toBe(t - CONTEXT_PACK_RECENT_TURNS_CAP);
    }
  });

  it('no pass was rejected, floored or capped — the table reflects live writes', () => {
    expect(faithful.telemetry_observed, 'unobserved disclosure columns are not evidence').toBe(true);
    expect(faithful.summary_events.length).toBe(Math.max(...MEASURE_TURNS));
    for (const e of faithful.summary_events) {
      expect(e.status, JSON.stringify(e)).toBe('applied');
      expect(e.reject_reason).toBeNull();
      expect(e.history_capped).toBe(false);
      expect(e.capped_fallback).toBe(false);
    }
  });

  it('BUDGET PRESSURE IS PRODUCED BY THE PRODUCTION CONSTANTS, not by a padded fixture', () => {
    const emitted = (faithful.arm_passes ?? []).map((p) => p.emitted_chars);
    const peak = Math.max(...emitted);
    // Above the target the prompt tells the model to respect...
    expect(
      peak,
      `ten ordinary stated constraints compress to ${peak} chars verbatim; if this drops below ` +
        `SUMMARY_TARGET_MAX_CHARS (${SUMMARY_TARGET_MAX_CHARS}) the budget arm has nothing to ` +
        'drop and ARM B measures nothing. Lengthen or add a durable statement.',
    ).toBeGreaterThan(SUMMARY_TARGET_MAX_CHARS);
    // ...and below the cap that would reject the pass outright.
    expect(
      peak,
      `if this reaches SUMMARY_HARD_CAP_CHARS (${SUMMARY_HARD_CAP_CHARS}) the faithful arm is ` +
        'rejected as over_cap, the prior summary is kept, and ARM A measures a frozen summary ' +
        'rather than retention. Shorten the fixture.',
    ).toBeLessThan(SUMMARY_HARD_CAP_CHARS);
  });

  it('provenance stamps are DISTINGUISHABLE — the R3 channel carries information', () => {
    // Adversarial review R2: `stampFor` renders `turn_id.slice(0, 8)`, so a
    // fixture whose ids share a prefix rendered NINE IDENTICAL refs and a
    // stamp-provenance regression was undetectable here. Derived from the
    // injected block, not from the fixture, so it pins the rendering too.
    const stamps = at(faithful, MEASURE_TURNS[0]!).section_text.match(/t:[0-9a-z]{8}/g) ?? [];
    expect(stamps.length, 'the injected block carries no provenance stamps at all').toBeGreaterThan(1);
    expect(
      new Set(stamps).size,
      `all ${stamps.length} stamps are identical (${stamps[0]}) — the provenance channel is ` +
        'degenerate and a stamp regression could not be seen',
    ).toBeGreaterThan(1);
  });

  it('the INJECTED block is larger than the stored text, and only the stored one is capped', () => {
    // Adversarial review R3, and the concrete form of sharpening 2: the 1,600
    // hard cap governs the STORED text; the injected block is re-rendered from
    // slots WITH provenance stamps and is uncapped. Reported, and pinned.
    for (const turn of MEASURE_TURNS) {
      const m = at(faithful, turn);
      expect(m.section_text.length).toBeGreaterThan(m.stored_chars);
      expect(m.stored_chars).toBeLessThan(SUMMARY_HARD_CAP_CHARS);
    }
  });

  it('the durable shape holds at most ONE entry per slot — so no count can see a drop', () => {
    // Derived, not asserted from the design doc: assemble.ts stores a
    // single-element entries array, so "nine constraints" exists only in prose.
    // This is why the estate has no counter that could notice a lost statement.
    const m = at(faithful, MEASURE_TURNS[0]!);
    expect(m.durable_entries_per_slot.CONSTRAINTS).toBe(1);
    expect(m.statements_per_slot.CONSTRAINTS).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// MEM-FLOOR 3 — the detector discriminates, in both directions
// ---------------------------------------------------------------------------

describe('MEM-FLOOR 3 — detector controls (both directions, or the table is theatre)', () => {
  it('normalisation folds the money forms a user actually types', () => {
    expect(normaliseForDetection('£180,000')).toBe(' 180000 ');
    expect(normaliseForDetection('180k')).toBe(' 180000 ');
    expect(normaliseForDetection('180000')).toBe(' 180000 ');
  });

  it('witness matching is WORD-BOUNDED (no partial-number false positive)', () => {
    expect(witnessPresent('we need 25 people on site', ['25 people'])).toBe(true);
    expect(witnessPresent('we need 125 people on site', ['25 people'])).toBe(false);
    expect(witnessPresent('', ['25 people'])).toBe(false);
    expect(witnessPresent('anything', [])).toBe(false);
  });

  it('POSITIVE: a planted summary containing every fact reports every fact retained', async () => {
    const plantedText = kase.facts
      .filter((f) => f.stated_at_turn !== null)
      .map((f) => kase.turns.find((t) => t.n === f.stated_at_turn)!.user)
      .join(' ');
    const run = await runRetentionEval({
      kase,
      model: makePlantedArm({
        FRAME: kase.turns[0]!.user,
        CONSTRAINTS: plantedText,
        // Literally the fixture's own user turns, concatenated.
        verbatimFromFixture: true,
      }),
      measureAtTurns: [MEASURE_TURNS[0]!],
    });
    const m = at(run, MEASURE_TURNS[0]!);
    for (const f of m.facts) {
      if (f.stated_at_turn === null) continue;
      expect(f.retained_in_summary, `${f.id} was planted verbatim and must be FOUND`).toBe(true);
    }
    // NEGATIVE, same run: the never-stated control must still be MISSED.
    const control = m.facts.find((f) => f.stated_at_turn === null)!;
    expect(control.retained_in_summary, 'never-stated fact must be MISSED').toBe(false);
    expect(evaluateFloors(kase, run, m)).toEqual([]);
  });

  it('NEGATIVE: removing the floor facts from a planted summary makes MEM-FLOOR 1 FIRE', async () => {
    const run = await runRetentionEval({
      kase,
      model: makePlantedArm({
        FRAME: 'Choosing between three candidate sites.',
        CONSTRAINTS:
          'The total fit-out budget must not go above £180,000. I would prefer a shorter lease.',
        // Every WITNESS token present here is the user's own wording, so the
        // floors are sound: the two that fire, fire because the fact is absent.
        verbatimFromFixture: true,
      }),
      measureAtTurns: [MEASURE_TURNS[0]!],
    });
    const m = at(run, MEASURE_TURNS[0]!);
    const violations = evaluateFloors(kase, run, m);
    expect(violations.map((v) => v.fact_id).sort()).toEqual(
      kase.facts
        .filter((f) => f.floor)
        .map((f) => f.id)
        .sort(),
    );
    expect(violations.every((v) => v.floor === 'MEM-FLOOR-1')).toBe(true);
    // ...and the facts that WERE planted still read retained, so the floor is
    // discriminating rather than uniformly red.
    expect(m.facts.find((f) => f.id === 'budget_ceiling')!.retained_in_summary).toBe(true);
    expect(m.facts.find((f) => f.id === 'lease_preference')!.retained_in_summary).toBe(true);
  });

  it('NEGATIVE: a superseded value outliving its correction makes MEM-FLOOR 2 FIRE', async () => {
    const superseded = kase.facts.find((f) => f.kind === 'superseded_value')!;
    const run = await runRetentionEval({
      kase,
      model: makePlantedArm({
        FRAME: kase.turns[0]!.user,
        CONSTRAINTS: kase.turns.find((t) => t.n === superseded.stated_at_turn)!.user,
        verbatimFromFixture: true,
      }),
      measureAtTurns: [MEASURE_TURNS[0]!],
    });
    const m = at(run, MEASURE_TURNS[0]!);
    const violations = evaluateFloors(kase, run, m);
    expect(violations.some((v) => v.floor === 'MEM-FLOOR-2')).toBe(true);
    const two = violations.find((v) => v.floor === 'MEM-FLOOR-2')!;
    expect(two.detail).toContain('the user explicitly withdrew');
  });

  it('MEM-FLOOR 6 — the floors REFUSE to run against a paraphrasing summariser', async () => {
    // A2 (adversarial review of #757). The reviewer planted a summary preserving
    // ALL TEN facts in MEANING but none in the user's words and got 1/10 retained
    // with 2 MEM-FLOOR-1 violations — a summariser that lost NOTHING, reported as
    // losing the decision goal and the user's correction. Evidence gap 1 hands
    // over a copy-paste command to substitute the live model, so that is a real
    // path to a false defect report (trap 10: a measurement artefact inherited and
    // escalated). The prose disclosure existed in three places and would not have
    // stopped it. Reproduced here, and the API now refuses.
    const paraphrase = await runRetentionEval({
      kase,
      model: makePlantedArm({
        FRAME: 'Picking a site for the new northern depot to recommend upstairs.',
        CONSTRAINTS:
          'Spend is capped at one hundred and eighty thousand pounds for the refit. ' +
          'Nothing can begin before early spring. Bramhall Park is the favourite for its rail link. ' +
          'Staffing is forty bodies, revised up from the earlier twenty-five. ' +
          'A briefer tenancy is wanted even at a higher rate. ' +
          'Legal will not sign until the ecological assessment clears. ' +
          'The Yorkshire site keeps running for half a year. The candidate list is closed.',
        verbatimFromFixture: false,
      }),
      measureAtTurns: [MEASURE_TURNS[0]!],
    });
    const m = at(paraphrase, MEASURE_TURNS[0]!);

    // The artefact is real and is reproduced, not hidden.
    expect(paraphrase.model_kind).toBe('deterministic-stand-in');
    expect(paraphrase.detector_sound_for_floors).toBe(false);
    const scored = m.facts.filter((f) => f.stated_at_turn !== null && f.retained_in_summary);
    expect(
      scored.length,
      'a semantically-complete summary must still score LOW — that is the detector limit ' +
        'this guard exists for; if this ever reads 10/10 the detector became semantic and ' +
        'the refusal can be reconsidered',
    ).toBeLessThan(kase.facts.filter((f) => f.stated_at_turn !== null).length);

    // DIRECTION 1 — refuse by default.
    expect(() => evaluateFloors(kase, paraphrase, m)).toThrow(/REFUSING to evaluate the floors/);
    expect(() => evaluateFloors(kase, paraphrase, m)).toThrow(/READ THE TABLE, NOT THE FLOORS/);

    // DIRECTION 2 — opt in, and every violation is LABELLED as a possible artefact.
    const tagged = evaluateFloors(kase, paraphrase, m, { onUnsound: 'tag' });
    expect(tagged.length, 'the reviewer measured 2 violations here').toBeGreaterThan(0);
    expect(tagged.every((v) => v.detector_unsound === true)).toBe(true);

    // The report header says so too, so an extracted artefact cannot mislead.
    expect(renderModelProvenanceHeader(paraphrase)).toContain('detector_sound_for_floors=false');
    expect(DETECTOR_UNSOUND_FOR_FLOORS).toContain('lower bound');
  });

  it('MEM-FLOOR 6 — a run whose model this module did not build is EXTERNAL and unsound', async () => {
    // The live-model path: an ABSENT marker must not read as "sound". Fail-closed
    // for anything the module did not construct (trap 12 — never assume-good).
    const external = await runRetentionEval({
      kase,
      model: { summarise: async () => ({ text: at(faithful, MEASURE_TURNS[0]!).section_text }) },
      measureAtTurns: [MEASURE_TURNS[0]!],
    });
    expect(external.model_kind).toBe('external-unverified');
    expect(external.detector_sound_for_floors).toBe(false);
    expect(() =>
      evaluateFloors(kase, external, at(external, MEASURE_TURNS[0]!)),
    ).toThrow(/REFUSING/);
    expect(renderModelProvenanceHeader(external)).toContain('EXTERNAL / UNVERIFIED');
    // POSITIVE CONTROL for the marker's discrimination: the verbatim arms ARE sound
    // and their header carries no external warning — so `false` above is a verdict
    // about the model, not a constant.
    expect(faithful.detector_sound_for_floors).toBe(true);
    expect(faithful.model_kind).toBe('deterministic-stand-in');
    expect(renderModelProvenanceHeader(faithful)).not.toContain('EXTERNAL');
    expect(renderModelProvenanceHeader(faithful)).toContain('NO live model was called');
  });

  it('evaluateFloors refuses a measurement paired with the wrong run', () => {
    // The guard is only honest if the (run, measurement) pair is coherent —
    // otherwise a caller could launder an unsound arm through a sound run's verdict.
    expect(() => evaluateFloors(kase, budgetOldest, at(faithful, MEASURE_TURNS[0]!))).toThrow(
      /does not belong to the run/,
    );
  });

  it('statement recovery splits a stored blob back into its statements', () => {
    const { statements, stamp } = splitStatements(
      'One thing must hold. Another thing cannot change. [t1, t2]',
    );
    expect(statements).toEqual(['One thing must hold.', 'Another thing cannot change.']);
    expect(stamp).toBe('[t1, t2]');
    expect(splitStatements('   ').statements).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// MEM-FLOOR 4 — the reading comes from memory, not from the verbatim window
// ---------------------------------------------------------------------------

describe('MEM-FLOOR 4 — measurement scope (with a positive control on the channel)', () => {
  it('no measured fact is in the verbatim window at any measurement turn', () => {
    for (const turn of MEASURE_TURNS) {
      for (const f of at(faithful, turn).facts) {
        expect(
          f.present_in_verbatim_window,
          `${f.id} appears in the verbatim window at turn ${turn} — the retention reading ` +
            'for it would be the window talking, not the rolling summary',
        ).toBe(false);
      }
    }
  });

  it('POSITIVE CONTROL: the same channel DOES report a presence when the fact is in-window', () => {
    // Trap 13: an absence assertion has to prove it can see a presence.
    const early = at(faithful, IN_WINDOW_CONTROL_TURN);
    const inWindow = early.facts.filter((f) => f.present_in_verbatim_window);
    expect(
      inWindow.length,
      `at turn ${IN_WINDOW_CONTROL_TURN} the window covers turns ` +
        `${IN_WINDOW_CONTROL_TURN - CONTEXT_PACK_RECENT_TURNS_CAP + 1}-${IN_WINDOW_CONTROL_TURN}, ` +
        'so several seeded facts MUST read present-in-window',
    ).toBeGreaterThan(0);
    expect(inWindow.every((f) => f.stated_at_turn !== null)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// MEM-FLOOR 1 + 2 — the defect floor, on the arm where a loss means a bug
// ---------------------------------------------------------------------------

describe('MEM-FLOOR 1 + 2 — ARM A (faithful): the pipeline must not lose what it was given', () => {
  it.each(MEASURE_TURNS.map((t) => [t] as const))(
    'turn %i: the decision goal and the user correction survive into the injected summary',
    (turn) => {
      const m = at(faithful, turn);
      const violations = evaluateFloors(kase, faithful, m);
      expect(violations.map((v) => `${v.floor} ${v.fact_id}`), violations.map((v) => v.detail).join('\n\n')).toEqual([]);
    },
  );

  it('and every seeded fact reaches the assembled routing prompt, not just the pack', () => {
    for (const turn of MEASURE_TURNS) {
      for (const f of at(faithful, turn).facts) {
        if (f.stated_at_turn === null) continue;
        if (!f.retained_in_summary) continue;
        expect(f.present_in_prompt, `${f.id} is in the pack but not in the prompt bytes`).toBe(true);
      }
    }
  });
});

describe('MEM-FLOOR 1 — ARM C (erasure): the floor bites on the carry-forward in assemble.ts', () => {
  // WHY THIS BLOCK EXISTS. On the faithful arm no slot is ever emptied, so the
  // floor coexists with the GATE 1 repair without depending on it — and a floor
  // that would stay green with the repair deleted is not a control (trap 11).
  // ARM C reproduces the estate's own MEASURED erasure (a user turn doubting
  // recorded history emptied a durable slot 57/57) on the measurement pass, so
  // the floor's green now REQUIRES assemble.ts's carry-forward branch. Delete
  // that branch and this block goes RED — which is the mutation the finding
  // named.
  it('the erasing pass is REPAIRED, not rejected: carried_forward_slots fires and the write lands', () => {
    const events = erasing.summary_events;
    const last = events[events.length - 1]!;
    expect(last.status, 'the pass must LAND (repair path), not be rejected').toBe('applied');
    expect(last.carried_forward_slots, 'GATE 1 must report the erasure it repaired').toBe(1);
    // and every earlier pass was a clean apply, so the 1 is this pass's.
    expect(events.slice(0, -1).every((e) => e.carried_forward_slots === 0)).toBe(true);
  });

  it('every seeded fact — including both floor facts — survives the erasure', () => {
    const m = at(erasing, MEASURE_TURNS[0]!);
    expect(evaluateFloors(kase, erasing, m).map((v) => v.detail)).toEqual([]);
    for (const f of m.facts) {
      if (f.stated_at_turn === null) continue;
      expect(f.retained_in_summary, `${f.id} lost to the erasure`).toBe(true);
    }
    // The injected block must not carry the bare "(none)" marker the erasure
    // emitted — that marker is injected as an affirmative "there is nothing".
    expect(m.section_text).not.toMatch(/CONSTRAINTS & PREFERENCES: \(none\)/);
  });
});

// ---------------------------------------------------------------------------
// THE MEASUREMENT — reported, deliberately NOT floored
// ---------------------------------------------------------------------------

describe('MEASUREMENT — ARM B: what budget pressure costs, and what notices', () => {
  it('the arm is non-vacuous: it actually dropped stated facts', () => {
    const dropped = (budgetOldest.arm_passes ?? []).flatMap((p) => p.dropped_statements);
    expect(
      dropped.length,
      'the budget arm dropped nothing — either the fixture shrank below the target ' +
        '(see MEM-FLOOR 5) or the drop rule stopped firing',
    ).toBeGreaterThan(0);
  });

  it('a budget drop is SILENT: nothing rejects, counts, or discloses it', () => {
    // The finding, converted into an assertion about the SYSTEM (the drop itself
    // is supplied by the fixture). GATE 1 fires only on a slot emptied
    // ENTIRELY, so a slot that loses some-but-not-all statements is invisible:
    // status stays `applied`, carried_forward_slots stays 0, the summary is not
    // stale and carries no note.
    for (const e of budgetOldest.summary_events) {
      expect(e.status).toBe('applied');
      expect(e.carried_forward_slots).toBe(0);
      expect(e.reject_reason).toBeNull();
    }
    for (const turn of MEASURE_TURNS) {
      const m = at(budgetOldest, turn);
      expect(m.stale).toBe(false);
      expect(m.note).toBeNull();
      expect(m.history_capped).toBe(false);
    }
    // WHEN THE ESTATE GAINS A DROP DISCLOSURE, this expectation flips and this
    // block becomes a floor. It is written as the measurement it is today, not
    // as an approval of the behaviour.
    const lost = at(budgetOldest, MEASURE_TURNS[0]!).facts.filter(
      (f) => f.stated_at_turn !== null && !f.retained_in_summary,
    );
    expect(
      lost.length,
      'the whole point: facts were lost and the system said nothing',
    ).toBeGreaterThan(0);
  });

  it('WHICH fact a user loses is decided by the drop ORDER, which nothing constrains', () => {
    const lostIn = (r: RetentionRunResult): string[] =>
      at(r, MEASURE_TURNS[0]!)
        .facts.filter((f) => f.stated_at_turn !== null && !f.retained_in_summary)
        .map((f) => f.id)
        .sort();
    const oldest = lostIn(budgetOldest);
    const newest = lostIn(budgetNewest);
    expect(oldest.length).toBeGreaterThan(0);
    expect(newest.length).toBeGreaterThan(0);
    expect(
      oldest,
      'if these coincide the eval has stopped discriminating between drop policies',
    ).not.toEqual(newest);
  });

  it('a REGEN from full history does not repair a budget drop', () => {
    // shouldRegenerate() rebuilds from FULL persisted history every
    // SUMMARY_REGEN_INTERVAL turns — the estate's anti-compounding guard. It
    // bounds DRIFT. It cannot bound a loss whose cause is the budget, because
    // the regen re-derives the same over-budget input and drops again.
    const regenTurn = MEASURE_TURNS.find((t) => t % SUMMARY_REGEN_INTERVAL === 0)!;
    const incrementalTurn = MEASURE_TURNS.find((t) => t % SUMMARY_REGEN_INTERVAL !== 0)!;
    const lostAt = (turn: number): string[] =>
      at(budgetOldest, turn)
        .facts.filter((f) => f.stated_at_turn !== null && !f.retained_in_summary)
        .map((f) => f.id)
        .sort();
    expect(at(budgetOldest, regenTurn).stored_generator).toBe('regen');
    expect(lostAt(regenTurn).length).toBeGreaterThan(0);
    expect(lostAt(regenTurn)).toEqual(lostAt(incrementalTurn));
  });
});
