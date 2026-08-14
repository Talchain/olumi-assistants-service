/**
 * COLLAB — THE DISAGREEMENT READ MODEL. Where two people's positions on the
 * same element diverge, this makes the divergence STRUCTURAL: what each person
 * believes, on what stated basis, what evidence they attached, and what
 * question the team should put to it.
 *
 * ── WHAT THIS ADDS THAT THE REVEAL DOES NOT ───────────────────────────────
 * The reveal already shows every position side by side and already says that
 * applying one does not remove the others — that half of the loop is shipped
 * and journey-witnessed, and NOTHING HERE REBUILDS IT. What the reveal cannot
 * do is tell a team WHY two views differ: it renders a list of numbers and
 * words, and leaves the interrogation entirely to the reader. This view names
 * the shape of the divergence, pairs each position with its stated basis and
 * its evidence, and asks the question that shape warrants.
 *
 * ── A SEPARATE VIEW, NOT A WIDER `RevealView` ─────────────────────────────
 * `RevealView` is contract-pinned and its key sets are asserted strictly; the
 * apply path and a journey-witnessed UI both read it. Growing it to carry
 * evidence would put new fields through a shape that other lanes depend on,
 * for a capability those lanes do not consume. This is additive and cannot
 * regress the loop that already works — the deliberate cost is one extra read,
 * priced below.
 *
 * ── ONE GATE, ONE FOLD, ONE LABEL RESOLUTION ──────────────────────────────
 * ⭐ This module calls `assembleRevealView` for the positions rather than
 * re-deriving them. That is a CORRECTNESS decision paid for with a duplicate
 * `listAllRoundEvents` round trip, and the trade is not close: a second copy of
 * the open-round gate, the latest-answer fold and the `pseudonym ?? display_name`
 * resolution would be three chances for this surface to disagree with the
 * reveal about what someone said — the two-`generateGraphHash`-twins defect,
 * on a screen whose entire job is to report faithfully who thinks what. One
 * authority, and a redundant query.
 *
 * ── AND WHAT IS ABSENT, AT EVERY NESTING LEVEL ────────────────────────────
 * No mean, median, midpoint, combined value, recommendation, winner or
 * consensus — in the types, and (asserted over every emittable string) in the
 * copy. `spread` reports the two ENDPOINT values and the distance between them,
 * both still attributed to the people who gave them; it is a description of the
 * range, never a replacement for the positions. If a future field would let a
 * caller render one number in place of several, it does not belong here.
 */

import {
  divergenceHeadline,
  interrogationQuestion,
  STANCE_PHRASE,
  type DisagreementFacts,
  type DivergenceShape,
} from './disagreement-copy.js';
import { assembleRevealView } from './packet-read-model.js';
import {
  type CollabActor,
  type CollabStore,
  type ElicitationEventKind,
  type ElicitationEvidence,
  type ElicitationTarget,
  type EvidenceStance,
} from './types.js';

/** One person's position on one target, with the basis they stated for it. */
export interface DisagreementPosition {
  participant_id: string;
  /** display_name, or the pseudonym after redaction — resolved by the reveal. */
  display_label: string;
  value: number | null;
  /**
   * The person's OWN WORDS for why, verbatim (`belief.expression_raw`).
   *
   * ⚠ Named `stated_basis` rather than `reason` deliberately: it is what they
   * SAID, not a reason the product has assessed. A field called `reason` invites
   * a later reader to treat its presence as evidence of good reasoning.
   */
  stated_basis: string | null;
  confidence: number | null;
  kind: ElicitationEventKind;
  /**
   * Whether this position sits at an end of the numeric range — `null` when it
   * does not, or when there is no range.
   *
   * ⚠ NOT A RANKING. 'low'/'high' name POSITIONS ON THE SCALE, not better and
   * worse. Several people can share an end; all of them are marked.
   */
  pole: 'low' | 'high' | null;
}

/** A piece of evidence, with who wrote it and what it speaks to. */
export interface DisagreementEvidence {
  event_id: string;
  /** SERVER-STAMPED author — from `provenance.authored_by`, never the wire. */
  authored_by: string;
  /** The author's display label, resolved the same way positions are. */
  author_label: string;
  stance: EvidenceStance;
  /** Fixed word for the stance. Never model-chosen. */
  stance_phrase: string;
  kind: ElicitationEvidence['kind'];
  /** The author's own words, verbatim. */
  body: string;
  url: string | null;
  /** Whose position this speaks to, or null for the target at large. */
  about_participant_id: string | null;
  about_label: string | null;
  created_at: string;
}

