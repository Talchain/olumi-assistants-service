/**
 * Promotion GATE dimensions (conversation-harness — Wave1-L3).
 *
 * These are the dimensions a coach-prompt candidate must clear on the HOLDOUT
 * before it may ship. Where prompt-dims.ts asks "is A better than B?" (a
 * ranking), these ask "is this good enough?" (a floor) — see holdout.ts for why
 * the two must never be mixed.
 *
 * ANTI-GAMING IS THE WHOLE DESIGN
 * -------------------------------
 * An adversarial reviewer will try to construct a transcript that satisfies the
 * letter of each dimension while violating its intent. Three rules make that
 * hard, and every dimension below obeys all three:
 *
 *  1. SCORE STATE, NOT PROSE. A dimension is never satisfied by the assistant
 *     SAYING it did something. Advancement is evidenced by the L0 mutation
 *     oracle (the DB graph sha actually moved) or by a genuinely new affordance;
 *     dispatch is evidenced by whether a mutation actually committed. Prose is
 *     scored only where prose is the artifact under test (unsupported-claim),
 *     and there only negatively.
 *
 *  2. SILENCE IS NOT A PASS. The classic gaming move is to emit a transcript
 *     with nothing in it: no numbers ⇒ no untraceable numbers ⇒ "perfect"
 *     grounding; no claims ⇒ no unsupported claims. So every ratio dimension is
 *     UNMEASURABLE (null) when its denominator is empty, and the promotion
 *     verdict FAILS on null. An empty transcript fails; it does not ace.
 *
 *  3. REPETITION IS NOT PROGRESS. Re-offering the same chip, or re-asking a
 *     question already asked, is scored as a dead end / correction burden — not
 *     as an affordance. This is grounded in an observed live defect (the same
 *     chip emitted 6× in one conversation).
 *
 * NULL-HONESTY. `value: null` means "not measurable in this run", never 0 and
 * never "good". Inherited from prompt-dims.ts and load-bearing here: the
 * promotion verdict treats null as FAIL, so an under-instrumented run can never
 * be mistaken for a clean one.
 *
 * PII. Details/notes carry COUNTS and turn ids only — never factor labels, never
 * label-derived node ids, never decision values. Entity matching happens
 * in-memory and only its cardinality is emitted.
 *
 * PURE — no src/ imports, no I/O. The unsupported-claim checker is INJECTED
 * (see UnsupportedClaimChecker) precisely so this file never copies production
 * guard patterns: score-run.ts wires the real coaching-output-postcheck.
 */
import {
  type TurnRow,
  chipSemanticSet,
  jaccard,
  classifyQuestion,
} from './dims.js';
import type { PromptDimScore } from './prompt-dims.js';
import type { TurnSurfaces } from './prompt-dims.js';

/** Chip-set similarity at/above which two turns' affordances are "the same
 * offer again". Uses the SEMANTIC chip key (dims.chipSemanticKey), so the
 * per-turn regenerated chip ids cannot disguise a repeat. */
const CHIP_REPEAT_SIMILARITY = 0.75;

/** Per-turn inputs. `surfaces` comes from prompt-dims.surfacesFromWire on the
 * SAME wire the row came from; `userMessage` from the journey turn. */
export interface GateTurn {
  row: TurnRow;
  surfaces: TurnSurfaces;
  /** The scripted user message that produced this turn. */
  userMessage: string;
}

/**
 * The unsupported-claim checker, INJECTED rather than reimplemented.
 * score-run.ts passes an adapter over the production
 * `checkCoachingOutput` (src/orchestrator-v5/coaching/coaching-output-postcheck).
 * There is deliberately NO default: a copied pattern set would drift from
 * production silently, and a permissive default would let the gate pass a
 * candidate it never actually checked. No checker ⇒ the dim is null ⇒ FAIL.
 *
 * Returns a closed violation tag (telemetry-safe enum from the production
 * type), or null when the prose is clean.
 */
export type UnsupportedClaimChecker = (turn: GateTurn) => string | null;

export interface GateDimsOptions {
  unsupportedClaimChecker?: UnsupportedClaimChecker;
}

