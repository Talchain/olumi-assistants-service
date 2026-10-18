/**
 * PERSPECTIVES — typed stakeholder differences from ATTRIBUTED CLAIMS.
 *
 * A pure, deterministic read. It takes a GraphV3 and a list of claims that each
 * name WHO holds a view, and returns where those views differ on the SAME model
 * element, typed as a GOAL difference (what people want) or a BELIEF difference
 * (what people think is true), each with the model assumption it bears on and
 * the question or test that would move it. Attribution is kept on every party.
 *
 * ── WHAT THIS IS NOT ──────────────────────────────────────────────────────
 * · NOT a team-inference engine. It never invents a holder, a view or a quote:
 *   every party comes from a supplied claim, and a claim whose holder the source
 *   does not name is REFUSED, not relabelled.
 * · NOT an adjudicator. There is no mean, midpoint, winner, preferred or
 *   resolved member at any level; positions are listed, never combined (the
 *   no-forced-consensus doctrine of `@talchain/schemas` boundary/collab.ts).
 * · NOT a writer. It returns data; it never mutates the graph or the claims.
 *   Changing the shared model still needs the user's press.
 * · NOT a fourth "disagreement" concept. `toContractParts` projects each
 *   difference onto the PUBLISHED `DisagreementSchema` parts (type / subject /
 *   parties), which exist in the contract with no producer today. Brief-supplied
 *   claims are the contract's "entered via the facilitation conversation" path
 *   (`round_id` absent). The COLLAB round read model
 *   (`src/collab/disagreement-read-model.ts`) remains the numeric panel path; a
 *   panel answer enters here as a `panel_participant` holder.
 *
 * ── HYPOTHETICAL PERSPECTIVES ─────────────────────────────────────────────
 * A holder of kind `hypothetical` is an Olumi-generated lens ("a CFO lens"). It
 * is labelled "Hypothetical: …" on every surface string, is reported by the
 * assistant (never the owner), may not carry a quote (a quote would be an
 * invented one), and never counts towards a TEAM disagreement
 * (`real_holders_differ`).
 */

import {
  DisagreementPartySchema,
  DisagreementSubjectSchema,
  type DisagreementParty,
  type DisagreementSubject,
  type DisagreementTypeLiteral,
} from '@talchain/schemas/boundary';
import type { GraphV3T } from '../schemas/cee-v3.js';

/* ──────────────────────────────────────────────────────────────────────────
 * Input
 * ────────────────────────────────────────────────────────────────────────── */

/** WHO holds a view. Closed union: a new kind must answer "is this a real person?" */
export type PerspectiveHolder =
  /** The owner's own view, in their words. */
  | { readonly kind: 'user' }
  /** A person or role the USER named in the source ("Sales thinks…"). Their view as the user reported it. */
  | { readonly kind: 'named_stakeholder'; readonly label: string }
  /** A colleague's own answer in a COLLAB round (first-hand, server-stamped there). */
  | {
      readonly kind: 'panel_participant';
      readonly round_id: string;
      readonly participant_id: string;
      readonly label: string;
    }
  /** An Olumi-generated lens. Never a real team member. */
  | { readonly kind: 'hypothetical'; readonly label: string };

/** What the claim is ABOUT — node-id / from+to addressed, never by label. */
export type ClaimSubject =
  | { readonly kind: 'goal'; readonly id: string }
  | { readonly kind: 'factor'; readonly id: string }
  | { readonly kind: 'edge'; readonly from: string; readonly to: string };

/** What the holder says. `objective` is a GOAL position; `figure` and `effect` are BELIEFS. */
export type ClaimStance =
  | { readonly kind: 'objective'; readonly statement: string }
  | {
      readonly kind: 'figure';
      readonly value: number;
      readonly unit: string | null;
      readonly expression_raw: string;
    }
  | {
      readonly kind: 'effect';
      readonly direction: 'increases' | 'decreases' | 'no_effect';
      readonly expression_raw: string;
    };

export interface AttributedClaim {
  readonly claim_id: string;
  readonly holder: PerspectiveHolder;
  readonly subject: ClaimSubject;
  readonly stance: ClaimStance;
  /**
   * The holder's words VERBATIM from the source. Required for `user` and
   * `named_stakeholder` (and must occur in `source_text`); FORBIDDEN for
   * `hypothetical`; optional for `panel_participant` (its words live on the
   * round's event row).
   */
  readonly source_quote: string | null;
}

export interface DeriveOptions {
  /** The text the user supplied (the brief or turn). Required to admit `user` / `named_stakeholder` claims. */
  readonly source_text?: string | null;
}

