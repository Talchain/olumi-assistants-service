/**
 * MEMORY-RETENTION EVAL — the engine (POC-STATE-ASSESSMENT rec 8).
 *
 * WHAT THIS EXISTS TO ANSWER. The entire durable conversational memory of a
 * scenario is the rolling summary: one pass's output is hard-rejected over
 * `SUMMARY_HARD_CAP_CHARS` (1,600) and the model is instructed to stay under
 * `SUMMARY_TARGET_MAX_CHARS` (1,200) by "dropping the least important detail".
 * Every existing gate defends against a slot being EMPTIED, MIS-ATTRIBUTED,
 * STALE or ABSENT. Nothing defends against — or even notices — a slot quietly
 * losing one stated fact among several. That is the mechanism by which a user's
 * constraint from twenty turns ago disappears, and until this file it was
 * unmeasured.
 *
 * ── WHAT IS REAL HERE AND WHAT IS A STAND-IN (read before quoting a number) ──
 *
 * REAL, seam for seam — the production composition, not a re-implementation:
 *   maintainRollingSummaryForCommit (capture.ts)  ← run once per turn
 *     → buildSummariserInput / shouldRegenerate   (build-input.ts)
 *     → the injected SummariserModel port          (summariser.ts)
 *     → parseSummaryOutput                         (parse-summary.ts)
 *     → findErasedSlots / findUnwitnessedAssistantAttributions (retention.ts)
 *     → assembleSummaryFromParsed                  (assemble.ts)
 *     → a monotonic in-memory store                (store-adapter.ts port)
 *     → loadConversationSummaryForInjection        (inject.ts)
 *     → assembleContextPackWithSummary             (context-pack-assembler.ts)
 *     → buildUserMessage                           (route-with-tool-use.ts)
 *
 * STAND-IN: the MODEL. There is no record/replay seam for LLM responses in this
 * repo (derived: the only seams are the injectable `SummariserModel` port and
 * `tools/orchestrator-eval/src/live-gate.ts`'s fail-closed live opt-in). So the
 * deterministic arms below drive the real chain with a compressor that DERIVES
 * its slots from the input it is actually shown — it never hardcodes a probe
 * string, so a wiring failure makes the fact unreachable and the assertion RED
 * (the `activation-acceptance.test.ts` anti-theatre pattern).
 *
 * Therefore:
 *   - a fact lost in the FAITHFUL arm is a **code** defect (the pipeline cannot
 *     carry what it was given) — that is what the floors gate;
 *   - the BUDGET arm supplies the drop from the fixture and measures **the
 *     system's response to it** (does anything reject, disclose, or count?);
 *   - the real model's retention is NOT measured here. `runRetentionEval` takes
 *     any `SummariserModel`, so passing `new AnthropicSummariserModel()`
 *     produces the live table — deliberately not wired to any CI path, and
 *     deliberately NOT shipped as a skipping test (a `skipIf` that goes green
 *     having run nothing is the vacuous-control trap this estate keeps paying
 *     for).
 *
 * NAMED DEPENDENCY (the activation-acceptance precedent): the compressors read
 * the summariser input's RENDERING, so they are coupled to build-input.ts's
 * `renderUnit` / `renderPriorSummaryBlock`. That coupling is asserted, not
 * assumed — `assertInputShapeUnderstood` RAISES if the layout moves, rather
 * than silently minting "(none)" and reporting a retention collapse that is
 * really a fixture rot. Read it before changing build-input.ts.
 */

import {
  maintainRollingSummaryForCommit,
  resetRollingSummarySingleFlightForTests,
} from '../../../src/orchestrator-v5/rolling-summary/capture.js';
import type { ConversationHistoryReader } from '../../../src/orchestrator-v5/rolling-summary/capture.js';
import { loadConversationSummaryForInjection } from '../../../src/orchestrator-v5/rolling-summary/inject.js';
import {
  ROLLING_SUMMARY_SLOT_LABELS,
  ROLLING_SUMMARY_SLOTS,
} from '../../../src/orchestrator-v5/rolling-summary/summary-types.js';
import type { RollingSummarySlot } from '../../../src/orchestrator-v5/rolling-summary/summary-types.js';
import type { SummariserModel } from '../../../src/orchestrator-v5/rolling-summary/summariser.js';
import { assembleContextPackWithSummary } from '../../../src/orchestrator-v5/context/context-pack-assembler.js';
import type { AssembleContextPackInput } from '../../../src/orchestrator-v5/context/context-pack-assembler.js';
import { CONTEXT_PACK_RECENT_TURNS_CAP } from '../../../src/orchestrator-v5/context/context-pack-schema.js';
import { buildUserMessage } from '../../../src/orchestrator-v5/routing/route-with-tool-use.js';
import type { SessionTurnWithContent } from '../../../src/orchestrator-v5/session/conversation-content.js';
import { setTestSink } from '../../../src/utils/telemetry.js';
// Shared test-support, imported NOT copied — the same direction the src-side
// suites already take (`src/**/__tests__/*.test.ts` → `tests/fixtures|utils`).
// `makeSessionTurnRow` owns the COMPLETE row shape: the vendored
// `SessionTurnSchema` is `.strict()`-parsed on the read path and a hand-rolled
// partial row is silently DROPPED, which here would mean the retention table
// measured a shorter conversation than the fixture describes.
// `MonotonicRollingSummaryStoreFake` owns the COMPOSITE (created_at, turn_id,
// version) write guard; this file previously compared `created_at` alone, a
// strictly weaker ordering than the unit suites pin.
import { makeSessionTurnRow } from '../../../tests/utils/mock-session-store.js';
import { MonotonicRollingSummaryStoreFake } from '../../../tests/utils/rolling-summary-store-fake.js';

// ---------------------------------------------------------------------------
// Fixture shape
// ---------------------------------------------------------------------------

export type RetentionFactKind =
  | 'decision_goal'
  | 'numeric_constraint'
  | 'date_constraint'
  | 'option_name'
  | 'preference'
  | 'user_correction'
  | 'superseded_value'
  | 'scope_constraint'
  | 'other_constraint'
  | 'never_stated_control';