const dim = (
  id: string,
  label: string,
  direction: 'higher-better' | 'lower-better',
  value: number | null,
  unit: string,
  details: Record<string, unknown>,
  notes: string[],
): PromptDimScore => ({
  dim: id,
  label,
  direction,
  gating: true,
  flaky: true,
  safety: false,
  value,
  unit,
  details,
  notes,
});

/** Turns that actually ran. Skipped/duplicate turns carry no signal. */
function active(turns: GateTurn[]): GateTurn[] {
  return turns.filter((t) => !t.row.skipped && t.row.duplicateOf == null);
}

/** Turns with an L0 mutation oracle — the only turns whose STATE effect is
 * known. Dimensions that claim to score state require these; without the oracle
 * we cannot tell a real commit from a confident sentence, so we say so (null)
 * rather than scoring the sentence. */
function oracled(turns: GateTurn[]): GateTurn[] {
  return active(turns).filter((t) => typeof t.row.mutationCommitted === 'boolean');
}

// ---------- G1: decision-advancement ----------

/**
 * Did the conversation MOVE? Fraction of executed turns that advanced the
 * decision, where "advanced" means one of:
 *   - the graph actually changed (L0 oracle: mutationCommitted === true), or
 *   - a proposal was newly STAGED (held_proposal appears where the previous
 *     turn had none — a real pending decision for the user), or
 *   - a genuinely NEW affordance was offered (chip set not similar to ANY
 *     earlier turn's).
 *
 * ANTI-GAMING:
 *  - Prose is not consulted at all. "I've updated your model" advances nothing.
 *  - Novelty is checked against ALL earlier turns, not just the previous one,
 *    so A/B/A/B chip alternation cannot manufacture advancement.
 *  - A persisting held_proposal is not re-counted; only its APPEARANCE counts.
 *  - Requires the L0 oracle to be measurable at all, so a run with no DB ground
 *    truth reports null (⇒ promotion FAILS) instead of scoring chip churn.
 */
export function gateDecisionAdvancement(turns: GateTurn[]): PromptDimScore {
  const act = active(turns);
  const withOracle = oracled(turns);
  if (act.length === 0 || withOracle.length === 0) {
    return dim('G1-decision-advancement', 'Decision advancement (fraction of turns that moved the decision)', 'higher-better', null, 'fraction', { active_turns: act.length, oracled_turns: withOracle.length }, [
      'UNMEASURABLE: no executed turn carries an L0 mutation oracle — advancement cannot be distinguished from chip churn without DB ground truth',
    ]);
  }
  const seenChipSets: Set<string>[] = [];
  let advanced = 0;
  const reasons: Record<string, number> = { committed: 0, newly_held: 0, novel_affordance: 0 };
  act.forEach((t, i) => {
    const chips = chipSemanticSet(t.row);
    const prevHeld = i > 0 ? act[i - 1].row.heldProposal === true : false;
    const newlyHeld = t.row.heldProposal === true && !prevHeld;
    const novel =
      chips.size > 0 && !seenChipSets.some((prev) => jaccard(chips, prev) >= CHIP_REPEAT_SIMILARITY);
    if (t.row.mutationCommitted === true) {
      advanced++;
      reasons.committed++;
    } else if (newlyHeld) {
      advanced++;
      reasons.newly_held++;
    } else if (novel) {
      advanced++;
      reasons.novel_affordance++;
    }
    if (chips.size > 0) seenChipSets.push(chips);
  });
  return dim(
    'G1-decision-advancement',
    'Decision advancement (fraction of turns that moved the decision)',
    'higher-better',
    Number((advanced / act.length).toFixed(3)),
    'fraction',
    { active_turns: act.length, advanced, by_reason: reasons },
    [],
  );
}

// ---------- G2: dispatch accuracy ----------