/* ──────────────────────────────────────────────────────────────────────────
 * Output
 * ────────────────────────────────────────────────────────────────────────── */

export type RefusalReason =
  | 'duplicate_claim_id'
  | 'subject_not_in_model'
  | 'subject_kind_mismatch'
  | 'stance_does_not_fit_subject'
  | 'hypothetical_cannot_quote'
  | 'missing_source_quote'
  | 'source_text_required'
  | 'quote_not_in_source'
  | 'holder_not_named_in_source';

export interface RefusedClaim {
  readonly claim_id: string;
  readonly reason: RefusalReason;
}

/** The model element a difference bears on, and what the model holds there now (with its provenance). */
export interface AssumptionRef {
  readonly subject: ClaimSubject;
  /** The model field that carries the contested value. */
  readonly field: 'goal' | 'observed_state.value' | 'strength.mean';
  readonly label: string;
  /** What the model holds now, or null. Reported beside the positions, never as a verdict on them. */
  readonly model_value: number | null;
  /** The model value's own provenance literal (`observed_state.source` / `provenance.source` / `threshold_source`). */
  readonly model_value_source: string | null;
}

export type Resolution =
  | {
      /** A BELIEF difference: evidence can move it. */
      readonly kind: 'evidence_test';
      readonly assumption: AssumptionRef;
      readonly question: string;
      readonly test: string;
    }
  | {
      /** A GOAL difference: a choice for the team. No test settles it. */
      readonly kind: 'priority_choice';
      readonly assumption: AssumptionRef;
      readonly question: string;
      /** The contract's expected terminal state for a preference difference. */
      readonly expected_terminal_status: 'accepted_as_difference';
    };

export interface DifferenceParty {
  readonly holder: PerspectiveHolder;
  readonly display_label: string;
  readonly attribution_note: string;
  readonly is_hypothetical: boolean;
  /** Who SUPPLIED this view — the contract's `AuthoredBy`. Derived from the holder, never taken from input. */
  readonly reported_by: string;
  readonly claim_ids: readonly string[];
  readonly positions: readonly ClaimStance[];
  /** Verbatim quotes. Always empty for a hypothetical holder. */
  readonly source_quotes: readonly string[];
}

export interface StakeholderDifference {
  readonly difference_id: string;
  readonly difference_kind: 'goal' | 'belief';
  /** Belief sub-shape: differing figures, whether the link exists at all, or which way it acts. Null for goals. */
  readonly belief_shape: 'figure' | 'existence' | 'direction' | null;
  /** The published `DisagreementType` this maps to. */
  readonly contract_type: DisagreementTypeLiteral;
  readonly subject: ClaimSubject;
  readonly subject_label: string;
  readonly parties: readonly DifferenceParty[];
  readonly involves_hypothetical: boolean;
  /** True only when two or more REAL (non-hypothetical) holders hold different positions. */
  readonly real_holders_differ: boolean;
  /** Figures only: whether every figure shares one unit. Null when not a figure difference. */
  readonly units_comparable: boolean | null;
  readonly resolution: Resolution;
  /** Code-owned restatement. Never ranks, averages or names a winner. */
  readonly headline: string;
}

export interface AlignedSubject {
  readonly subject: ClaimSubject;
  readonly difference_kind: 'goal' | 'belief';
  readonly holder_labels: readonly string[];
}

export interface StakeholderDifferences {
  readonly differences: readonly StakeholderDifference[];
  /** Subjects where two or more holders gave the same position — shown, not hidden. */
  readonly aligned: readonly AlignedSubject[];
  /** Claims not admitted, each with its reason. Never silently dropped. */
  readonly refused: readonly RefusedClaim[];
}

/* ──────────────────────────────────────────────────────────────────────────
 * Derivation
 * ────────────────────────────────────────────────────────────────────────── */

type NodeLike = GraphV3T['nodes'][number];
type EdgeLike = GraphV3T['edges'][number];

function subjectKey(s: ClaimSubject): string {
  return s.kind === 'edge' ? `edge:${s.from}->${s.to}` : `${s.kind}:${s.id}`;
}

function holderKey(h: PerspectiveHolder): string {
  switch (h.kind) {
    case 'user':
      return 'user';
    case 'named_stakeholder':
      return `named:${normaliseText(h.label)}`;
    case 'panel_participant':
      return `panel:${h.round_id}:${h.participant_id}`;
    case 'hypothetical':
      return `hypothetical:${normaliseText(h.label)}`;
  }
}

