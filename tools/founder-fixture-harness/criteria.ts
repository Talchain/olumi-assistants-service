/**
 * ACCEPTANCE.md section A — the six deterministic criteria, decided.
 *
 * Pure functions over captured turns. No network, no clock, no filesystem: the
 * same code decides a live run and a replay fixture, which is what makes the
 * RED fixtures in `fixtures/` real proof that every criterion has an exercised
 * path to FAIL.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT EACH CRITERION CAN AND CANNOT BE DECIDED FROM, STATED ONCE.
 *
 *   C1  licence   WIRE   ·  rendered badge          DOM-ONLY
 *   C2  material  WIRE   ·  "on the surface"        DOM-ONLY
 *   C3            WIRE (in full)
 *   C4  5 pairs   WIRE (needs the UI detector) · CX3's visible-body limb NOT ON THE WIRE
 *   C5            WIRE (in full)
 *   C6  misroute  WIRE   ·  "answers the question"  SEMANTIC, not machine-decidable
 *
 * A criterion carrying an undecidable limb can therefore be REFUTED here and
 * never CERTIFIED here. `composeVerdict` enforces that; see `types.ts`.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import type { CriterionResult, LimbResult, TurnCapture, Verdict } from './types.js';
import { composeVerdict } from './types.js';
import type { DetectorBundle } from './detectors.js';
import {
  ADMISSION_FIELDS,
  carriesAnalysisResult,
  currentGraphHash,
  licensesComparativeLeader,
  readAdmission,
  readGraphPatches,
  admissionRefuses,
  topLevelGraphHash,
} from './admission.js';
import {
  blockTypesPresent,
  collectAllStrings,
  collectUserVisibleStrings,
  collectAllKeys,
  excerpt,
} from './payload-scan.js';
import {
  BRIEF_TURN_INDEX,
  C3_SCOPE_NOTE,
  C5_TARGET_LABEL_TOKENS,
  C5_TARGET_MIN_TOKEN_HITS,
} from './script.js';

export interface EvaluationInput {
  /** Index 0 is the brief; 1..11 are the scripted turns. */
  readonly turns: readonly TurnCapture[];
  readonly detectors: DetectorBundle;
  /** `adaptCapture` from the UI coherence module, when it loaded. */
  readonly adaptCapture?: (raw: unknown) => unknown;
}

export interface Evaluation {
  readonly criteria: readonly CriterionResult[];
  readonly caveats: readonly string[];
}

// ---------------------------------------------------------------------------
// Small shared readers
// ---------------------------------------------------------------------------

function turnAt(turns: readonly TurnCapture[], index: number): TurnCapture | undefined {
  return turns.find((t) => t.index === index);
}

function reached(turn: TurnCapture | undefined): boolean {
  return turn !== undefined && turn.transportError === undefined && turn.body !== undefined;
}

function limb(
  id: string,
  question: string,
  decidability: LimbResult['decidability'],
  verdict: Verdict,
  evidence: readonly string[],
): LimbResult {
  return { id, question, decidability, verdict, evidence };
}

function turnLabel(t: TurnCapture): string {
  return t.index === BRIEF_TURN_INDEX ? 'turn 0 (the brief)' : `turn ${t.index}`;
}

/**
 * What the turn SAID, for the evidence of any limb that FAILS on structure.
 *
 * ⚠ ADDED AFTER THE FIRST LIVE RUN, WHICH RETURNED C5 FAIL AND COULD NOT BE
 * ADJUDICATED. Turn 5 carried no `graph_patch` block and the graph hash did not
 * move — structurally, the correction did not reach the object. But "Can you
 * update it with the correct range?" names no range, so a CLARIFYING QUESTION
 * is a legitimate answer, and a clarifying question also produces no patch and
 * no hash movement. The two are indistinguishable from structure alone, and the
 * report printed no prose, so the FAIL could not be told from correct
 * behaviour by anyone reading it.
 *
 * The structural verdict is unchanged — the criterion is about the correction
 * REACHING the object, and it did not. What changes is that a reader can now
 * see WHY, and can say whether the product asked or claimed.
 */
function saidWhat(t: TurnCapture | undefined): string {
  if (t === undefined || t.body === undefined) return 'said: (no body)';
  const text = collectUserVisibleStrings(t.body).find((s) => s.path === 'assistant_text')?.value;
  return text === undefined ? 'said: (no assistant_text)' : `said: "${excerpt(text, 600)}"`;
}

// ---------------------------------------------------------------------------
// C1 — no leader / rank / standing / robustness designation before the licence
// ---------------------------------------------------------------------------

export interface UnlicensedFinding {
  readonly kind: 'prose' | 'structure';
  readonly path: string;
  readonly detail: string;
}

/**
 * Which arm of C1 a turn belongs to. THE TWO ARMS ARE SCANNED DIFFERENTLY, AND
 * THAT IS NOT A CONVENIENCE — it is the difference between two producer
 * projections that deliberately disagree.
 *
 *   `unrequested`  the post-draft auto-run nobody asked for. CEE's
 *                  `unrequested-analysis-confinement.ts` DROPS comparative
 *                  standing (`win_probability`, `winner_id`) and robustness
 *                  verdicts from it, because a run the user did not ask for
 *                  passes no verdicts.
 *   `requested`    a run the user clicked whose CLAIM is withheld.
 *                  `withheld-claim-projection.ts` KEEPS every per-option
 *                  probability — its own docstring: "the ruling of 2026-07-27
 *                  keeps every per-option probability, and the route test
 *                  asserts its PRESENCE on a withheld turn as the
 *                  anti-over-suppression pin".
 *
 * ⚠ SO APPLYING THE UNREQUESTED PREDICATES TO A REQUESTED TURN WOULD
 * MANUFACTURE A FAILURE. `keyStatesComparativeStanding('win_probability')` is
 * TRUE, and `analysis_ready.options[].win_probability` rides every withheld
 * requested run legitimately. Two predicates, two questions, and merging them
 * is CLAUDE.md trap 21 exactly.
 *
 * Both arms share the predicates that are unconditional: a LEADING OPTION and
 * an ORDINAL RANK are designations no unlicensed turn may make either way.
 */
export type C1Arm = 'unrequested' | 'requested';