/**
 * Did the turn do what its CLASS says it does? Scored only on turns with an L0
 * oracle, against the journey's declared intent:
 *   - edit_intent === true  ⇒ the turn must commit a mutation OR stage a
 *     held_proposal (asking for consent is a correct dispatch, not a miss).
 *   - edit_intent === false ⇒ the turn must NOT commit a mutation. A coach turn
 *     that mutates the graph is a dispatch error even if the user liked it.
 *
 * ANTI-GAMING:
 *  - Symmetric. A prompt cannot ace this by mutating on every turn (that fails
 *    the coach direction) nor by never mutating (that fails the edit direction).
 *    Both error directions are counted in the SAME ratio, so there is no
 *    trivially-safe policy.
 *  - Scored off the oracle, never off the assistant's account of itself.
 */
export function gateDispatchAccuracy(turns: GateTurn[]): PromptDimScore {
  const scored = oracled(turns);
  if (scored.length === 0) {
    return dim('G2-dispatch-accuracy', 'Dispatch accuracy (declared intent vs actual state effect)', 'higher-better', null, 'fraction', { scored_turns: 0 }, [
      'UNMEASURABLE: no executed turn carries an L0 mutation oracle',
    ]);
  }
  let correct = 0;
  const errors = { edit_did_not_dispatch: 0, coach_mutated: 0 };
  for (const t of scored) {
    const committed = t.row.mutationCommitted === true;
    const held = t.row.heldProposal === true;
    if (t.row.editIntent) {
      if (committed || held) correct++;
      else errors.edit_did_not_dispatch++;
    } else {
      if (!committed) correct++;
      else errors.coach_mutated++;
    }
  }
  return dim(
    'G2-dispatch-accuracy',
    'Dispatch accuracy (declared intent vs actual state effect)',
    'higher-better',
    Number((correct / scored.length).toFixed(3)),
    'fraction',
    { scored_turns: scored.length, correct, errors },
    [],
  );
}

// ---------- G3: entity resolution ----------

/**
 * When the user names a real entity, does the system RESOLVE it to canonical
 * state — or just repeat the string back?
 *
 * Denominator: turns whose user message names a canonical entity (an option
 * label present on the turn's own surfaces). Numerator: those turns whose
 * STRUCTURED output ties back to that same canonical entity — a chip carrying
 * it, or a staged proposal.
 *
 * ANTI-GAMING — this is the subtle one:
 *  - Prose echo does NOT count. The assistant repeating "Plan A" in a sentence
 *    is string handling, not resolution; it is exactly what a model does when
 *    it has NOT looked anything up. Only structured output counts, because
 *    chips and proposals are generated from graph state — the system cannot
 *    emit a chip for an entity it failed to resolve.
 *  - The analysis payload naming the entity does NOT count either, and this is
 *    the trap worth naming: the payload lists EVERY option on every analysed
 *    turn, so accepting it as evidence would auto-resolve every entity on every
 *    turn that happens to carry an analysis — a 1.000 that means nothing. The
 *    evidence must be something the system could only have produced BY
 *    resolving the user's specific mention. A chip is; an ambient payload
 *    listing is not.
 *  - The entity must come from the turn's OWN surfaces (live canonical state),
 *    so a stale label the model remembered from three turns ago cannot score.
 *  - Null when the script never names an entity: a journey that mentions
 *    nothing is not evidence of good resolution.
 *
 * PII: labels are matched in memory; only counts leave this function.
 */