function reportedBy(h: PerspectiveHolder): string {
  switch (h.kind) {
    case 'user':
    case 'named_stakeholder':
      // The owner SUPPLIED this view — for a named stakeholder, as their report of someone else's.
      return 'owner';
    case 'panel_participant':
      return h.participant_id;
    case 'hypothetical':
      return 'assistant';
  }
}

function displayOf(h: PerspectiveHolder): { display_label: string; attribution_note: string } {
  switch (h.kind) {
    case 'user':
      return { display_label: 'You', attribution_note: 'Your own view, in your words.' };
    case 'named_stakeholder':
      return {
        display_label: h.label,
        attribution_note: `Named in your brief. This is ${h.label}'s view as you reported it.`,
      };
    case 'panel_participant':
      return { display_label: h.label, attribution_note: 'Their own answer in a panel round.' };
    case 'hypothetical':
      return {
        display_label: `Hypothetical: ${h.label}`,
        attribution_note: 'An Olumi-generated perspective. Not a member of your team, and not anyone\'s stated view.',
      };
  }
}

function normaliseText(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').replace(/[.!?;,]+$/u, '').trim();
}

function containsWord(haystack: string, needle: string): boolean {
  const n = normaliseText(needle);
  if (n === '') return false;
  const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`, 'i').test(haystack.toLowerCase());
}

function positionKey(st: ClaimStance): string {
  switch (st.kind) {
    case 'objective':
      return `objective:${normaliseText(st.statement)}`;
    case 'figure':
      return `figure:${st.value}|${st.unit ?? ''}`;
    case 'effect':
      return `effect:${st.direction}`;
  }
}

function classOf(st: ClaimStance): 'goal' | 'belief' {
  return st.kind === 'objective' ? 'goal' : 'belief';
}

function stanceFitsSubject(st: ClaimStance, s: ClaimSubject): boolean {
  if (st.kind === 'objective') return s.kind === 'goal';
  if (st.kind === 'effect') return s.kind === 'edge';
  return true; // a figure may be about a factor's level, a goal's outcome, or a link's size
}

function findNode(graph: GraphV3T, id: string): NodeLike | undefined {
  return graph.nodes.find((n) => n.id === id);
}

function findEdge(graph: GraphV3T, from: string, to: string): EdgeLike | undefined {
  return graph.edges.find((e) => e.from === from && e.to === to);
}

function admit(
  graph: GraphV3T,
  claims: readonly AttributedClaim[],
  sourceText: string | null,
): { admitted: AttributedClaim[]; refused: RefusedClaim[] } {
  const admitted: AttributedClaim[] = [];
  const refused: RefusedClaim[] = [];
  const seen = new Set<string>();
  const src = sourceText === null ? null : sourceText.replace(/\s+/g, ' ');

  for (const c of claims) {
    const refuse = (reason: RefusalReason): void => {
      refused.push({ claim_id: c.claim_id, reason });
    };
    if (seen.has(c.claim_id)) {
      refuse('duplicate_claim_id');
      continue;
    }
    seen.add(c.claim_id);

    // Subject must be a real model element, addressed by identity.
    if (c.subject.kind === 'edge') {
      if (findEdge(graph, c.subject.from, c.subject.to) === undefined) {
        refuse('subject_not_in_model');
        continue;
      }
    } else {
      const node = findNode(graph, c.subject.id);
      if (node === undefined) {
        refuse('subject_not_in_model');
        continue;
      }
      if (node.kind !== c.subject.kind) {
        refuse('subject_kind_mismatch');
        continue;
      }
    }
    if (!stanceFitsSubject(c.stance, c.subject)) {
      refuse('stance_does_not_fit_subject');
      continue;
    }

    // Attribution guards.
    const quote = c.source_quote;
    const hasQuote = typeof quote === 'string' && quote.trim() !== '';
    if (c.holder.kind === 'hypothetical') {
      if (hasQuote) {
        refuse('hypothetical_cannot_quote');
        continue;
      }
    } else if (c.holder.kind === 'user' || c.holder.kind === 'named_stakeholder') {
      if (!hasQuote) {
        refuse('missing_source_quote');
        continue;
      }
      if (src === null) {
        refuse('source_text_required');
        continue;
      }
      if (!src.toLowerCase().includes(quote.replace(/\s+/g, ' ').toLowerCase())) {
        refuse('quote_not_in_source');
        continue;
      }
      if (c.holder.kind === 'named_stakeholder' && !containsWord(src, c.holder.label)) {
        refuse('holder_not_named_in_source');
        continue;
      }
    }
    admitted.push(c);
  }
  return { admitted, refused };
}

function assumptionFor(graph: GraphV3T, subject: ClaimSubject): AssumptionRef {
  if (subject.kind === 'edge') {
    const e = findEdge(graph, subject.from, subject.to);
    const fromLabel = findNode(graph, subject.from)?.label ?? subject.from;
    const toLabel = findNode(graph, subject.to)?.label ?? subject.to;
    return {
      subject,
      field: 'strength.mean',
      label: `${fromLabel} → ${toLabel}`,
      model_value: typeof e?.strength?.mean === 'number' ? e.strength.mean : null,
      model_value_source: e?.provenance?.source ?? null,
    };
  }
  const n = findNode(graph, subject.id);
  const label = n?.label ?? subject.id;
  if (subject.kind === 'goal') {
    return {
      subject,
      field: 'goal',
      label,
      model_value: typeof n?.goal_threshold === 'number' ? n.goal_threshold : null,
      model_value_source: typeof n?.threshold_source === 'string' ? n.threshold_source : null,
    };
  }
  return {
    subject,
    field: 'observed_state.value',
    label,
    model_value: typeof n?.observed_state?.value === 'number' ? n.observed_state.value : null,
    model_value_source: n?.observed_state?.source ?? null,
  };
}

function beliefShape(positions: readonly ClaimStance[]): 'figure' | 'existence' | 'direction' {
  const effects = positions.filter(
    (p): p is Extract<ClaimStance, { kind: 'effect' }> => p.kind === 'effect',
  );
  const saysNone = effects.some((p) => p.direction === 'no_effect');
  const saysSome = positions.some((p) => p.kind === 'figure' || (p.kind === 'effect' && p.direction !== 'no_effect'));
  if (saysNone && saysSome) return 'existence';
  const dirs = new Set(effects.filter((p) => p.direction !== 'no_effect').map((p) => p.direction));
  if (dirs.size > 1) return 'direction';
  return 'figure';
}

function joinLabels(labels: readonly string[]): string {
  if (labels.length <= 1) return labels.join('');
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

function resolutionFor(
  kind: 'goal' | 'belief',
  assumption: AssumptionRef,
  graph: GraphV3T,
): Resolution {
  if (kind === 'goal') {
    return {
      kind: 'priority_choice',
      assumption,
      question:
        'If these objectives pull apart, which should this decision favour — or should one become a limit the other must stay within? No measurement settles this; it is a choice for the team.',
      expected_terminal_status: 'accepted_as_difference',
    };
  }
  if (assumption.subject.kind === 'edge') {
    const fromLabel = findNode(graph, assumption.subject.from)?.label ?? assumption.subject.from;
    const toLabel = findNode(graph, assumption.subject.to)?.label ?? assumption.subject.to;
    return {
      kind: 'evidence_test',
      assumption,
      question: `Does "${fromLabel}" move "${toLabel}", and by how much?`,
      test: `Look at what happened to "${toLabel}" the last time "${fromLabel}" changed, or run a small, reversible test before relying on either view.`,
    };
  }
  return {
    kind: 'evidence_test',
    assumption,
    question: `What would show which figure for "${assumption.label}" holds?`,
    test: `Check "${assumption.label}" against a recent measurement or a comparable case before relying on either figure.`,
  };
}

/**
 * Derive the typed differences between attributed claims on one graph.
 * Pure and deterministic: same inputs, byte-identical output; inputs untouched.
 */
export function deriveStakeholderDifferences(
  graph: GraphV3T,
  claims: readonly AttributedClaim[],
  options: DeriveOptions = {},
): StakeholderDifferences {
  const { admitted, refused } = admit(graph, claims, options.source_text ?? null);

  // Group by (class, subject). A goal claim and a belief claim on one node are
  // different questions, never a disagreement with each other.
  const groups = new Map<string, AttributedClaim[]>();
  for (const c of admitted) {
    const key = `${classOf(c.stance)}|${subjectKey(c.subject)}`;
    const g = groups.get(key);
    if (g === undefined) groups.set(key, [c]);
    else g.push(c);
  }

  const differences: StakeholderDifference[] = [];
  const aligned: AlignedSubject[] = [];

  for (const key of [...groups.keys()].sort()) {
    const group = groups.get(key) ?? [];
    const kind = classOf(group[0].stance);
    const subject = group[0].subject;

    // One party per HOLDER — one person with two claims is one voice.
    const byHolder = new Map<string, AttributedClaim[]>();
    for (const c of group) {
      const hk = holderKey(c.holder);
      const list = byHolder.get(hk);
      if (list === undefined) byHolder.set(hk, [c]);
      else list.push(c);
    }
    if (byHolder.size < 2) continue;

    const parties: DifferenceParty[] = [...byHolder.keys()].sort().map((hk) => {
      const cs = [...(byHolder.get(hk) ?? [])].sort((a, b) => a.claim_id.localeCompare(b.claim_id));
      const holder = cs[0].holder;
      return {
        holder,
        ...displayOf(holder),
        is_hypothetical: holder.kind === 'hypothetical',
        reported_by: reportedBy(holder),
        claim_ids: cs.map((c) => c.claim_id),
        positions: cs.map((c) => c.stance),
        source_quotes:
          holder.kind === 'hypothetical'
            ? []
            : cs.map((c) => c.source_quote).filter((q): q is string => typeof q === 'string' && q.trim() !== ''),
      };
    });

    const distinctAcross = new Set(parties.flatMap((p) => p.positions.map(positionKey)));
    if (distinctAcross.size < 2) {
      aligned.push({ subject, difference_kind: kind, holder_labels: parties.map((p) => p.display_label) });
      continue;
    }

    const real = parties.filter((p) => !p.is_hypothetical);
    const realDistinct = new Set(real.flatMap((p) => p.positions.map(positionKey)));
    const allPositions = parties.flatMap((p) => p.positions);
    const shape = kind === 'belief' ? beliefShape(allPositions) : null;
    const figures = allPositions.filter(
      (p): p is Extract<ClaimStance, { kind: 'figure' }> => p.kind === 'figure',
    );
    const assumption = assumptionFor(graph, subject);
    const labels = parties.map((p) => p.display_label);

    differences.push({
      difference_id: `persp:${kind}:${subjectKey(subject)}`,
      difference_kind: kind,
      belief_shape: shape,
      contract_type: kind === 'goal' ? 'goals' : shape === 'figure' ? 'evidence' : 'structure',
      subject,
      subject_label: assumption.label,
      parties,
      involves_hypothetical: parties.some((p) => p.is_hypothetical),
      real_holders_differ: real.length >= 2 && realDistinct.size >= 2,
      units_comparable:
        shape === 'figure' ? new Set(figures.map((f) => f.unit ?? '')).size <= 1 : null,
      resolution: resolutionFor(kind, assumption, graph),
      headline: `${joinLabels(labels)} hold different ${kind === 'goal' ? 'objectives' : 'beliefs'} about "${assumption.label}".`,
    });
  }

  return { differences, aligned, refused };
}

/* ──────────────────────────────────────────────────────────────────────────
 * Projection onto the published contract
 * ────────────────────────────────────────────────────────────────────────── */

function toContractPosition(st: ClaimStance): DisagreementParty['position'] {
  switch (st.kind) {
    case 'objective':
      return { kind: 'preference', statement: st.statement };
    case 'figure':
      return { kind: 'attributed_value', value: st.value, expression_raw: st.expression_raw };
    case 'effect':
      // ⚠ LOSSY, NAMED: the contract's structural arms are `.strict()` and carry
      // no words and no direction. See DESIGN.md "proposed schema changes".
      return st.direction === 'no_effect' ? { kind: 'absent' } : { kind: 'exists' };
  }
}

/**
 * Project a difference onto the published `DisagreementSchema` parts, each
 * parsed by the contract's own strict schema. One contract party per position.
 *
 * ⚠ The contract's party identity is `authored_by` = WHO SUPPLIED the view
 * (`'owner' | 'assistant' | <participant uuid>`). Two stakeholders the user
 * named ("Sales", "Finance") both project to `'owner'` and become
 * indistinguishable there. That is the one field this lane proposes adding.
 */
export function toContractParts(d: StakeholderDifference): {
  readonly type: DisagreementTypeLiteral;
  readonly subject: DisagreementSubject;
  readonly parties: readonly DisagreementParty[];
} {
  const subject = DisagreementSubjectSchema.parse(
    d.subject.kind === 'edge'
      ? { kind: 'edge', from: d.subject.from, to: d.subject.to }
      : { kind: d.subject.kind, id: d.subject.id },
  );
  const parties = d.parties.flatMap((p) =>
    p.positions.map((pos) =>
      DisagreementPartySchema.parse({ authored_by: p.reported_by, position: toContractPosition(pos) }),
    ),
  );
  return { type: d.contract_type, subject, parties };
}