/** What a user would state, and how we recognise it later. */
export interface RetentionFactSpec {
  readonly id: string;
  /** Taxonomy, for the report's rows. */
  readonly kind: RetentionFactKind;
  /** 1-based turn the user states it on; null for the never-stated control. */
  readonly stated_at_turn: number | null;
  /**
   * Witness tokens. EVERY token must be present (word-bounded, after numeric
   * normalisation) for the fact to count as retained. See `witnessPresent` for
   * the detector's honest limits and its direction of error.
   */
  readonly witness: readonly string[];
  /**
   * TRUE ⇒ losing this fact REDs the build (the defect floor). Kept to the two
   * classes a tester experiences directly as "it forgot what I said": the
   * DECISION GOAL and a USER CORRECTION. Everything else is MEASURED, because
   * the truth there is graded and the honest deliverable is a table.
   */
  readonly floor: boolean;
  /**
   * For a `user_correction`: the id of the `superseded_value` fact it replaces.
   * Powers MEM-FLOOR 2 — a superseded value surviving while its correction is
   * lost is not forgetting, it is an ACTIVE FALSEHOOD, and it is worse.
   */
  readonly supersedes?: string;
  readonly note: string;
}

export interface RetentionCaseTurn {
  readonly n: number;
  readonly user: string;
  readonly assistant: string;
}

export interface RetentionCase {
  readonly id: string;
  /** 1-based, chronological. `n` is redundant with the index and is asserted. */
  readonly turns: readonly RetentionCaseTurn[];
  /** Turns at which the injected context is measured. */
  readonly measure_at_turns: readonly number[];
  readonly facts: readonly RetentionFactSpec[];
  readonly note: string;
}

// ---------------------------------------------------------------------------
// The detector — lexical + numeric, and honest about which way it errs
// ---------------------------------------------------------------------------

/**
 * Fold a string into the detector's comparison space.
 *
 *   "£180,000"  → " 180000 "        (currency + thousands separators)
 *   "£180k"     → " 180000 "        (k-suffix)
 *   "40 people" → " 40 people "
 *
 * Everything non-alphanumeric collapses to a single space, and the result is
 * space-padded, so a token match is WORD-BOUNDED: witness "25 people" does not
 * match "125 people".
 */
export function normaliseForDetection(raw: string): string {
  let s = raw.toLowerCase();
  // Thousands separators, repeatedly (1,234,567 needs more than one pass).
  for (let i = 0; i < 4; i += 1) s = s.replace(/(\d),(\d{3})\b/g, '$1$2');
  // k-suffix on a number ("180k", "1.5k").
  s = s.replace(/\b(\d+(?:\.\d+)?)\s*k\b/g, (_m, n: string) => String(Math.round(Number(n) * 1000)));
  s = s.replace(/[^a-z0-9]+/g, ' ');
  return ` ${s.trim()} `;
}

/**
 * Does `haystack` witness this fact?
 *
 * HONEST LIMITS, stated because a retention table read as truth is worse than
 * no table at all:
 *  - The detector is LEXICAL (plus numeric normalisation). A faithful PARAPHRASE
 *    of a constraint reads as LOST. The error is therefore one-directional and
 *    CONSERVATIVE: the "retained" column is a LOWER BOUND on real retention.
 *  - Which makes it sound as a floor for the deterministic arms (they carry the
 *    user's own words, so a paraphrase cannot arise) and UNSOUND as a floor for
 *    a live model run — hence the live arm is advisory, reported as a table with
 *    the paraphrase caveat attached, and gates nothing.
 *  - It can also over-fire if a witness token reaches the text for an unrelated
 *    reason. `assertWitnessesAreDiscriminating` closes that off for the shipped
 *    fixture, in both directions, at load time.
 */
export function witnessPresent(haystack: string, witness: readonly string[]): boolean {
  return witnessPresentIn(normaliseForDetection(haystack), witness.map(normaliseForDetection));
}

/**
 * The comparison itself, over ALREADY-NORMALISED inputs.
 *
 * Exists because `witnessPresent` re-normalised the same haystack once per fact:
 * 3 haystacks x 11 facts x 5 measured runs is ~880 normalisations where ~51
 * distinct ones suffice, and each walks the string four times for thousands-
 * separators alone. Callers that measure many facts against the same text
 * normalise once and call this; `witnessPresent` stays as the one-shot wrapper so
 * its unit pins keep testing the same predicate both paths use.
 */
export function witnessPresentIn(
  normalisedHaystack: string,
  normalisedWitness: readonly string[],
): boolean {
  if (normalisedWitness.length === 0) return false;
  return normalisedWitness.every((w) => normalisedHaystack.includes(w));
}

// ---------------------------------------------------------------------------
// Reading the summariser input (the NAMED DEPENDENCY on build-input.ts)
// ---------------------------------------------------------------------------

/** `[t7] USER: …` / `[t8] ASSISTANT: …` — one ordinal per utterance. */
const UTTERANCE_RE = /^\[(t\d+)\]\s*(USER|ASSISTANT):\s*(.*)$/;

/** The two section headers build-input.ts emits for the shown utterances. */
const UTTERANCES_HEADER_RE = /^## (?:Full conversation|New turns since the prior summary)/m;

export interface ParsedSummariserInput {
  readonly mode: 'regen' | 'incremental';
  /** Prior-summary slot content, verbatim (incremental only; '' otherwise). */
  readonly priorBySlot: Readonly<Record<RollingSummarySlot, string>>;
  readonly utterances: ReadonlyArray<{
    readonly ordinal: string;
    readonly speaker: 'USER' | 'ASSISTANT';
    readonly text: string;
  }>;
}