export function gateEntityResolution(turns: GateTurn[]): PromptDimScore {
  const act = active(turns);
  let denom = 0;
  let resolved = 0;
  for (const t of act) {
    const labels = t.surfaces.optionLabels.filter((l) => l && l.trim().length > 2);
    const named = labels.filter((l) => new RegExp(`\\b${escapeRe(l)}\\b`, 'i').test(t.userMessage));
    if (named.length === 0) continue;
    denom++;
    // Chips ONLY (plus heldProposal below). Deliberately NOT the payload's own
    // label listing — see the anti-gaming note above: the payload names every
    // option on every analysed turn, so it certifies nothing about THIS mention.
    const structured = t.row.chips.map((c) => `${c.label} ${c.action ?? ''}`).join('   ');
    const tiedInStructure = named.some((l) => new RegExp(`\\b${escapeRe(l)}\\b`, 'i').test(structured));
    if (tiedInStructure || t.row.heldProposal === true) resolved++;
  }
  if (denom === 0) {
    return dim('G3-entity-resolution', 'Entity resolution (named entity tied to canonical state)', 'higher-better', null, 'fraction', { turns_naming_an_entity: 0 }, [
      'UNMEASURABLE: no scripted user turn named a canonical entity — silence is not evidence of resolution',
    ]);
  }
  return dim(
    'G3-entity-resolution',
    'Entity resolution (named entity tied to canonical state)',
    'higher-better',
    Number((resolved / denom).toFixed(3)),
    'fraction',
    { turns_naming_an_entity: denom, resolved },
    [],
  );
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------- G4: canonical-state use ----------

/**
 * Every figure the assistant states must exist in the canonical payload.
 * Denominator: integer percentages appearing in coach prose. Numerator: those
 * that appear in the turn's payload percentages (win-% + outcome percentiles).
 *
 * ANTI-GAMING:
 *  - Null when the run states NO figures at all. Otherwise the winning strategy
 *    is to say nothing quantitative and score 1.000 — the exact vacuity this
 *    gate exists to prevent. A prompt that avoids numbers must clear the OTHER
 *    floors (advancement, dead-end) on its own merits, not bank a free 1.0 here.
 *  - Scored per FIGURE, not per turn: one turn inventing nine numbers cannot
 *    hide behind eight clean turns.
 *  - Only the turn's OWN payload counts, so a number that was canonical three
 *    turns ago but is not on this envelope is untraceable — which is correct,
 *    that is a staleness leak.
 */
export function gateCanonicalStateUse(turns: GateTurn[]): PromptDimScore {
  const act = active(turns);
  let total = 0;
  let traceable = 0;
  for (const t of act) {
    const figures = proseIntegerPercentages(t.row.assistantText);
    if (figures.length === 0) continue;
    const canonical = new Set(t.surfaces.payloadPercentages);
    for (const f of figures) {
      total++;
      if (canonical.has(f)) traceable++;
    }
  }
  if (total === 0) {
    return dim('G4-canonical-state-use', 'Canonical-state use (stated figures traceable to payload)', 'higher-better', null, 'fraction', { figures_stated: 0 }, [
      'UNMEASURABLE: the run stated no figures — a silent transcript is not a grounded one',
    ]);
  }
  return dim(
    'G4-canonical-state-use',
    'Canonical-state use (stated figures traceable to payload)',
    'higher-better',
    Number((traceable / total).toFixed(3)),
    'fraction',
    { figures_stated: total, traceable },
    [],
  );
}

/** Integer percentages stated in prose ("62%", "62 %"). Deliberately narrow:
 * bare integers are ambiguous (dates, counts, the user's own figures) and a
 * false positive here degrades a real candidate. */
export function proseIntegerPercentages(text: string): number[] {
  const out: number[] = [];
  const re = /(\d{1,3})\s?%/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text ?? '')) !== null) out.push(Number(m[1]));
  return out;
}

// ---------- G5: unsupported claim ----------

/**
 * Count of coach turns whose prose trips the PRODUCTION coaching-output
 * post-check (fabricated results, invented mutation success, unsupported
 * evidence/confidence claims, stale-as-fresh...). Lower-better, floor 0.
 *
 * ANTI-GAMING:
 *  - The checker is injected from production, so this dim cannot drift into a
 *    weaker local copy of the patterns.
 *  - Null (⇒ FAIL) when no checker is wired OR there are no coach turns —
 *    "we didn't check" and "there was nothing to check" must never render as
 *    a clean 0.
 *  - A COUNT, not a rate: padding the run with silent turns cannot dilute a
 *    violation, which a fraction would allow.
 */