export interface DisagreementTarget {
  target: ElicitationTarget;
  label: string;
  model_value_at_version: number | null;
  shape: DivergenceShape;
  /** Distinct participants who gave a number. */
  answering_participants: number;
  /** Distinct numeric values among them. */
  distinct_values: number;
  /**
   * The ends of the range and the distance between them, or null unless split.
   *
   * ⚠ `width` is a DESCRIPTION OF THE GAP, not a disagreement score and not an
   * input to any combination. Both ends stay attributed in `positions`; this
   * exists so a surface can say "these two are 0.65 apart" without a caller
   * having to compute — and computing is exactly where a midpoint gets invented.
   */
  spread: { low: number; high: number; width: number } | null;
  /** Every position, including declines. Order follows the reveal. */
  positions: DisagreementPosition[];
  /** How many answering participants also gave words. The interrogable share. */
  positions_with_stated_basis: number;
  evidence: DisagreementEvidence[];
  /** Code-owned. A restatement of the facts above. */
  headline: string;
  /** Code-owned. A question, or null when there is nothing to interrogate. */
  question: string | null;
}

export interface DisagreementView {
  round_id: string;
  graph_version_ref: string;
  per_target: DisagreementTarget[];
}

/**
 * Classify a target's divergence from the answers alone.
 *
 * ⚠ COUNTS DISTINCT PARTICIPANTS AND DISTINCT VALUES, not rows. One person who
 * revised three times is one voice — the fold has already reduced to latest-per-
 * participant, and this must not silently re-inflate it.
 */
export function classifyDivergence(values: readonly number[]): DivergenceShape {
  if (values.length === 0) return 'no_answers';
  if (values.length === 1) return 'single_view';
  const distinct = new Set(values);
  return distinct.size === 1 ? 'aligned' : 'split';
}

/**
 * Assemble the disagreement view for a closed round.
 *
 * Refuses exactly when the reveal refuses, because it IS the reveal's gate —
 * inherited by calling it, not restated. A view that could be read while the
 * round was open would defeat blindness through a second door, and a
 * separately-written gate is how that happens.
 */
export async function assembleDisagreementView(
  store: CollabStore,
  args: { round_id: string; requested_by: CollabActor },
): Promise<DisagreementView> {
  // THE GATE, THE FOLD AND THE LABELS, all from the one authority.
  const reveal = await assembleRevealView(store, args);

  // The second read: evidence rows, which the reveal deliberately does not
  // carry. Same sanctioned reveal-time query, and reachable only after the gate
  // above has already admitted the caller.
  const allEvents = await store.listAllRoundEvents(args.round_id);
  const roster = await store.listParticipants(args.round_id);
  const labelById = new Map(
    roster.map((p) => [p.participant_id, p.pseudonym ?? p.display_name] as const),
  );
  // Same fallback string the reveal uses for a participant whose row is gone.
  const labelOf = (id: string): string => labelById.get(id) ?? 'Removed participant';

  const per_target: DisagreementTarget[] = reveal.per_target.map((row) => {
    const numeric = row.responses
      .map((r) => r.value)
      .filter((v): v is number => typeof v === 'number');

    const shape = classifyDivergence(numeric);
    const distinctValues = new Set(numeric).size;

    // The ends of the range. Computed only when there IS a range, so a
    // single-view target cannot render a spread of zero and read as agreement.
    const spread =
      shape === 'split'
        ? (() => {
            const low = Math.min(...numeric);
            const high = Math.max(...numeric);
            return { low, high, width: high - low };
          })()
        : null;

    const positions: DisagreementPosition[] = row.responses.map((r) => ({
      participant_id: r.participant_id,
      display_label: r.display_label,
      value: r.value,
      stated_basis: r.expression_raw,
      confidence: r.confidence,
      kind: r.kind,
      // Marked by VALUE EQUALITY WITH THE END, so ties both count. Deliberately
      // not "the first row holding the min": that would name one person the
      // low pole and leave an identical colleague unmarked.
      pole:
        spread === null || r.value === null
          ? null
          : r.value === spread.low
            ? 'low'
            : r.value === spread.high
              ? 'high'
              : null,
    }));

    const withBasis = row.responses.filter(
      (r) => typeof r.value === 'number' && r.expression_raw !== null && r.expression_raw !== '',
    ).length;

    const evidence: DisagreementEvidence[] = allEvents
      // Bound by IDENTITY — this target's id and the evidence kind — never by a
      // predicate like "has an evidence member", which a future row could
      // satisfy for another reason (CLAUDE.md trap 19).
      //
      // ⚠ The object check is not belt-and-braces: it also holds this read
      // together on a CEE deployed AHEAD of its migration, where the column
      // does not exist and every row's `evidence` reads `undefined` rather than
      // null. Nothing can write an `evidence_attached` row in that state (the
      // CHECK constraint refuses the kind), so the filter is empty either way —
      // but a narrowing that assumed null would have thrown rather than
      // returned nothing, turning a deploy-order gap into a 500.
      .filter(
        (e): e is typeof e & { evidence: ElicitationEvidence } =>
          e.kind === 'evidence_attached' &&
          e.target.id === row.target.id &&
          typeof e.evidence === 'object' &&
          e.evidence !== null,
      )
      .map((e) => {
        const ev = e.evidence;
        return {
          event_id: e.event_id,
          // The SERVER's stamp. Not `e.participant_id`, even though the append
          // seam sets them equal today: `authored_by` is the field the contract
          // makes unforgeable, and reading the other one would quietly move
          // this surface off the guarantee.
          authored_by: e.provenance.authored_by,
          author_label: labelOf(e.provenance.authored_by),
          stance: ev.stance,
          stance_phrase: STANCE_PHRASE[ev.stance],
          kind: ev.kind,
          body: ev.body,
          url: ev.url,
          about_participant_id: ev.about_participant_id,
          about_label: ev.about_participant_id === null ? null : labelOf(ev.about_participant_id),
          created_at: e.created_at,
        };
      });

    const facts: DisagreementFacts = {
      label: row.label,
      answering: numeric.length,
      distinctValues,
      withStatedBasis: withBasis,
      declined: row.responses.filter((r) => r.kind === 'declined').length,
      evidenceCount: evidence.length,
      hasChallenge: evidence.some((e) => e.stance === 'challenges'),
    };

    return {
      target: { kind: row.target.kind, id: row.target.id },
      label: row.label,
      model_value_at_version: row.model_value_at_version,
      shape,
      answering_participants: numeric.length,
      distinct_values: distinctValues,
      spread,
      positions,
      positions_with_stated_basis: withBasis,
      evidence,
      headline: divergenceHeadline(shape, facts),
      question: interrogationQuestion(shape, facts),
    };
  });

  return {
    round_id: reveal.round_id,
    graph_version_ref: reveal.graph_version_ref,
    per_target,
  };
}