/**
 * A narrow prose floor for the two words ACCEPTANCE.md C1 names that no wire
 * key family covers on a REQUESTED turn: "Stable" and "Robust" as verdicts
 * about the result.
 *
 * ⚠ A SAMPLED FLOOR, NOT AN ENUMERATION, AND ANCHORED HARD ON PURPOSE.
 * `blocked-claim-fields.ts` covers the metric noun `robustness` and expressly
 * does NOT cover the adjective ("a robust decision" must keep passing). The
 * criterion, though, names the WORDS as they appear on screen — the UI emits
 * "Stable ranking" from `postAnalysisFooter.ts` and `lib/stability.ts`. So this
 * pattern set requires the word to be predicated of the RESULT, which is what
 * makes it a verdict rather than ordinary English.
 *
 * A clean scan here is not proof that no stability claim was made; it is proof
 * that none of THESE shapes appeared. The unit test pins both directions.
 */
export const STABILITY_VERDICT_PATTERNS: readonly RegExp[] = Object.freeze([
  /\bstable\s+ranking\b/i,
  /\b(?:ranking|result|results|answer|analysis|comparison|verdict|ordering)\s+(?:is|are|looks?|remains?)\s+(?:stable|robust)\b/i,
  /\brobust\s+(?:ranking|result|results|verdict|ordering)\b/i,
]);

export function findStabilityVerdict(text: string): string | null {
  for (const re of STABILITY_VERDICT_PATTERNS) {
    const m = re.exec(text);
    if (m !== null) return m[0];
  }
  return null;
}

/**
 * Does this VALUE carry a designation, or is the key merely present?
 * `null`, `undefined`, `false`, an empty string, an empty array and an empty
 * object all designate nothing. See the note at the call site.
 */
export function valueDesignates(value: unknown): boolean {
  if (value === null || value === undefined || value === false) return false;
  if (typeof value === 'string') return value.length > 0;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as object).length > 0;
  return false;
}

/**
 * Everything on this payload that designates a leading option, a rank, a
 * comparative standing, or a robustness verdict.
 *
 * Every predicate is the PRODUCER'S OWN. `findLeaderClaims` is the alarm CEE
 * already runs at egress (its own docstring: "a false positive costs one noisy
 * log line. A false NEGATIVE costs a shipped contradiction. Bias wide") —
 * exactly the bias an acceptance harness wants. The key predicates are the
 * same functions the withheld-claim and unrequested-run projections use to
 * decide what to DROP, so a key this finds is a key the product would have
 * suppressed had it known it must.
 */