export function parseSummariserInput(userMessage: string): ParsedSummariserInput {
  const split = UTTERANCES_HEADER_RE.exec(userMessage);
  const boundary = split?.index ?? -1;
  const head = boundary >= 0 ? userMessage.slice(0, boundary) : '';
  const tail = boundary >= 0 ? userMessage.slice(boundary) : userMessage;

  const priorBySlot = {} as Record<RollingSummarySlot, string>;
  for (const slot of ROLLING_SUMMARY_SLOTS) priorBySlot[slot] = '';
  for (const line of head.split('\n')) {
    for (const slot of ROLLING_SUMMARY_SLOTS) {
      const label = `${ROLLING_SUMMARY_SLOT_LABELS[slot]}:`;
      if (line.startsWith(label)) priorBySlot[slot] = line.slice(label.length).trim();
    }
  }

  const utterances: Array<{ ordinal: string; speaker: 'USER' | 'ASSISTANT'; text: string }> = [];
  for (const line of tail.split('\n')) {
    const m = UTTERANCE_RE.exec(line.trim());
    if (m) {
      utterances.push({
        ordinal: m[1]!,
        speaker: m[2] as 'USER' | 'ASSISTANT',
        text: m[3]!.trim(),
      });
    }
  }
  return {
    mode: /^## Full conversation/m.test(tail) ? 'regen' : 'incremental',
    priorBySlot,
    utterances,
  };
}

/**
 * FAIL-LOUD on renderer drift (trap 12 — a mirror must never assume-good).
 *
 * The compressors read build-input.ts's rendering. If `renderUnit` or
 * `renderPriorSummaryBlock` changes layout, the silent consequence would be an
 * arm that mints nothing, a retention table of zeros, and a lane concluding the
 * product had regressed. This raises instead.
 */
export function assertInputShapeUnderstood(
  userMessage: string,
  parsed: ParsedSummariserInput,
): void {
  if (parsed.utterances.length === 0) {
    throw new Error(
      'memory-retention eval: parsed ZERO utterances out of a non-empty summariser input. ' +
        "build-input.ts's renderUnit layout has almost certainly changed — update UTTERANCE_RE " +
        'and re-derive every number in the report. Input began:\n' +
        userMessage.slice(0, 400),
    );
  }
  if (parsed.mode === 'incremental' && parsed.priorBySlot.FRAME.length === 0) {
    throw new Error(
      'memory-retention eval: an INCREMENTAL pass carried no DECISION FRAME from the prior ' +
        'summary block. Either renderPriorSummaryBlock changed, or the prior write lost FRAME.',
    );
  }
}

// ---------------------------------------------------------------------------
// Statement-level structure — and why it has to be recovered from prose
// ---------------------------------------------------------------------------

/** A trailing `[t1, t2, …]` provenance group on a slot's rendered content. */
const TRAILING_STAMP_RE = /\s*\[[^\]]*\]\s*$/;

/**
 * Split a slot's rendered content back into the individual statements it holds.
 *
 * WHY THIS IS NEEDED AT ALL — a derived finding worth stating, because it makes
 * the gap the finding named strictly worse than "a gate that only sees an empty
 * slot":
 *
 *   1. `parseSummaryOutput` STRIPS every `[tN]` stamp out of the slot text
 *      (`extractRefs` → `clean`) and keeps the refs in a flat list.
 *   2. `assembleSummaryFromParsed` then stores AT MOST ONE ENTRY PER SLOT
 *      (assemble.ts pushes a single-element array), whose `source_turn_ids` is
 *      the UNION of every ref the slot cited.
 *
 * So the durable shape has NO notion of "nine constraints": it is one prose
 * blob plus a union of turn ids. Statement identity exists only in the prose,
 * which is why this function must recover it by sentence boundary, and why
 * dropping one statement cannot be detected by any count the system holds.
 *
 * The sentence rule is a fixture contract, not a guess: every durable statement
 * in the shipped pack is exactly one sentence ending in a full stop, asserted by
 * `assertStatementsAreSingleSentences` at load time.
 */