export function gateUnsupportedClaim(turns: GateTurn[], opts: GateDimsOptions = {}): PromptDimScore {
  const coachTurns = active(turns).filter((t) => (t.row.assistantText ?? '').trim().length > 0);
  if (!opts.unsupportedClaimChecker) {
    return dim('G5-unsupported-claim', 'Unsupported claims (production post-check violations)', 'lower-better', null, 'count', { coach_turns: coachTurns.length }, [
      'UNMEASURABLE: no unsupported-claim checker injected — score-run.ts must wire the production coaching-output-postcheck',
    ]);
  }
  if (coachTurns.length === 0) {
    return dim('G5-unsupported-claim', 'Unsupported claims (production post-check violations)', 'lower-better', null, 'count', { coach_turns: 0 }, [
      'UNMEASURABLE: no coach turns produced prose — nothing was checked',
    ]);
  }
  const byViolation: Record<string, number> = {};
  const offendingTurns: string[] = [];
  for (const t of coachTurns) {
    const v = opts.unsupportedClaimChecker(t);
    if (v) {
      byViolation[v] = (byViolation[v] ?? 0) + 1;
      offendingTurns.push(t.row.turn);
    }
  }
  return dim(
    'G5-unsupported-claim',
    'Unsupported claims (production post-check violations)',
    'lower-better',
    offendingTurns.length,
    'count',
    { coach_turns: coachTurns.length, by_violation: byViolation, offending_turns: offendingTurns },
    [],
  );
}

// ---------- G6: dead end ----------

/**
 * Fraction of coach turns that leave the user with nowhere to go. A turn is a
 * dead end when it offers no NEW affordance and asks nothing:
 *   - no chips, no question, no staged proposal; OR
 *   - chips that merely REPEAT the previous turn's offer, with no question.
 *
 * ANTI-GAMING:
 *  - The repeat clause is the point. Re-emitting the same chip is the cheapest
 *    way to look like an affordance while offering nothing — and is a defect
 *    observed live (identical chip 6× in one conversation). Semantic chip keys
 *    are used so regenerated chip ids cannot disguise the repeat.
 *  - Consent chips (apply/confirm/cancel) legitimately persist across a
 *    held-proposal turn, so a turn with a live staged proposal is exempt: that
 *    IS the next action.
 */
export function gateDeadEnd(turns: GateTurn[]): PromptDimScore {
  const act = active(turns);
  const coachTurns = act.filter((t) => (t.row.assistantText ?? '').trim().length > 0);
  if (coachTurns.length === 0) {
    return dim('G6-dead-end', 'Dead ends (fraction of turns leaving no next action)', 'lower-better', null, 'fraction', { coach_turns: 0 }, [
      'UNMEASURABLE: no coach turns produced prose',
    ]);
  }
  let deadEnds = 0;
  const deadTurns: string[] = [];
  act.forEach((t, i) => {
    if ((t.row.assistantText ?? '').trim().length === 0) return;
    if (t.row.heldProposal === true) return; // a staged proposal IS the next action
    const chips = chipSemanticSet(t.row);
    const asks = classifyQuestion(t.row.assistantText).sentences.length > 0;
    const prevChips = i > 0 ? chipSemanticSet(act[i - 1].row) : new Set<string>();
    const repeatsPrev =
      chips.size > 0 && prevChips.size > 0 && jaccard(chips, prevChips) >= CHIP_REPEAT_SIMILARITY;
    const noNewAffordance = chips.size === 0 || repeatsPrev;
    if (noNewAffordance && !asks) {
      deadEnds++;
      deadTurns.push(t.row.turn);
    }
  });
  return dim(
    'G6-dead-end',
    'Dead ends (fraction of turns leaving no next action)',
    'lower-better',
    Number((deadEnds / coachTurns.length).toFixed(3)),
    'fraction',
    { coach_turns: coachTurns.length, dead_ends: deadEnds, dead_end_turns: deadTurns },
    [],
  );
}

// ---------- G7: correction burden ----------

/**
 * How often does the assistant make the user do the work twice? Counted as
 * REDUNDANT questions per coach turn: a question whose class was already asked
 * in an earlier turn (the user already answered this; asking again is burden).
 *
 * ANTI-GAMING:
 *  - Repeat identity is by question CLASS + normalised content tokens, not
 *    exact text, so rephrasing the same ask does not launder it.
 *  - Lower-better with floor 0, BUT a prompt cannot ace it by asking nothing:
 *    a question-free, chip-free turn is a dead end under G6, and a question-free
 *    run that never advances fails G1. The three floors interlock deliberately
 *    — no single-dimension policy clears all of them.
 */