export function scanUnlicensedClaims(
  body: TurnCapture['body'],
  detectors: DetectorBundle,
  arm: C1Arm = 'requested',
): readonly UnlicensedFinding[] {
  const out: UnlicensedFinding[] = [];
  if (body === undefined) return out;

  for (const hit of detectors.leaderClaim.findClaims(body as never)) {
    out.push({ kind: 'prose', path: hit.path, detail: `leader claim (${hit.code})` });
  }

  for (const { path, key, value } of collectAllKeys(body)) {
    // ⚠ A DESIGNATING KEY WITH NO VALUE DESIGNATES NOTHING, and the boundary
    // schema forces several of these keys to be PRESENT: `analysis_result`
    // requires `leading_option_id: string | null`, so a correctly-withholding
    // turn ships the key with `null`. Failing on key NAME alone would mark
    // every honest withheld run as a violation — an alarm that always rings.
    //
    // The producer's own alarm applies the same rule and states it: the egress
    // guard's `scanKey` "returns immediately unless `typeof value === 'string'
    // && value.length > 0`". This harness is deliberately STRICTLY STRONGER on
    // one axis — it also counts finite NUMBERS and non-empty containers,
    // because `rank: 1` and `win_probability: 0.62` are precisely the numeric
    // designations the two projections DROP, and the string-only alarm cannot
    // see them. The divergence is one-directional and recorded here rather
    // than left for a future reader to find as a mystery hit.
    if (!valueDesignates(value)) continue;
    if (detectors.leaderClaim.keyDesignatesLeader(key)) {
      out.push({ kind: 'structure', path, detail: `key designates a leading option (${key})` });
    } else if (detectors.leaderClaim.keyDesignatesOrdinal(key)) {
      out.push({ kind: 'structure', path, detail: `key designates an ordinal position (${key})` });
    } else if (arm === 'unrequested' && detectors.leaderClaim.keyStatesStanding(key)) {
      out.push({
        kind: 'structure',
        path,
        detail: `key states a comparative standing on an UNREQUESTED run (${key})`,
      });
    } else if (arm === 'unrequested' && detectors.leaderClaim.keyStatesRobustness(key)) {
      out.push({
        kind: 'structure',
        path,
        detail: `key states a robustness verdict on an UNREQUESTED run (${key})`,
      });
    }
  }

  for (const { path, value } of collectUserVisibleStrings(body)) {
    for (const m of detectors.claimVocabulary.findMatches(value)) {
      out.push({ kind: 'prose', path, detail: `${m} — ${excerpt(value, 140)}` });
    }
    const stability = findStabilityVerdict(value);
    if (stability !== null) {
      out.push({
        kind: 'prose',
        path,
        detail: `stability/robustness verdict "${stability}" — ${excerpt(value, 140)}`,
      });
    }
  }

  // De-duplicate on path+detail; one key can trip two readers.
  const seen = new Set<string>();
  return out.filter((f) => {
    const k = `${f.path}::${f.detail}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function evaluateC1Arm(
  id: string,
  question: string,
  turn: TurnCapture | undefined,
  detectors: DetectorBundle,
  arm: C1Arm,
): LimbResult {
  if (!reached(turn)) {
    return limb(id, question, 'wire', 'NOT_ASSESSED', [
      turn === undefined
        ? 'that turn was never sent'
        : `that turn did not return a body: ${turn.transportError ?? `HTTP ${turn.httpStatus}`}`,
    ]);
  }
  const t = turn as TurnCapture;
  const admission = readAdmission(t.body);
  const licence = licensesComparativeLeader(admission);

  if (licence === 'unknown') {
    return limb(id, question, 'wire', 'NOT_ASSESSED', [
      `${turnLabel(t)}: ${admission.kind === 'absent' ? admission.why : 'admission unreadable'}`,
      'ABSENCE IS NOT REFUSAL — the producer contract says a missing admission means an older ' +
        'producer, and the UI treats it as licensing the claim. Scoring it as "not licensed" ' +
        'would make an old CEE read as a PASS.',
    ]);
  }

  if (!carriesAnalysisResult(t.body) && !hasAnyAnalysisSurface(t)) {
    return limb(id, question, 'wire', 'NOT_ASSESSED', [
      `${turnLabel(t)} carried no analysis surface, so there was no unlicensed claim to make.`,
      `blocks: [${blockTypesPresent(t.body).join(', ')}]`,
    ]);
  }

  if (licence === true) {
    return limb(id, question, 'wire', 'PASS', [
      `${turnLabel(t)}: permitted_analysis_mode licenses a comparative leader ` +
        `(${admission.kind === 'present' ? admission.permitted_analysis_mode : '?'}), so leader wording is permitted here.`,
      'Compared by RANK via the producer\'s modePermitsAtLeast, never by string equality.',
    ]);
  }

  const findings = scanUnlicensedClaims(t.body, detectors, arm);
  const mode = admission.kind === 'present' ? admission.permitted_analysis_mode : '?';
  if (findings.length === 0) {
    return limb(id, question, 'wire', 'PASS', [
      `${turnLabel(t)}: permitted_analysis_mode=${mode} (does not license a leader claim) and the ` +
        'payload carries no leader / rank / standing / robustness designation.',
      `scanned ${collectAllKeys(t.body).length} keys and ${collectUserVisibleStrings(t.body).length} user-visible strings`,
    ]);
  }
  return limb(id, question, 'wire', 'FAIL', [
    `${turnLabel(t)}: permitted_analysis_mode=${mode} does NOT license a leader claim, yet the payload makes ${findings.length}:`,
    ...findings.slice(0, 20).map((f) => `  ${f.kind} @ ${f.path} — ${f.detail}`),
    ...(findings.length > 20 ? [`  … and ${findings.length - 20} more`] : []),
  ]);
}

/** A turn that shows analysis-shaped surfaces even without a completed result. */
function hasAnyAnalysisSurface(t: TurnCapture): boolean {
  const rec = t.body as Record<string, unknown> | undefined;
  if (rec === undefined) return false;
  return rec.analysis_ready !== undefined || rec.analysis_state !== undefined;
}

function evaluateC1(input: EvaluationInput): CriterionResult {
  const { turns, detectors } = input;
  const claim =
    'On a fresh draft, no `Leading option` badge, no option rank badges, no "Ahead N%", and no ' +
    '"Stable" or "Robust" — on BOTH the analysis nobody asked for and the one the user clicks — ' +
    'until the shared admission returns `comparative_leader`.';

  if (!detectors.leaderClaim.status.available || !detectors.claimVocabulary.status.available) {
    return {
      id: 'C1',
      claim,
      verdict: 'NOT_ASSESSED',
      limbs: [
        limb('C1.instrument', 'can the leader/claim detectors see?', 'wire', 'NOT_ASSESSED', [
          `leader-claim detector: ${detectors.leaderClaim.status.reason ?? 'unavailable'}`,
          `claim-vocabulary detector: ${detectors.claimVocabulary.status.reason ?? 'unavailable'}`,
          'A detector whose positive control did not fire returns a confident zero for every absence claim.',
        ]),
      ],
    };
  }

  const limbs: LimbResult[] = [
    evaluateC1Arm(
      'C1.wire.unrequested-arm',
      'the analysis NOBODY ASKED FOR (the post-draft auto-run on the brief turn) makes no unlicensed leader claim',
      turnAt(turns, BRIEF_TURN_INDEX),
      detectors,
      'unrequested',
    ),
    evaluateC1Arm(
      'C1.wire.user-click-arm',
      'the analysis THE USER CLICKS (turn 2, "Run analysis.") makes no unlicensed leader claim',
      turnAt(turns, 2),
      detectors,
      'requested',
    ),
  ];

  // Every other analysis-bearing turn, folded into one limb so the report does
  // not sprout a limb per turn — but each failing turn is named in evidence.
  const others = turns.filter(
    (t) => t.index !== BRIEF_TURN_INDEX && t.index !== 2 && reached(t) && hasAnyAnalysisSurface(t),
  );
  if (others.length === 0) {
    limbs.push(
      limb(
        'C1.wire.remaining-turns',
        'no other turn makes an unlicensed leader claim',
        'wire',
        'NOT_ASSESSED',
        ['no other turn carried an analysis surface'],
      ),
    );
  } else {
    const evidence: string[] = [];
    let anyFail = false;
    let anyDecided = false;
    for (const t of others) {
      const admission = readAdmission(t.body);
      const licence = licensesComparativeLeader(admission);
      if (licence === 'unknown') {
        evidence.push(`${turnLabel(t)}: NOT ASSESSED — ${admission.kind === 'absent' ? admission.why : 'unreadable'}`);
        continue;
      }
      anyDecided = true;
      if (licence === true) {
        evidence.push(`${turnLabel(t)}: licensed (comparative_leader) — leader wording permitted`);
        continue;
      }
      const findings = scanUnlicensedClaims(t.body, detectors, 'requested');
      if (findings.length === 0) {
        evidence.push(`${turnLabel(t)}: unlicensed and clean`);
      } else {
        anyFail = true;
        evidence.push(
          `${turnLabel(t)}: unlicensed yet makes ${findings.length} designation(s): ` +
            findings.slice(0, 6).map((f) => `${f.path} (${f.detail})`).join('; '),
        );
      }
    }
    limbs.push(
      limb(
        'C1.wire.remaining-turns',
        'no other turn makes an unlicensed leader claim',
        'wire',
        anyFail ? 'FAIL' : anyDecided ? 'PASS' : 'NOT_ASSESSED',
        evidence,
      ),
    );
  }

  limbs.push(
    limb(
      'C1.dom.rendered-badges',
      'no `Leading option` pill, rank badge, "Ahead N%" caption, "Stable" or "Robust" word is RENDERED',
      'dom-only',
      'NOT_ASSESSED',
      [
        'A wire harness cannot see the DOM. The badges are emitted by UI components ' +
          '(OptionNode "Leading option" pill, the "Ahead N%" caption, postAnalysisFooter\'s ' +
          '"Stable ranking", lib/stability.ts) and whether they mount is a rendering question.',
        'This limb is why C1 can be REFUTED by this harness and never CERTIFIED by it.',
      ],
    ),
  );

  return { id: 'C1', claim, verdict: composeVerdict(limbs), limbs };
}

// ---------------------------------------------------------------------------
// C2 — a refusal names the field that refused it, and survives a reload
// ---------------------------------------------------------------------------

interface RefusalRead {
  readonly turn: TurnCapture;
  readonly refuses: boolean;
  readonly reasons: readonly { field: string; code: string; message: string }[];
  readonly mode: string;
  readonly readable: boolean;
}

function readRefusals(turns: readonly TurnCapture[]): readonly RefusalRead[] {
  const out: RefusalRead[] = [];
  for (const t of turns) {
    if (!reached(t)) continue;
    const admission = readAdmission(t.body);
    const refuses = admissionRefuses(admission, t.body);
    out.push({
      turn: t,
      refuses: refuses === true,
      readable: refuses !== 'unknown',
      reasons: admission.kind === 'present' ? admission.reasons : [],
      mode: admission.kind === 'present' ? admission.permitted_analysis_mode : 'absent',
    });
  }
  return out;
}

function evaluateC2(input: EvaluationInput): CriterionResult {
  const { turns, detectors } = input;
  const claim =
    'A refusal states which field refused it and what would change it, on the surface, and survives ' +
    'a reload. The unsafe claim must never outlive the refusal.';

  const reads = readRefusals(turns);
  const refusing = reads.filter((r) => r.refuses);
  const limbs: LimbResult[] = [];

  // --- limb 1: names the field, in words a user can act on -----------------
  if (refusing.length === 0) {
    const unreadable = reads.filter((r) => !r.readable).length;
    limbs.push(
      limb(
        'C2.wire.names-the-field',
        'every refusal ships at least one reason naming the field that refused it, with a non-empty user-facing message',
        'wire',
        'NOT_ASSESSED',
        [
          'NO REFUSAL OCCURRED IN THIS RUN, so the criterion had nothing to decide. This is NOT a pass: ' +
            'a criterion whose antecedent never fired has not been tested.',
          `${reads.length} turns read; ${unreadable} carried no readable admission.`,
        ],
      ),
    );
  } else {
    const evidence: string[] = [];
    let anyFail = false;
    for (const r of refusing) {
      if (r.reasons.length === 0) {
        anyFail = true;
        evidence.push(
          `${turnLabel(r.turn)}: REFUSES (permitted_analysis_mode=${r.mode}) with an EMPTY reasons[]. ` +
            "The producer's own invariant is that a refusal is never silent.",
        );
        continue;
      }
      const named = r.reasons.filter(
        (x) => ADMISSION_FIELDS.includes(x.field) && x.message.trim().length > 0,
      );
      if (named.length === 0) {
        anyFail = true;
        evidence.push(
          `${turnLabel(r.turn)}: REFUSES but no reason both names a known field and carries a message. ` +
            `reasons=${JSON.stringify(r.reasons)}`,
        );
        continue;
      }
      // A message that leaks an internal identifier is not "what would change it".
      const leaky = named.filter((x) => detectors.narration.findHit(x.message) !== null);
      if (leaky.length > 0) {
        anyFail = true;
        evidence.push(
          `${turnLabel(r.turn)}: refusal message carries process narration — ` +
            leaky.map((x) => `${x.field}: ${excerpt(x.message, 120)}`).join(' | '),
        );
        continue;
      }
      evidence.push(
        `${turnLabel(r.turn)}: REFUSES (mode=${r.mode}) and names ` +
          named.map((x) => `${x.field} (${x.code}): "${excerpt(x.message, 100)}"`).join(' | '),
      );
    }
    limbs.push(
      limb(
        'C2.wire.names-the-field',
        'every refusal ships at least one reason naming the field that refused it, with a non-empty user-facing message',
        'wire',
        anyFail ? 'FAIL' : 'PASS',
        evidence,
      ),
    );
  }

  // --- limb 2: survives the reload ----------------------------------------
  const lastBeforeReload = reads.filter((r) => r.turn.index === 10)[0];
  const afterReload = reads.filter((r) => r.turn.index === 11)[0];
  if (lastBeforeReload === undefined || afterReload === undefined) {
    limbs.push(
      limb(
        'C2.wire.survives-reload',
        'a refusal standing at turn 10 is still stated, with reasons, after turn 11 re-enters the scenario',
        'wire',
        'NOT_ASSESSED',
        ['turn 10 and/or turn 11 did not return a readable body'],
      ),
    );
  } else if (!lastBeforeReload.refuses) {
    limbs.push(
      limb(
        'C2.wire.survives-reload',
        'a refusal standing at turn 10 is still stated, with reasons, after turn 11 re-enters the scenario',
        'wire',
        'NOT_ASSESSED',
        [
          'no refusal stood at turn 10, so there was nothing that had to survive the reload. Not a pass.',
          `turn 10 mode=${lastBeforeReload.mode}`,
        ],
      ),
    );
  } else {
    const stillRefuses = afterReload.refuses && afterReload.reasons.length > 0;
    limbs.push(
      limb(
        'C2.wire.survives-reload',
        'a refusal standing at turn 10 is still stated, with reasons, after turn 11 re-enters the scenario',
        'wire',
        stillRefuses ? 'PASS' : 'FAIL',
        [
          `turn 10: refuses, mode=${lastBeforeReload.mode}, ${lastBeforeReload.reasons.length} reason(s)`,
          `turn 11: refuses=${afterReload.refuses}, mode=${afterReload.mode}, ${afterReload.reasons.length} reason(s)`,
          'The admission is a pure function of the graph (resolveAnalysisAdmission), so it is RECOMPUTED ' +
            'on turn 11 rather than restored — which is what makes this half decidable on the wire at all.',
        ],
      ),
    );
  }

  // --- limb 3: the unsafe claim does not outlive the refusal ---------------
  if (afterReload === undefined || !afterReload.refuses) {
    limbs.push(
      limb(
        'C2.wire.no-claim-outlives-the-refusal',
        'the turn after the reload carries no leader / rank / standing / robustness designation while refusing',
        'wire',
        'NOT_ASSESSED',
        ['turn 11 did not refuse (or did not return), so no claim could outlive a refusal'],
      ),
    );
  } else {
    const findings = detectors.leaderClaim.status.available
      ? scanUnlicensedClaims(afterReload.turn.body, detectors, 'requested')
      : [];
    limbs.push(
      limb(
        'C2.wire.no-claim-outlives-the-refusal',
        'the turn after the reload carries no leader / rank / standing / robustness designation while refusing',
        'wire',
        !detectors.leaderClaim.status.available
          ? 'NOT_ASSESSED'
          : findings.length === 0
            ? 'PASS'
            : 'FAIL',
        findings.length === 0
          ? ['turn 11 refuses and carries no designation']
          : findings.slice(0, 10).map((f) => `turn 11: ${f.kind} @ ${f.path} — ${f.detail}`),
      ),
    );
  }

  limbs.push(
    limb(
      'C2.dom.on-the-surface',
      'the refusal, and the field that caused it, are SHOWN to the user',
      'dom-only',
      'NOT_ASSESSED',
      [
        'A wire harness cannot see what was rendered. It is worth stating that the material is ' +
          'reachable on the wire and, at the UI tip this fixture was banked against, ' +
          '`analysis_admission` had two non-test references (both type/plumbing) and no renderer ' +
          'reading `reasons[]` — so a wire PASS here would say nothing about what a user reads.',
      ],
    ),
  );

  return { id: 'C2', claim, verdict: composeVerdict(limbs), limbs };
}

// ---------------------------------------------------------------------------
// C3 — no routing narration, scratchpad or chain-of-thought
// ---------------------------------------------------------------------------

function evaluateC3(input: EvaluationInput): { criterion: CriterionResult; caveats: string[] } {
  const { turns, detectors } = input;
  const claim = 'No routing narration, scratchpad or chain-of-thought reaches the user on any of the 11 turns.';
  const caveats: string[] = [];

  if (!detectors.narration.status.available) {
    return {
      criterion: {
        id: 'C3',
        claim,
        verdict: 'NOT_ASSESSED',
        limbs: [
          limb('C3.instrument', 'can the narration detector see?', 'wire', 'NOT_ASSESSED', [
            detectors.narration.status.reason ?? 'unavailable',
          ]),
        ],
      },
      caveats,
    };
  }

  const userVisibleHits: string[] = [];
  const payloadWideOnly: string[] = [];
  let scanned = 0;

  for (const t of turns) {
    if (!reached(t)) continue;
    const visible = collectUserVisibleStrings(t.body);
    const visiblePaths = new Set(visible.map((v) => v.path));
    scanned += visible.length;
    for (const { path, value } of visible) {
      const hit = detectors.narration.findHit(value);
      if (hit !== null) {
        userVisibleHits.push(`${turnLabel(t)} @ ${path} — marker ${JSON.stringify(hit)} — ${excerpt(value)}`);
      }
    }
    for (const { path, value } of collectAllStrings(t.body)) {
      if (visiblePaths.has(path)) continue;
      const hit = detectors.narration.findHit(value);
      if (hit !== null) {
        payloadWideOnly.push(
          `${turnLabel(t)} @ ${path} — marker ${JSON.stringify(hit)} — ${excerpt(value, 140)}`,
        );
      }
    }
  }

  const evidence: string[] = [
    C3_SCOPE_NOTE,
    `scanned ${scanned} user-visible strings across ${turns.filter(reached).length} returned turns`,
    `detector: ${detectors.narration.status.source}`,
  ];
  if (userVisibleHits.length > 0) {
    evidence.push('USER-VISIBLE NARRATION:', ...userVisibleHits.slice(0, 25));
  }
  if (payloadWideOnly.length > 0) {
    evidence.push(
      `RECORDED, NOT DECIDED — ${payloadWideOnly.length} narration marker(s) in payload fields this ` +
        'harness does not classify as user-visible. Whether the UI renders them is a DOM question:',
      ...payloadWideOnly.slice(0, 15),
    );
  }

  caveats.push(
    'C3 KNOWN-NOT-COVERED CLASS, declared by the detector itself: an ordinary-English planning ' +
      'sentence with no internal marker (the module names "I should offer concrete candidate values") ' +
      'is process narration and is NOT detected. C3 PASS therefore means "no marker in the canonical ' +
      'vocabulary", not "no narration of any kind".',
    'C3 COVERAGE CAVEAT: `applyProcessNarrationGuard` has three non-test call sites (turn-executor, ' +
      'chip-click-dispatch, edit-graph-dispatch). The 3 Sep witnessed leaks landed on coach / converse / ' +
      'text_only paths, which are not among them. A clean scan is evidence about the OUTPUT, not ' +
      'evidence that the guard ran.',
  );

  return {
    criterion: {
      id: 'C3',
      claim,
      verdict: userVisibleHits.length === 0 ? 'PASS' : 'FAIL',
      limbs: [
        limb(
          'C3.wire.no-narration',
          'no string a user sees, on any send, matches the canonical process-narration vocabulary',
          'wire',
          userVisibleHits.length === 0 ? 'PASS' : 'FAIL',
          evidence,
        ),
      ],
    },
    caveats,
  };
}

// ---------------------------------------------------------------------------
// C4 — no surface contradicts another on the state of the analysis
// ---------------------------------------------------------------------------

function evaluateC4(input: EvaluationInput): CriterionResult {
  const { turns, detectors, adaptCapture } = input;
  const claim =
    'No surface contradicts another on the state of the analysis: if one says stale, none says current.';

  const cx3Limb = limb(
    'C4.wire.cx3-visible-body',
    'CX3 — a turn claiming the scenario was NEVER RUN while a result body is on screen',
    'wire',
    'NOT_ASSESSED',
    [
      'The detector declares this one itself: `resultBodyVisible` is "A PAYLOAD-SIDE PROXY, NOT A DOM ' +
        'FACT", sound in one direction only — it cannot witness a RETAINED prior body the turn did not ' +
        're-ship.',
      'Turn 11 (reload, then "Where did we get to?") is EXACTLY a retained-body state, so the limb the ' +
        'fixture exercises hardest is the limb the wire cannot decide. Reported unassessed rather than ' +
        'passed — this is the single place a harness would most plausibly manufacture a false pass.',
    ],
  );

  if (detectors.coherence.module === undefined || adaptCapture === undefined) {
    return {
      id: 'C4',
      claim,
      verdict: 'NOT_ASSESSED',
      limbs: [
        limb(
          'C4.wire.five-pairs',
          'CX1, CX2, CX4, CX5, CX6 — no pair of surfaces contradicts on any turn',
          'wire-conditional',
          'NOT_ASSESSED',
          [
            detectors.coherence.status.reason ?? 'coherence detector unavailable',
            'Not re-implemented here on purpose: a second copy of the contradiction gate would drift ' +
              'from the real one and its disagreements would be invisible.',
          ],
        ),
        cx3Limb,
      ],
    };
  }

  const violations: string[] = [];
  let evaluated = 0;
  for (const t of turns) {
    if (!reached(t)) continue;
    let capture: unknown;
    try {
      // `adaptCapture` returns an `AdaptedCapture` wrapper — `{ input,
      // analysisStateStatus, analysisStateError? }` — and the gate takes the
      // `CoherenceInput` INSIDE it. Handing it the wrapper throws on
      // `run_state`, which is how this was caught: every turn threw the same
      // TypeError, and a per-item probe returning an identical answer for every
      // item is evidence about the probe, not the data (CLAUDE.md trap 20).
      const adapted = adaptCapture(t.body) as { input?: unknown } | undefined;
      capture = adapted !== undefined && adapted !== null && 'input' in adapted ? adapted.input : adapted;
    } catch (err) {
      violations.push(`${turnLabel(t)}: adaptCapture threw — ${String(err)}`);
      continue;
    }
    let found: readonly { pair: string; code?: string; detail?: string }[];
    try {
      found = detectors.coherence.module.evaluate(capture);
    } catch (err) {
      violations.push(`${turnLabel(t)}: coherence evaluation threw — ${String(err)}`);
      continue;
    }
    evaluated += 1;
    for (const v of found) {
      if (v.pair === 'CX3') continue; // reported by its own limb, never folded in
      violations.push(`${turnLabel(t)}: ${v.pair}${v.code ? ` (${v.code})` : ''} ${v.detail ?? ''}`.trim());
    }
  }

  const fivePairs = limb(
    'C4.wire.five-pairs',
    'CX1, CX2, CX4, CX5, CX6 — no pair of surfaces contradicts on any turn',
    'wire-conditional',
    evaluated === 0 ? 'NOT_ASSESSED' : violations.length === 0 ? 'PASS' : 'FAIL',
    violations.length === 0
      ? [
          `${evaluated} turns evaluated through the UI's own detector; zero violations in the five ` +
            'wire-expressible pairs.',
          `detector: ${detectors.coherence.status.source}`,
          ...(evaluated === 0 ? ['no turn could be adapted, so nothing was actually evaluated'] : []),
        ]
      : violations.slice(0, 25),
  );

  const limbs = [fivePairs, cx3Limb];
  return { id: 'C4', claim, verdict: composeVerdict(limbs), limbs };
}

// ---------------------------------------------------------------------------
// C5 — the correction reaches the named object, and turn 6 reruns
// ---------------------------------------------------------------------------

export interface TargetResolution {
  readonly resolved: boolean;
  readonly nodeId?: string;
  readonly label?: string;
  readonly value?: unknown;
  readonly candidates: readonly { id: string; label: string; hits: number }[];
  readonly why: string;
}

function graphNodesFrom(turns: readonly TurnCapture[]): readonly Record<string, unknown>[] {
  for (const t of turns) {
    if (!reached(t)) continue;
    const rec = t.body as Record<string, unknown>;
    const dg = rec.draft_graph;
    if (typeof dg === 'object' && dg !== null) {
      const nodes = (dg as Record<string, unknown>).nodes;
      if (Array.isArray(nodes) && nodes.length > 0) {
        return nodes.filter((n): n is Record<string, unknown> => typeof n === 'object' && n !== null);
      }
    }
  }
  return [];
}

/**
 * Resolve C5's named object — "the sales headcount investment" — to ONE node
 * id in the drafted graph.
 *
 * ⚠ BY IDENTITY, NEVER BY VALUE (CLAUDE.md trap 19). "the factor whose value is
 * 80" is the obvious binding and it is wrong: the brief carries £80k-120k hire
 * cost, £20k tooling, £40k SDR, £8k MRR, 120 customers, 12%, 4%, £200k and 60%,
 * several of which can present as 80 / 0.8 / 120. A different node could satisfy
 * a value predicate while the extractor under test was deleted, and every test
 * would stay green.
 *
 * Ambiguity is reported, never guessed: zero or several best candidates ⇒ the
 * limb is NOT_ASSESSED with the candidate list printed.
 */
export function resolveTargetNode(turns: readonly TurnCapture[]): TargetResolution {
  const nodes = graphNodesFrom(turns);
  if (nodes.length === 0) {
    return { resolved: false, candidates: [], why: 'no drafted graph nodes were observed on any turn' };
  }
  const scored = nodes
    .map((n) => {
      const label = typeof n.label === 'string' ? n.label : typeof n.name === 'string' ? n.name : '';
      const id = typeof n.id === 'string' ? n.id : '';
      const lower = label.toLowerCase();
      const hits = C5_TARGET_LABEL_TOKENS.filter((tok) => lower.includes(tok)).length;
      return { id, label, hits, node: n };
    })
    .filter((s) => s.id.length > 0 && s.hits >= C5_TARGET_MIN_TOKEN_HITS)
    .sort((a, b) => b.hits - a.hits);

  const candidates = scored.map((s) => ({ id: s.id, label: s.label, hits: s.hits }));
  if (scored.length === 0) {
    return {
      resolved: false,
      candidates: [],
      why:
        `no node label matched at least ${C5_TARGET_MIN_TOKEN_HITS} of ` +
        `[${C5_TARGET_LABEL_TOKENS.join(', ')}] among ${nodes.length} drafted nodes`,
    };
  }
  const best = scored[0];
  const tied = scored.filter((s) => s.hits === best.hits);
  if (tied.length > 1) {
    return {
      resolved: false,
      candidates,
      why: `${tied.length} nodes tied at ${best.hits} token hits — refusing to guess which one the correction names`,
    };
  }
  return {
    resolved: true,
    nodeId: best.id,
    label: best.label,
    value: best.node.value ?? (best.node as Record<string, unknown>).raw_value,
    candidates,
    why: `unique best match at ${best.hits} token hits`,
  };
}

function evaluateC5(input: EvaluationInput): CriterionResult {
  const { turns } = input;
  const claim =
    'The correction (turn 5) reaches the named object, and turn 6 reruns rather than refusing because ' +
    'of the correction itself.';

  const target = resolveTargetNode(turns);
  const t4 = turnAt(turns, 4);
  const t5 = turnAt(turns, 5);
  const t6 = turnAt(turns, 6);
  const limbs: LimbResult[] = [];

  // --- limb 1: reaches the named object -----------------------------------
  if (!reached(t5)) {
    limbs.push(
      limb(
        'C5.wire.correction-reaches-named-object',
        'turn 5 durably changes the factor the conversation named, and says so honestly',
        'wire',
        'NOT_ASSESSED',
        [t5 === undefined ? 'turn 5 was never sent' : `turn 5 returned no body: ${t5.transportError ?? `HTTP ${t5.httpStatus}`}`],
      ),
    );
  } else if (!target.resolved) {
    limbs.push(
      limb(
        'C5.wire.correction-reaches-named-object',
        'turn 5 durably changes the factor the conversation named, and says so honestly',
        'wire',
        'NOT_ASSESSED',
        [
          `could not bind the named object BY IDENTITY: ${target.why}`,
          ...target.candidates.map((c) => `  candidate ${c.id} "${c.label}" (${c.hits} token hits)`),
          'Refusing to fall back to a value predicate ("the factor whose value is 80") — a different ' +
            'node could satisfy it while the thing under test was gone.',
        ],
      ),
    );
  } else {
    const t5body = (t5 as TurnCapture).body;
    const patches = readGraphPatches(t5body);
    const onTarget = patches.filter((p) => p.target_id === target.nodeId);
    const applied = onTarget.filter((p) => p.status === 'applied');
    const noops = onTarget.filter((p) => p.status === 'noop');
    const offTarget = patches.filter((p) => p.target_id !== undefined && p.target_id !== target.nodeId);

    const hashBefore = currentGraphHash(t4?.body) ?? topLevelGraphHash(t4?.body);
    const hashAfter = currentGraphHash(t5body) ?? topLevelGraphHash(t5body);
    const hashMoved =
      hashBefore !== undefined && hashAfter !== undefined ? hashBefore !== hashAfter : undefined;

    const evidence: string[] = [
      `named object bound by identity: ${target.nodeId} "${target.label}" (value at draft: ${JSON.stringify(target.value)})`,
      // The prose is what tells a CLARIFYING QUESTION (legitimate: the turn
      // names no range) from a CLAIMED CHANGE THAT DID NOT HAPPEN (the defect).
      // Structure cannot separate them; both produce no patch and no movement.
      `turn 5 ${saidWhat(t5)}`,
      `turn 5 graph_patch blocks: ${patches.length} (${onTarget.length} on target, ${offTarget.length} off target)`,
      ...onTarget.map(
        (p) =>
          `  blocks[${p.index}] operation=${p.operation} status=${p.status} ` +
          `before=${JSON.stringify(p.before)} after=${JSON.stringify(p.after)}`,
      ),
      ...offTarget.map((p) => `  OFF TARGET blocks[${p.index}] target_id=${p.target_id} status=${p.status}`),
      `graph hash turn 4 → turn 5: ${hashBefore ?? 'absent'} → ${hashAfter ?? 'absent'}` +
        (hashMoved === undefined ? ' (not comparable)' : hashMoved ? ' — MOVED' : ' — UNCHANGED'),
    ];

    let verdict: Verdict;
    if (applied.length > 0 && hashMoved !== false) {
      verdict = 'PASS';
      evidence.push('The correction reached the named object: an `applied` patch on that target id.');
    } else if (noops.length > 0) {
      verdict = 'FAIL';
      evidence.push(
        'The edit ran and changed NOTHING: a `noop` patch on the target. `fact-noop.ts`: ' +
          '"noop must never be rendered as applied".',
      );
    } else if (offTarget.length > 0 && onTarget.length === 0) {
      verdict = 'FAIL';
      evidence.push('The correction landed on a DIFFERENT object than the one named.');
    } else if (applied.length > 0 && hashMoved === false) {
      verdict = 'FAIL';
      evidence.push(
        'A patch reports `applied` on the target yet the graph hash did not move — a claimed change ' +
          'with no durable state behind it.',
      );
    } else if (patches.length === 0 && hashMoved === true) {
      verdict = 'NOT_ASSESSED';
      evidence.push(
        'The graph hash moved but no graph_patch block names a target, so the harness cannot say ' +
          'WHICH object changed. Decidable only with a patch block or a graph diff.',
      );
    } else {
      verdict = 'FAIL';
      evidence.push('Turn 5 produced no patch on the named object and no durable graph movement.');
    }

    limbs.push(
      limb(
        'C5.wire.correction-reaches-named-object',
        'turn 5 durably changes the factor the conversation named, and says so honestly',
        'wire',
        verdict,
        evidence,
      ),
    );
  }

  // --- limb 2: turn 6 reruns ----------------------------------------------
  if (!reached(t6)) {
    limbs.push(
      limb(
        'C5.wire.turn6-reruns',
        'turn 6 runs the analysis rather than refusing BECAUSE OF the correction',
        'wire',
        'NOT_ASSESSED',
        [t6 === undefined ? 'turn 6 was never sent' : `turn 6 returned no body: ${t6.transportError ?? `HTTP ${t6.httpStatus}`}`],
      ),
    );
  } else {
    const t6body = (t6 as TurnCapture).body;
    const admission = readAdmission(t6body);
    const ran = carriesAnalysisResult(t6body);
    const refuses = admissionRefuses(admission, t6body);
    const reasons = admission.kind === 'present' ? admission.reasons : [];
    const blamesCorrection = reasons.some(
      (r) =>
        r.field === 'structurally_analysable' ||
        (target.nodeId !== undefined &&
          (r.message.includes(target.nodeId) ||
            (target.label !== undefined &&
              target.label.length > 0 &&
              r.message.toLowerCase().includes(target.label.toLowerCase())))),
    );

    let verdict: Verdict;
    const evidence: string[] = [
      `turn 6 carries an analysis result: ${ran}`,
      `turn 6 ${saidWhat(t6)}`,
      `admission: ${admission.kind === 'present' ? `structurally_analysable=${admission.structurally_analysable}, mode=${admission.permitted_analysis_mode}` : admission.why}`,
      `reasons: ${reasons.length === 0 ? 'none' : reasons.map((r) => `${r.field}/${r.code}`).join(', ')}`,
    ];
    if (ran && refuses !== true) {
      verdict = 'PASS';
      evidence.push('Turn 6 reran.');
    } else if (refuses === true && blamesCorrection) {
      verdict = 'FAIL';
      evidence.push(
        'Turn 6 REFUSED and the refusal names the just-corrected object (or the structural field). ' +
          'That is precisely what this criterion forbids.',
      );
    } else if (refuses === true) {
      verdict = 'NOT_ASSESSED';
      evidence.push(
        'Turn 6 refused for a reason that does NOT name the correction. The criterion is about ' +
          'refusing BECAUSE OF the correction, and this is not that — but the run also did not ' +
          'demonstrate the rerun. Reported unassessed rather than failed or passed.',
      );
    } else if (refuses === 'unknown') {
      verdict = 'NOT_ASSESSED';
      evidence.push('No readable admission on turn 6; absence is not refusal.');
    } else {
      verdict = 'FAIL';
      evidence.push('Turn 6 neither refused nor produced an analysis result.');
    }

    limbs.push(
      limb(
        'C5.wire.turn6-reruns',
        'turn 6 runs the analysis rather than refusing BECAUSE OF the correction',
        'wire',
        verdict,
        evidence,
      ),
    );
  }

  return { id: 'C5', claim, verdict: composeVerdict(limbs), limbs };
}

// ---------------------------------------------------------------------------
// C6 — turn 7 answers the question asked
// ---------------------------------------------------------------------------

/**
 * The "nothing changed" denial family.
 *
 * ⚠ A SAMPLED FLOOR, NOT A TRACKING MIRROR. The producer emits this sentence
 * from 74 sites across `system-events/{factor-value-edit,edge-strength-edit,
 * structural-delete,structural-rename}.ts` with varying lead-ins. There is no
 * shared constant to import, so this pattern is written here — and the
 * companion unit test pins it against literals lifted verbatim from those
 * sites. A new phrasing added upstream will NOT be caught, and saying so is
 * the honest form: this is a floor, and a clean scan here is not proof of
 * absence of denial, only absence of THIS family.
 */
export const NO_CHANGE_DENIAL_PATTERNS: readonly RegExp[] = Object.freeze([
  /\bI\s+haven'?t\s+changed\s+anything\b/i,
  /\bI\s+have\s+not\s+changed\s+anything\b/i,
  /\bnothing\s+(?:has\s+)?changed\b/i,
  /\bno\s+changes?\s+(?:were|have\s+been)\s+(?:made|applied|saved)\b/i,
]);

export function findNoChangeDenial(text: string): string | null {
  for (const re of NO_CHANGE_DENIAL_PATTERNS) {
    const m = re.exec(text);
    if (m !== null) return m[0];
  }
  return null;
}

function evaluateC6(input: EvaluationInput): CriterionResult {
  const { turns, detectors } = input;
  const claim =
    'Turn 7 answers the question asked — an attribution of what changed — rather than being routed to ' +
    'the graph editor and answered with "I haven\'t changed anything from that".';

  const t6 = turnAt(turns, 6);
  const t7 = turnAt(turns, 7);
  const limbs: LimbResult[] = [];

  if (!reached(t7)) {
    limbs.push(
      limb(
        'C6.wire.no-misroute-markers',
        'turn 7 carries none of the three observable signatures of a misroute to the graph editor',
        'wire',
        'NOT_ASSESSED',
        [t7 === undefined ? 'turn 7 was never sent' : `turn 7 returned no body: ${t7.transportError ?? `HTTP ${t7.httpStatus}`}`],
      ),
    );
  } else {
    const body = (t7 as TurnCapture).body;
    const patches = readGraphPatches(body);
    const hashBefore = currentGraphHash(t6?.body) ?? topLevelGraphHash(t6?.body);
    const hashAfter = currentGraphHash(body) ?? topLevelGraphHash(body);
    const hashMoved =
      hashBefore !== undefined && hashAfter !== undefined ? hashBefore !== hashAfter : undefined;

    const signals: string[] = [];

    // (a) the editor was entered and changed nothing
    const noopPatches = patches.filter((p) => p.status === 'noop');
    if (noopPatches.length > 0) {
      signals.push(
        `(a) graph editor entered and changed nothing: ${noopPatches.length} \`noop\` graph_patch block(s) — ` +
          noopPatches.map((p) => `blocks[${p.index}] ${p.operation} on ${p.target_id}`).join('; '),
      );
    } else if (patches.length > 0 && hashMoved === false) {
      signals.push(
        `(a) graph editor entered on an attribution question: ${patches.length} graph_patch block(s) with ` +
          'no graph-hash movement',
      );
    }

    // (b) routing narration
    if (detectors.narration.status.available) {
      for (const { path, value } of collectUserVisibleStrings(body)) {
        const hit = detectors.narration.findHit(value);
        if (hit !== null) {
          signals.push(`(b) routing narration @ ${path} — marker ${JSON.stringify(hit)} — ${excerpt(value, 160)}`);
        }
      }
    }

    // (c) the "I haven't changed anything" answer
    for (const { path, value } of collectUserVisibleStrings(body)) {
      const denial = findNoChangeDenial(value);
      if (denial !== null) {
        signals.push(`(c) no-change denial as the ANSWER @ ${path} — ${JSON.stringify(denial)} — ${excerpt(value, 160)}`);
      }
    }

    const evidence: string[] = [
      `turn 7 blocks: [${blockTypesPresent(body).join(', ')}]`,
      `turn 7 ${saidWhat(t7)}`,
      `graph hash turn 6 → turn 7: ${hashBefore ?? 'absent'} → ${hashAfter ?? 'absent'}` +
        (hashMoved === undefined ? ' (not comparable)' : hashMoved ? ' — MOVED' : ' — unchanged'),
      '⚠ THE ROUTE IS NOT ON THE WIRE. `turn_class` is telemetry-only and content-free; ' +
        '`compose.ts` says in terms "There is no downstream wire field, turn_class". The misroute is ' +
        'INFERRED from the three signatures below, never read.',
      ...(detectors.narration.status.available
        ? []
        : ['narration detector unavailable — signature (b) was not checked']),
    ];
    if (signals.length > 0) evidence.push('MISROUTE SIGNATURES PRESENT:', ...signals);
    else evidence.push('none of the three signatures present');

    limbs.push(
      limb(
        'C6.wire.no-misroute-markers',
        'turn 7 carries none of the three observable signatures of a misroute to the graph editor',
        'wire',
        signals.length === 0 ? 'PASS' : 'FAIL',
        evidence,
      ),
    );
  }

  limbs.push(
    limb(
      'C6.semantic.answers-the-question',
      'turn 7 gives a correct BEFORE/AFTER attribution of what the turn-5 correction changed',
      'semantic',
      'NOT_ASSESSED',
      [
        'Not machine-decidable. Whether a reply is a RESPONSIVE ATTRIBUTION is a semantic judgement, ' +
          'and reporting "no misroute markers" as "it answered the question" would substitute the ' +
          'symptom metric for the outcome metric (CLAUDE.md trap 23).',
        'Route this limb to a human or to an explicit rubric. The harness deliberately states the two ' +
          'halves apart: "no misroute markers" is DECIDED; "responsive attribution" is NOT.',
      ],
    ),
  );

  return { id: 'C6', claim, verdict: composeVerdict(limbs), limbs };
}

// ---------------------------------------------------------------------------

export function evaluateCriteria(input: EvaluationInput): Evaluation {
  const caveats: string[] = [];
  const c3 = evaluateC3(input);
  caveats.push(...c3.caveats);

  const criteria = [evaluateC1(input), evaluateC2(input), c3.criterion, evaluateC4(input), evaluateC5(input), evaluateC6(input)];

  for (const c of criteria) {
    for (const l of c.limbs) {
      if (l.verdict === 'NOT_ASSESSED') {
        caveats.push(`${c.id} not fully decided — ${l.id}: ${l.question}`);
      }
    }
  }

  const missing = input.turns.filter((t) => !reached(t));
  for (const t of missing) {
    caveats.push(
      `${turnLabel(t)} did not return a body (${t.transportError ?? `HTTP ${t.httpStatus}`}) — every ` +
        'criterion that reads it is weakened accordingly.',
    );
  }

  return { criteria, caveats };
}