export function splitStatements(blob: string): { statements: string[]; stamp: string } {
  const trimmed = blob.trim();
  if (trimmed.length === 0) return { statements: [], stamp: '' };
  const stampMatch = TRAILING_STAMP_RE.exec(trimmed);
  const stamp = stampMatch ? stampMatch[0].trim() : '';
  const body = stamp.length > 0 ? trimmed.slice(0, stampMatch!.index).trim() : trimmed;
  if (body.length === 0) return { statements: [], stamp };
  const statements = body
    .split(/(?<=\.)\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return { statements, stamp };
}

// ---------------------------------------------------------------------------
// The deterministic compressor arms
// ---------------------------------------------------------------------------

/**
 * The durability lexicon: which user utterances a compressor treats as stating
 * something durable. GENERIC ENGLISH BY DESIGN — no probe string, no fixture
 * token. If this were tuned to the fixture the arm would prove nothing.
 */
export const DURABILITY_MARKER_RE =
  /\b(?:must|cannot|can not|no more than|no earlier than|no later than|at least|cap|ceiling|budget|deadline|prefer|prefers|preferred|correction|non-negotiable|only if|never|do not want)\b/i;

/**
 * Render the four-slot contract `parseSummaryOutput` enforces.
 *
 * ONE definition for every summariser this module builds. It was duplicated
 * between the compressor arms and `makePlantedArm`, which is the shape of bug
 * that matters most here: drift would make the CONTROL arm exercise a layout the
 * measured arm never emits, so a control could pass against a shape the real run
 * could not produce. Slot ORDER and LABELS are derived from the production
 * constants, not restated.
 */
export function renderSlots(slots: {
  readonly FRAME: string;
  readonly CONSTRAINTS: string;
  readonly RESOLVED?: string;
  readonly OPEN?: string;
}): string {
  return ROLLING_SUMMARY_SLOTS.map(
    (slot) => `${ROLLING_SUMMARY_SLOT_LABELS[slot]}: ${slots[slot] ?? '(none)'}`,
  ).join('\n');
}

export interface CompressorOptions {
  /**
   * Character budget the arm respects by DROPPING statements, mirroring the
   * production prompt's own instruction ("Never exceed the length — drop the
   * least important detail instead."). `null` ⇒ the FAITHFUL arm: never drops.
   */
  readonly budgetChars: number | null;
  /**
   * WHICH statement the arm drops when over budget. The production prompt says
   * "least important" and does not define it, so this is an EXPLICIT DECLARED
   * HYPOTHESIS, not a measured model behaviour:
   *  - 'oldest-first' — the earliest-stated statement goes (what a
   *    recency-weighted reader would produce);
   *  - 'newest-first' — the most recent goes.
   * Both are shipped so the table can show that the answer to "which fact does
   * a user lose" is a property of the ORDERING, which nothing in the estate
   * currently constrains.
   */
  readonly dropOrder: 'oldest-first' | 'newest-first';
  /**
   * From this pass (1-based) onward, emit `CONSTRAINTS: (none)` — the estate's
   * OWN MEASURED defect (retention.ts: a user turn merely DOUBTING recorded
   * history emptied a durable slot 57/57 against 0/16 on neutral controls).
   *
   * This is what makes the defect floor BITE on the carry-forward at
   * assemble.ts rather than merely coexisting with it: with the branch present
   * the floor is green because the prior entries are restored; delete the
   * branch and the floor goes RED. FRAME is still derived normally, so the pass
   * stays structurally valid and takes the repair path, not the reject path.
   */
  readonly eraseConstraintsFromPass?: number;
}

export interface CompressorPass {
  readonly mode: 'regen' | 'incremental';
  readonly shown_utterances: number;
  readonly carried_statements: number;
  readonly minted_statements: number;
  readonly dropped_statements: readonly string[];
  readonly emitted_chars: number;
}

/**
 * A summariser this module constructed, carrying the ONE fact the floors depend
 * on (adversarial review of #757, A2).
 *
 * `verbatimByConstruction: true` ⇒ the summary reproduces the USER'S OWN WORDS,
 * so the lexical detector cannot mistake a paraphrase for a loss and
 * `evaluateFloors` is sound. `false` ⇒ built here but planting text that is not
 * the fixture's words. **ABSENT ⇒ an external model** (the live haiku
 * summariser, or anything else a caller supplies) — and then the floors are
 * UNSOUND, because a faithful paraphrase scores as a loss.
 *
 * Measured by the reviewer, which is why this is a field and not a paragraph: a
 * planted summary preserving all ten facts IN MEANING but none in the user's
 * words scored **1/10 retained with 2 MEM-FLOOR-1 violations** — a summariser
 * that lost nothing, reported as losing the decision goal and the user's
 * correction. The prose disclosure existed in three places and would not have
 * stopped a lane filing that as a product defect (trap 10: a measurement
 * artefact inherited and escalated). So the API refuses instead.
 */
export interface RetentionSummariser extends SummariserModel {
  readonly verbatimByConstruction?: boolean;
}

export interface CompressorArm extends RetentionSummariser {
  readonly verbatimByConstruction: true;
  readonly passes: readonly CompressorPass[];
}

/**
 * A compressor that derives all four slots from the input it is shown.
 *
 * FRAME  — the prior summary's FRAME when carrying one, else the FIRST user
 *          utterance shown (which on a regen is turn 1). Never invented.
 * CONSTRAINTS — the carried statements, then one statement per newly-shown user
 *          utterance that trips DURABILITY_MARKER_RE, verbatim + its `[tN]`.
 * RESOLVED / OPEN — "(none)". Deliberately inert: this eval measures the
 *          CONSTRAINTS carrier, and a populated RESOLVED would put GATE 1's
 *          erasure path in the middle of the measurement.
 */
export function makeCompressorArm(opts: CompressorOptions): CompressorArm {
  const passes: CompressorPass[] = [];

  return {
    // By CONSTRUCTION: every statement this arm emits is a user utterance copied
    // verbatim out of the input (see the mint loop below), so no paraphrase can
    // arise and the lexical detector cannot mistake one for a loss.
    verbatimByConstruction: true,
    passes,
    async summarise(userMessage: string) {
      const parsed = parseSummariserInput(userMessage);
      assertInputShapeUnderstood(userMessage, parsed);

      const carriedSplit = splitStatements(parsed.priorBySlot.CONSTRAINTS);
      const carried = carriedSplit.statements;
      const minted: string[] = [];
      for (const u of parsed.utterances) {
        if (u.speaker !== 'USER') continue;
        if (!DURABILITY_MARKER_RE.test(u.text)) continue;
        minted.push(`${u.text} [${u.ordinal}]`);
      }
      // A statement already carried is not re-minted. Carried statements have
      // had their stamps stripped by the parser, so compare on stamp-free text.
      const stripStamp = (s: string): string => s.replace(TRAILING_STAMP_RE, '').trim();
      const carriedText = new Set(carried.map(stripStamp));
      const fresh = minted.filter((m) => !carriedText.has(stripStamp(m)));

      const frame =
        parsed.priorBySlot.FRAME.length > 0
          ? parsed.priorBySlot.FRAME
          : (parsed.utterances.find((u) => u.speaker === 'USER')?.text ?? '');

      const erasing =
        opts.eraseConstraintsFromPass !== undefined &&
        passes.length + 1 >= opts.eraseConstraintsFromPass;

      const renderConstraints = (
        keptCarried: readonly string[],
        keptFresh: readonly string[],
      ): string => {
        if (erasing) return '(none)';
        const parts: string[] = [];
        if (keptCarried.length > 0) {
          parts.push(keptCarried.join(' '));
          // Carried provenance is a UNION stamp (see splitStatements): it can
          // only be carried wholesale, so a dropped statement leaves its source
          // turn id still cited. Reported, not silently repaired.
          if (carriedSplit.stamp.length > 0) parts.push(carriedSplit.stamp);
        }
        for (const f of keptFresh) parts.push(f);
        return parts.length > 0 ? parts.join(' ') : '(none)';
      };
      const render = (keptCarried: readonly string[], keptFresh: readonly string[]): string =>
        renderSlots({ FRAME: frame, CONSTRAINTS: renderConstraints(keptCarried, keptFresh) });

      const keptCarried = [...carried];
      const keptFresh = [...fresh];
      const dropped: string[] = [];
      if (opts.budgetChars !== null) {
        // Drop until inside budget, but NEVER empty the slot: an emptied
        // CONSTRAINTS is the failure GATE 1 already catches, and this arm
        // exists to measure the one it does not.
        while (
          keptCarried.length + keptFresh.length > 1 &&
          render(keptCarried, keptFresh).length > opts.budgetChars
        ) {
          if (opts.dropOrder === 'oldest-first') {
            dropped.push(keptCarried.length > 0 ? keptCarried.shift()! : keptFresh.shift()!);
          } else {
            dropped.push(keptFresh.length > 0 ? keptFresh.pop()! : keptCarried.pop()!);
          }
        }
      }

      const text = render(keptCarried, keptFresh);
      passes.push({
        mode: parsed.mode,
        shown_utterances: parsed.utterances.length,
        carried_statements: carried.length,
        minted_statements: fresh.length,
        dropped_statements: dropped,
        emitted_chars: text.length,
      });
      return { text };
    },
  };
}

/**
 * A fixed-output summariser, for CONTROLS ONLY.
 *
 * It bypasses the derivation, which is exactly right for controlling the
 * DETECTOR and the FLOOR LOGIC (does a planted fact get found? does a missing
 * one RED?) and exactly wrong for any claim about the pipeline. Never use it to
 * produce a retention number.
 *
 * `verbatimFromFixture` is REQUIRED, not defaulted (A2): the caller must state
 * whether the planted text carries the fixture's witness tokens in the user's
 * own words. `false` makes the run detector-unsound and `evaluateFloors` then
 * refuses. A default would be inherited silently by the next author, which is
 * the whole failure mode.
 */
export function makePlantedArm(slots: {
  readonly FRAME: string;
  readonly CONSTRAINTS: string;
  readonly RESOLVED?: string;
  readonly OPEN?: string;
  readonly verbatimFromFixture: boolean;
}): RetentionSummariser {
  const text = renderSlots(slots);
  return {
    verbatimByConstruction: slots.verbatimFromFixture,
    summarise: async () => ({ text }),
  };
}

// ---------------------------------------------------------------------------
// The run: real maintainer per turn, then the real injected context
// ---------------------------------------------------------------------------

const SCENARIO = 'aaaaaaaa-1111-4000-8000-000000000000';
const USER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function buildTurn(n: number, user: string, assistant: string): SessionTurnWithContent {
  return makeSessionTurnRow({
    id: `row-${n}`,
    scenario_id: SCENARIO,
    user_id: USER_ID,
    // The FIRST EIGHT CHARS must differ per turn (adversarial review R2). The
    // injector's provenance stamp is `id.slice(0, 8)` (inject.ts `stampFor`), so
    // an all-`tttttttt` id set rendered nine IDENTICAL refs and the R3
    // provenance channel carried zero information — a stamp regression was
    // undetectable here. Pinned by MEM-FLOOR 5's stamp-distinctness assertion.
    turn_id: `${String(n).padStart(8, '0')}-1111-4000-8000-${String(n).padStart(12, '0')}`,
    // Both halves of the SessionTurn biconditional
    // (`turn_class === 'handler'` ⇔ `handler_id !== null`) are overridden
    // together — the shared helper's docstring makes that the caller's job, and
    // its defaults describe a `handler` turn, which these conversational turns
    // are not.
    turn_class: 'direct_answer',
    handler_id: null,
    request_hash: `sha256:memret-turn-${n}`,
    created_at: new Date(Date.UTC(2026, 6, 30, 9, n, 0)).toISOString(),
    user_message: user,
    assistant_message: assistant,
  });
}

export interface FactReading {
  readonly id: string;
  readonly kind: RetentionFactKind;
  readonly stated_at_turn: number | null;
  readonly floor: boolean;
  /** The measurement: does the INJECTED summary block still witness the fact? */
  readonly retained_in_summary: boolean;
  /** Scope guard: if true the reading is the verbatim window's, not memory's. */
  readonly present_in_verbatim_window: boolean;
  /** End-to-end: does the assembled routing prompt witness it at all? */
  readonly present_in_prompt: boolean;
}

export interface SummaryUpdatedEvent {
  readonly status: string;
  readonly mode: string | null;
  readonly chars: number | null;
  readonly history_capped: boolean | null;
  readonly capped_fallback: boolean | null;
  readonly carried_forward_slots: number | null;
  readonly reject_reason: string | null;
}

export interface RetentionMeasurement {
  readonly at_turn: number;
  readonly injected: boolean;
  readonly section_text: string;
  readonly stale: boolean;
  readonly note: string | null;
  readonly lag_turns: number | null;
  readonly summarised_turns: number | null;
  readonly stored_chars: number;
  readonly stored_generator: string;
  readonly stored_version: number;
  readonly history_capped: boolean;
  /** `entries[].length` in the durable JSONB — the shape's own count. */
  readonly durable_entries_per_slot: Readonly<Record<string, number>>;
  /** Statements recoverable from the prose — what a user would call "facts". */
  readonly statements_per_slot: Readonly<Record<string, number>>;
  readonly facts: readonly FactReading[];
}

export interface RetentionRunResult {
  readonly case_id: string;
  readonly window_depth: number;
  /**
   * DERIVED from the summariser that was actually used, never passed in.
   * `'deterministic-stand-in'` ⇒ built by this module; NO live model was called.
   * `'external-unverified'` ⇒ supplied by the caller (e.g. the live haiku
   * summariser). Rendered into the report header so an extracted artefact cannot
   * be mistaken for a live-model measurement (A1).
   */
  readonly model_kind: 'deterministic-stand-in' | 'external-unverified';
  /**
   * DERIVED (A2). TRUE only when the summariser carries the user's words
   * VERBATIM. When FALSE, `evaluateFloors` REFUSES by default: a lexical
   * detector reads a faithful paraphrase as a loss, so the floors would report
   * defects that are artefacts of the detector.
   */
  readonly detector_sound_for_floors: boolean;
  readonly measurements: readonly RetentionMeasurement[];
  /** Every `v5.summary.updated` the run emitted, in order. */
  readonly summary_events: readonly SummaryUpdatedEvent[];
  /** FALSE ⇒ the disclosure columns were UNOBSERVED, not observed-as-zero.
   *  An unobserved gate must never read as a quiet gate. */
  readonly telemetry_observed: boolean;
  readonly arm_passes: readonly CompressorPass[] | null;
}

export async function runRetentionEval(args: {
  readonly kase: RetentionCase;
  readonly model: SummariserModel;
  readonly measureAtTurns?: readonly number[];
  readonly windowDepth?: number;
}): Promise<RetentionRunResult> {
  const { kase, model } = args;
  const measureAt = [...(args.measureAtTurns ?? kase.measure_at_turns)].sort((a, b) => a - b);
  const windowDepth = args.windowDepth ?? CONTEXT_PACK_RECENT_TURNS_CAP;
  const lastTurn = Math.max(...measureAt);

  const all = kase.turns.map((t) => buildTurn(t.n, t.user, t.assistant));
  const store = new MonotonicRollingSummaryStoreFake();

  const events: SummaryUpdatedEvent[] = [];
  let telemetryObserved = false;
  try {
    setTestSink((name, data) => {
      if (name !== 'v5.summary.updated') return;
      events.push({
        status: String(data.status),
        mode: (data.mode as string | null) ?? null,
        chars: (data.chars as number | null) ?? null,
        history_capped: (data.history_capped as boolean | null) ?? null,
        capped_fallback: (data.capped_fallback as boolean | null) ?? null,
        carried_forward_slots: (data.carried_forward_slots as number | null) ?? null,
        reject_reason: (data.reject_reason as string | null) ?? null,
      });
    });
    telemetryObserved = true;
  } catch {
    // setTestSink refuses outside a test env, by design. `telemetryObserved`
    // stays at its initial false, which is what `telemetry_observed` reports —
    // re-assigning it here only looked like handling.
  }

  // eff-8: normalise each fact's witness ONCE for the whole run rather than
  // once per fact per haystack per measurement.
  const normalisedWitness = new Map<string, readonly string[]>(
    kase.facts.map((f) => [f.id, f.witness.map(normaliseForDetection)] as const),
  );

  const measurements: RetentionMeasurement[] = [];
  try {
    resetRollingSummarySingleFlightForTests();

    for (let n = 1; n <= lastTurn; n += 1) {
      const newestFirst = all.slice(0, n).reverse();
      const newest = newestFirst[0]!;
      const reader: ConversationHistoryReader = { readRecent: async () => newestFirst };
      await maintainRollingSummaryForCommit({
        scenarioId: SCENARIO,
        turnId: newest.turn_id,
        persistedRowId: newest.id,
        historyReader: reader,
        summaryStore: store,
        model,
      });

      if (!measureAt.includes(n)) continue;
      measurements.push(
        await measureInjectedContext(kase, normalisedWitness, newestFirst, store, windowDepth, n),
      );
    }
  } finally {
    if (telemetryObserved) setTestSink(null);
  }

  const armPasses =
    'passes' in model ? ((model as CompressorArm).passes as readonly CompressorPass[]) : null;
  // A1 + A2, both DERIVED from the model actually used. An ABSENT marker means an
  // external model, so the default for anything this module did not build is
  // "unverified, floors unsound" — fail-closed, not assume-good (trap 12).
  const marker = (model as RetentionSummariser).verbatimByConstruction;
  return {
    case_id: kase.id,
    window_depth: windowDepth,
    model_kind: marker === undefined ? 'external-unverified' : 'deterministic-stand-in',
    detector_sound_for_floors: marker === true,
    measurements,
    summary_events: events,
    telemetry_observed: telemetryObserved,
    arm_passes: armPasses,
  };
}

async function measureInjectedContext(
  kase: RetentionCase,
  normalisedWitness: ReadonlyMap<string, readonly string[]>,
  newestFirst: readonly SessionTurnWithContent[],
  store: MonotonicRollingSummaryStoreFake,
  windowDepth: number,
  atTurn: number,
): Promise<RetentionMeasurement> {
  const outcome = await loadConversationSummaryForInjection({
    scenarioId: SCENARIO,
    windowTurnsNewestFirst: newestFirst,
    windowDepth,
    summaryStore: store,
  });
  const message = 'Where do we stand?';
  const input: AssembleContextPackInput = {
    payload: {
      kind: 'message',
      source: 'composer',
      turn_class: 'frame',
      stage: 'frame',
      turn_id: `ffffffff-1111-4000-8000-${String(atTurn).padStart(12, '0')}`,
      scenario_id: SCENARIO,
      message,
    },
    priorTurns: newestFirst,
    priorFacts: [],
    conversationSummary: outcome.section ?? undefined,
    summarisedTurns: outcome.summarisedTurns,
  };
  const { contextPack } = assembleContextPackWithSummary(input);
  const prompt = buildUserMessage(contextPack, message);

  const sectionText = outcome.section?.text ?? '';
  const windowJson = JSON.stringify(contextPack.conversation);
  // eff-8: three haystacks, normalised once, reused across every fact.
  const nSection = normaliseForDetection(sectionText);
  const nWindow = normaliseForDetection(windowJson);
  const nPrompt = normaliseForDetection(prompt);
  const stored = store.stored;

  const durableEntries: Record<string, number> = {};
  const statements: Record<string, number> = {};
  for (const block of stored?.slots ?? []) {
    durableEntries[block.slot] = block.entries.length;
    statements[block.slot] = block.entries.reduce(
      (acc, e) => acc + splitStatements(e.text).statements.length,
      0,
    );
  }

  return {
    at_turn: atTurn,
    injected: outcome.section !== null,
    section_text: sectionText,
    stale: outcome.section?.stale ?? false,
    note: outcome.section?.note ?? null,
    lag_turns: outcome.lagTurns,
    summarised_turns: outcome.summarisedTurns,
    stored_chars: stored?.text.length ?? 0,
    stored_generator: stored?.generator ?? 'none',
    stored_version: stored?.version ?? 0,
    history_capped: stored?.history_capped === true,
    durable_entries_per_slot: durableEntries,
    statements_per_slot: statements,
    facts: kase.facts.map((f) => {
      const w = normalisedWitness.get(f.id) ?? f.witness.map(normaliseForDetection);
      return {
        id: f.id,
        kind: f.kind,
        stated_at_turn: f.stated_at_turn,
        floor: f.floor,
        retained_in_summary: witnessPresentIn(nSection, w),
        present_in_verbatim_window: witnessPresentIn(nWindow, w),
        present_in_prompt: witnessPresentIn(nPrompt, w),
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// THE FLOOR — the narrow set whose loss is a defect, not a grade
// ---------------------------------------------------------------------------

export interface FloorViolation {
  readonly floor: 'MEM-FLOOR-1' | 'MEM-FLOOR-2';
  readonly fact_id: string;
  readonly detail: string;
  /** Present ONLY under `onUnsound: 'tag'` — the violation may be an artefact of
   *  the lexical detector rather than a real loss. Never absent-and-untrue. */
  readonly detector_unsound?: true;
}

/** Message used by both the refusal and the tag, so the two paths cannot drift. */
export const DETECTOR_UNSOUND_FOR_FLOORS =
  'the summariser for this run does not carry the user\'s words verbatim ' +
  '(detector_sound_for_floors=false), so the LEXICAL detector reads a faithful ' +
  'paraphrase as a LOSS. A run measured by the reviewer: a summary preserving all ' +
  'ten facts IN MEANING scored 1/10 with 2 MEM-FLOOR-1 violations, having lost ' +
  'nothing. READ THE TABLE, NOT THE FLOORS — the retained column is a lower bound. ' +
  'Pass { onUnsound: \'tag\' } if you want the violations anyway, labelled as ' +
  'possible detector artefacts.';

/**
 * Evaluate the two floors that RED the build. Everything else the eval produces
 * is a MEASUREMENT: retention of a mid-conversation constraint is graded, and
 * gating on a graded number would either be arbitrary or would freeze today's
 * behaviour as correct.
 *
 * MEM-FLOOR 1 — a fact marked `floor` (the DECISION GOAL, a USER CORRECTION) is
 *   absent from the injected summary. This is what a tester experiences as "it
 *   forgot what I said" on the first turn they notice.
 *
 * MEM-FLOOR 2 — a SUPERSEDED value survives while the CORRECTION that replaced
 *   it does not. That is not forgetting; the system is then holding, and will
 *   act on, a number the user explicitly withdrew.
 *
 * ⚠ REFUSES on a detector-unsound run (A2). The floors are only meaningful when
 * the summariser carries the user's words verbatim; against a paraphrasing model
 * they report the detector's limits as product defects. `run` is taken (not just
 * the measurement) precisely so that soundness cannot be forgotten at a call
 * site — the guard is not something a caller has to remember to ask for.
 */
export function evaluateFloors(
  kase: RetentionCase,
  run: RetentionRunResult,
  m: RetentionMeasurement,
  opts: { readonly onUnsound: 'refuse' | 'tag' } = { onUnsound: 'refuse' },
): FloorViolation[] {
  if (!run.measurements.includes(m)) {
    throw new Error(
      'memory-retention eval: evaluateFloors was given a measurement that does not belong to ' +
        `the run passed alongside it (run ${run.case_id}, measurement at turn ${m.at_turn}). ` +
        'Pairing a measurement with the wrong run would evaluate one arm under another arm\'s ' +
        'soundness verdict.',
    );
  }
  if (!run.detector_sound_for_floors && opts.onUnsound === 'refuse') {
    throw new Error(`memory-retention eval: REFUSING to evaluate the floors — ${DETECTOR_UNSOUND_FOR_FLOORS}`);
  }
  const unsoundTag: { detector_unsound?: true } = run.detector_sound_for_floors
    ? {}
    : { detector_unsound: true };
  const violations: FloorViolation[] = [];
  const byId = new Map(m.facts.map((f) => [f.id, f] as const));

  for (const reading of m.facts) {
    if (!reading.floor) continue;
    if (!reading.retained_in_summary) {
      violations.push({
        floor: 'MEM-FLOOR-1',
        fact_id: reading.id,
        detail:
          `turn ${m.at_turn}: "${reading.id}" (${reading.kind}, stated at turn ` +
          `${reading.stated_at_turn}) is ABSENT from the injected conversation summary. ` +
          `Injected block was:\n${m.section_text}`,
        ...unsoundTag,
      });
    }
  }

  for (const spec of kase.facts) {
    if (spec.supersedes === undefined) continue;
    const correction = byId.get(spec.id);
    const superseded = byId.get(spec.supersedes);
    if (!correction || !superseded) continue;
    if (superseded.retained_in_summary && !correction.retained_in_summary) {
      violations.push({
        floor: 'MEM-FLOOR-2',
        fact_id: spec.id,
        detail:
          `turn ${m.at_turn}: the SUPERSEDED value "${spec.supersedes}" survived in memory ` +
          `while the correction "${spec.id}" that replaced it did not. The system now holds a ` +
          `value the user explicitly withdrew. Injected block was:\n${m.section_text}`,
        ...unsoundTag,
      });
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// Fixture integrity — a golden pack that cannot rot quietly
// ---------------------------------------------------------------------------

/**
 * Every witness set must DISCRIMINATE, in both directions, against the fixture
 * itself: present in the turn that states it, and absent from every other turn
 * (user AND assistant text). Without this, retention could be read off an
 * unrelated sentence and a green table would mean nothing.
 */
export function assertWitnessesAreDiscriminating(kase: RetentionCase): void {
  const problems: string[] = [];
  // eff-8: the 2N turn strings are compared against every fact, so normalise them
  // (and each witness) once instead of 2N x facts times.
  const turns = kase.turns.map((t) => ({
    n: t.n,
    user: normaliseForDetection(t.user),
    assistant: normaliseForDetection(t.assistant),
  }));
  for (const f of kase.facts) {
    const w = f.witness.map(normaliseForDetection);
    if (f.stated_at_turn === null) {
      const anywhere = turns.some(
        (t) => witnessPresentIn(t.user, w) || witnessPresentIn(t.assistant, w),
      );
      if (anywhere) {
        problems.push(`${f.id}: never-stated control IS present somewhere in the conversation`);
      }
      continue;
    }
    const own = turns.find((t) => t.n === f.stated_at_turn);
    if (!own || !witnessPresentIn(own.user, w)) {
      problems.push(`${f.id}: witness is NOT present in its own stating turn ${f.stated_at_turn}`);
    }
    for (const t of turns) {
      if (t.n === f.stated_at_turn) continue;
      if (witnessPresentIn(t.user, w) || witnessPresentIn(t.assistant, w)) {
        problems.push(`${f.id}: witness also matches turn ${t.n} — not discriminating`);
      }
    }
  }
  if (problems.length > 0) {
    throw new Error(`memory-retention fixture is not discriminating:\n - ${problems.join('\n - ')}`);
  }
}

/**
 * The statement-recovery contract `splitStatements` depends on: every user turn
 * that trips the durability lexicon must be exactly ONE sentence, terminated by
 * a single full stop and containing no other. If a fixture author breaks this,
 * statement counts and drop accounting silently mis-report — so it fails here
 * instead.
 */
export function assertStatementsAreSingleSentences(kase: RetentionCase): void {
  const problems: string[] = [];
  for (const t of kase.turns) {
    if (!DURABILITY_MARKER_RE.test(t.user)) continue;
    const stops = (t.user.match(/\./g) ?? []).length;
    if (stops !== 1 || !t.user.trimEnd().endsWith('.')) {
      problems.push(`turn ${t.n}: durable statement must be ONE sentence ending in a single "." — got ${stops}`);
    }
  }
  if (problems.length > 0) {
    throw new Error(
      `memory-retention fixture breaks the statement-recovery contract:\n - ${problems.join('\n - ')}`,
    );
  }
}

/** Render the per-fact retention table for the evidence file / CI log. */
/**
 * The ids of MEASURABLE facts (i.e. excluding the never-stated control) that the
 * injected summary no longer witnesses at `turn`, sorted.
 *
 * ONE definition. This filter had been written three times under three names
 * (`lost` / `lostIn` / `lostAt`) across the ARM B assertions, and one of those
 * three is the NON-VACUITY guard — the one that proves the budget arm actually
 * dropped something. A divergence between them would not have gone red; it would
 * have made the measurement quietly wrong, which is the worse failure.
 */
export function lostFactIds(run: RetentionRunResult, turn: number): string[] {
  const m = run.measurements.find((x) => x.at_turn === turn);
  if (!m) {
    throw new Error(
      `memory-retention eval: no measurement at turn ${turn} for case ${run.case_id} ` +
        `(measured: ${run.measurements.map((x) => x.at_turn).join(', ') || 'none'})`,
    );
  }
  return m.facts
    .filter((f) => f.stated_at_turn !== null && !f.retained_in_summary)
    .map((f) => f.id)
    .sort();
}

/**
 * The stand-in caveat, DERIVED from the run (A1).
 *
 * The report is designed to be extracted (`MEMORY_RETENTION_REPORT_PATH`), and an
 * extracted artefact reading `retained 10/10` under the title "MEMORY-RETENTION
 * EVAL REPORT" is exactly how a later lane closes rec 8 off a stand-in's numbers.
 * The caveat therefore travels WITH the numbers, not only in the files that
 * reader will never open.
 */
export function renderModelProvenanceHeader(result: RetentionRunResult): string {
  if (result.model_kind === 'deterministic-stand-in') {
    return (
      '**MODEL: deterministic stand-in**, supplied through the sanctioned ' +
      '`SummariserModel` port — **NO live model was called and the real (haiku) ' +
      "summariser's retention is NOT measured by this report.** These numbers are " +
      'about the PIPELINE and about the system\'s response to a drop. For the live ' +
      'table see declared gap 1: `runRetentionEval({ kase, model: new ' +
      'AnthropicSummariserModel(), measureAtTurns: [19, 20] })` — which needs an ' +
      'API key, costs money, and is a TABLE, never a gate.' +
      (result.detector_sound_for_floors
        ? ''
        : ' ⚠ `detector_sound_for_floors=false` on this run — the floors are not applicable.')
    );
  }
  return (
    '**⚠ MODEL: EXTERNAL / UNVERIFIED** — supplied by the caller, not built by this ' +
    `module. \`detector_sound_for_floors=${result.detector_sound_for_floors}\`. The ` +
    'detector is LEXICAL, so a faithful paraphrase reads as a LOSS: the retained ' +
    'column is a **LOWER BOUND** and the FLOORS DO NOT APPLY. Read the table only.'
  );
}

export function renderRetentionTable(label: string, result: RetentionRunResult): string {
  const lines: string[] = [`#### ${label} — case \`${result.case_id}\``];
  for (const m of result.measurements) {
    const measurable = m.facts.filter((f) => f.stated_at_turn !== null);
    const retained = measurable.filter((f) => f.retained_in_summary).length;
    lines.push(
      '',
      `**turn ${m.at_turn}** · generator=\`${m.stored_generator}\` v${m.stored_version} · ` +
        // R3: the STORED text is what the 1,600 cap governs; the INJECTED block is
        // re-rendered from slots WITH provenance stamps and is uncapped, so the two
        // numbers differ and only one of them is bounded. Report both.
        `stored ${m.stored_chars} chars · injected ${m.section_text.length} chars · ` +
        `stale=\`${m.stale}\` · lag=${m.lag_turns} · ` +
        `summarised=${m.summarised_turns} · history_capped=\`${m.history_capped}\` · ` +
        `durable entries/slot=${JSON.stringify(m.durable_entries_per_slot)} · ` +
        `statements/slot=${JSON.stringify(m.statements_per_slot)} · ` +
        `**retained ${retained}/${measurable.length}**`,
      '',
      '| fact | kind | stated turn | in summary | in verbatim window | in prompt | floor |',
      '|---|---|---|---|---|---|---|',
    );
    for (const f of m.facts) {
      lines.push(
        `| \`${f.id}\` | ${f.kind} | ${f.stated_at_turn ?? '—'} | ` +
          `${f.retained_in_summary ? '**YES**' : 'no'} | ` +
          `${f.present_in_verbatim_window ? 'YES' : 'no'} | ` +
          `${f.present_in_prompt ? 'YES' : 'no'} | ${f.floor ? 'FLOOR' : ''} |`,
      );
    }
  }
  return lines.join('\n');
}