export function gateCorrectionBurden(turns: GateTurn[]): PromptDimScore {
  const act = active(turns);
  const coachTurns = act.filter((t) => (t.row.assistantText ?? '').trim().length > 0);
  if (coachTurns.length === 0) {
    return dim('G7-correction-burden', 'Correction burden (redundant re-asks per coach turn)', 'lower-better', null, 'per-turn', { coach_turns: 0 }, [
      'UNMEASURABLE: no coach turns produced prose',
    ]);
  }
  const asked: Set<string>[] = [];
  let redundant = 0;
  const repeatTurns: string[] = [];
  for (const t of coachTurns) {
    const qs = classifyQuestion(t.row.assistantText).sentences;
    let turnHadRepeat = false;
    for (const q of qs) {
      const key = questionTokens(q);
      if (key.size === 0) continue;
      if (asked.some((prev) => jaccard(key, prev) >= 0.6)) {
        redundant++;
        turnHadRepeat = true;
      } else {
        asked.push(key);
      }
    }
    if (turnHadRepeat) repeatTurns.push(t.row.turn);
  }
  return dim(
    'G7-correction-burden',
    'Correction burden (redundant re-asks per coach turn)',
    'lower-better',
    Number((redundant / coachTurns.length).toFixed(3)),
    'per-turn',
    { coach_turns: coachTurns.length, redundant_questions: redundant, turns_with_repeat: repeatTurns },
    [],
  );
}

/** Content tokens of a question — the TOPIC of the ask, for repeat identity
 * that survives rephrasing.
 *
 * Interrogative and framing words are stopwords, not just grammatical ones.
 * That is the load-bearing choice: "What is your budget?" and "Could you tell
 * me the budget?" share no grammatical frame at all, and keying on the frame
 * would let any re-ask launder itself through a reword. Stripping the frame
 * leaves {budget} on both sides, and the re-ask is caught.
 *
 * LIMIT, stated honestly: this catches a re-ask that keeps the topic nouns. An
 * ask about the same underlying thing in genuinely different nouns ("what can
 * you spend?") is NOT caught — that needs semantics, not tokens. So G7 is a
 * floor on obvious burden, not a proof of its absence; it under-reports rather
 * than over-reports, which is the right direction for a gate that blocks ships.
 */
const QUESTION_STOPWORDS = new Set([
  // grammatical frame
  'a', 'an', 'the', 'do', 'does', 'did', 'you', 'your', 'yours', 'i', 'we', 'is', 'are', 'was',
  'were', 'to', 'of', 'and', 'or', 'for', 'on', 'in', 'at', 'it', 'this', 'that', 'would', 'could',
  'should', 'can', 'will', 'shall', 'me', 'my', 'like', 'want', 'have', 'has', 'be', 'been', 'so',
  // interrogative + framing: strip the ASK, keep the TOPIC
  'what', 'which', 'how', 'why', 'when', 'where', 'who', 'whom', 'tell', 'know', 'say', 'give',
  'please', 'about', 'any', 'some', 'more', 'think', 'help', 'much', 'many', 'there', 'here',
  'mind', 'sharing', 'share', 'let', 'us', 'if', 'then', 'get', 'got', 'make', 'made', 'again',
]);

export function questionTokens(q: string): Set<string> {
  return new Set(
    (q ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 1 && !QUESTION_STOPWORDS.has(w)),
  );
}

// ---------- runner ----------

/** All seven transcript-derived gate dims for one run, in stable order.
 * Latency and cost are NOT here: they come from ab-verdict's existing OPS
 * metrics (opsFromRows / opsDimsForRun), which already own the F14 cost
 * accounting. promotion-verdict.ts joins the two — see there. */
export function runGateDims(turns: GateTurn[], opts: GateDimsOptions = {}): PromptDimScore[] {
  return [
    gateDecisionAdvancement(turns),
    gateDispatchAccuracy(turns),
    gateEntityResolution(turns),
    gateCanonicalStateUse(turns),
    gateUnsupportedClaim(turns, opts),
    gateDeadEnd(turns),
    gateCorrectionBurden(turns),
  ];
}