/**
 * Render the disagreement as text a PROMPT can consume, so the assistant can
 * help a team interrogate a divergence it did not invent.
 *
 * ⭐⭐ THE ASSISTANT IS GIVEN THE POSITIONS, NEVER THE JUDGEMENT. This function
 * emits attributed facts — who said what number, in whose words, with what
 * evidence — and stops. It contains no instruction to weigh, rank, reconcile or
 * recommend, and it must not grow one: the moment the model is handed "decide
 * which is better supported", the product resolves a disagreement its users
 * have not resolved, under a name that looks like analysis. Whatever guidance
 * the assistant is given belongs in the prompt that consumes this, where it is
 * reviewable, and the standing rule for that prompt is the same as for
 * `disagreement-copy.ts`: restate or ask, never adjudicate.
 *
 * ⚠ DETERMINISTIC AND PINNED. No timestamps, no ids that vary per run, no
 * iteration over an unordered collection — the output for a given round is
 * byte-stable, so a prompt-drift gate can pin it and a change shows up as a
 * diff rather than as a behaviour nobody noticed.
 *
 * ⚠ NOT WIRED INTO ANY PROMPT AT THIS TIP, and that is deliberate rather than
 * unfinished: the context assembly seam is owned by another lane. The insertion
 * point, its tests and its mutants are specified in
 * `olumi-docs/PHASE0-EVIDENCE-2026-07-28/collab-evidence-challenge-2026-08-14/HOP-READY-TO-APPLY.md`.
 * Until that lands, this function is exercised by its own tests and by the
 * disagreement route's callers — it is honestly one rung below wire-witnessed
 * and is reported as such.
 */
export function summariseDisagreementForPrompt(view: DisagreementView): string {
  const lines: string[] = [];

  for (const t of view.per_target) {
    if (t.shape === 'no_answers') continue;

    lines.push(`## ${t.label !== '' ? t.label : t.target.id}`);
    if (t.model_value_at_version !== null) {
      lines.push(`The model held ${t.model_value_at_version} when the round opened.`);
    }
    lines.push(t.headline);

    for (const p of t.positions) {
      if (p.kind === 'declined') {
        lines.push(`- ${p.display_label} declined to give a number.`);
        continue;
      }
      const basis = p.stated_basis !== null && p.stated_basis !== '' ? ` — "${p.stated_basis}"` : '';
      const conf = p.confidence !== null ? ` (confidence ${p.confidence})` : '';
      lines.push(`- ${p.display_label}: ${p.value ?? 'no number'}${conf}${basis}`);
    }

    for (const e of t.evidence) {
      const about = e.about_label !== null ? `${e.about_label}'s position` : 'this factor';
      const link = e.url !== null ? ` [${e.url}]` : '';
      lines.push(`- Evidence from ${e.author_label}, ${e.stance_phrase} ${about}: "${e.body}"${link}`);
    }

    if (t.question !== null) lines.push(`Question for the team: ${t.question}`);
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}
