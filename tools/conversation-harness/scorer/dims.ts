/**
 * Scorer dims (conversation-harness v0) — property-based, NEVER exact-text.
 *
 * Pure functions over turn rows + L0 snapshots so they are unit-testable with
 * fixture envelopes (see __tests__/dims.harness-test.ts). Production-guard
 * scoring (D11 inputs) is computed in score-run.ts, which imports the REAL
 * guard modules from src/ (never copies — drift returns); the aggregation here
 * only reads the hit fields off the rows.
 *
 * Verdict vocabulary:
 *   pass / fail          — enforced dims
 *   advisory-fail        — measured against a budget, not a gate (D8, D4)
 *   log                  — BASELINE-LOG mode: measure only, no pass/fail
 *                          (D3 until ROADMAP 2.47(b) lands; D9 while the
 *                          tunable-auto-apply lane is changing consent counts)
 *   unmeasurable         — required capture layer absent; NEVER reported green
 *
 * Flaky dims (D1, D2 — LLM-composition dependent) are aggregated over N=3
 * reruns by aggregateFlakyDims (majority verdict).
 */

export interface ChipRef {
  id: string;
  label: string;
  /** Action family carried on the wire chip (e.g. "apply_edit"), when present.
   * Part of the D1 SEMANTIC repeat key — ids are regenerated per turn and must
   * not be part of repeat identity. */
  action?: string | null;
}

export interface TurnRow {
  turn: string;
  turnClassHint: string | null;
  editIntent: boolean;
  onlyIf: string | null;
  skipped: boolean;
  duplicateOf: string | null;
  httpStatus: number | null;
  startedAt: string | null;
  wallClockMs: number | null;
  assistantText: string;
  chips: ChipRef[];
  substageTimings: Record<string, number> | null;
  guardHits?: {
    forbidden: string | null;
    successClaim: string | null;
    heldScience: boolean;
    mutationLanguage: boolean;
    structuralSuccessClaim: boolean;
  };
  /** L0 mutation oracle for THIS turn's window: true = the scenario graph sha
   * changed across the turn (a mutation committed in DB), false = L0 present
   * and the sha did NOT change, null/undefined = no L0 oracle for this turn.
   * Attached by attachMutationOutcomes (called from score-run.ts). */
  mutationCommitted?: boolean | null;
}

export interface L0HandlerFact {
  v5_conversation_turn_id: string;
  handler_id: string | null;
  action_type: string | null;
  noop: boolean | null;
  created_at: string;
  fact_type: string | null;
  payload_sha256: string;
}

export interface L0Snap {
  label: string;
  captured_at: string;
  graph?: { sha256: string } | null;
  handler_facts?: L0HandlerFact[] | { __error: string };
  __error?: string;
}

export type DimVerdict = 'pass' | 'fail' | 'advisory-fail' | 'log' | 'unmeasurable';

export interface DimResult {
  dim: string;
  verdict: DimVerdict;
  flaky: boolean;
  details: unknown;
  notes: string[];
}

// ---------- wire extraction (kept here so it is testable without src/) ----------

export interface TurnMeta {
  turn?: string;
  started_at?: string;
  wall_clock_ms?: number;
  http_status?: number | null;
  skipped?: boolean;
  turn_class_hint?: string | null;
  edit_intent?: boolean;
  only_if?: string | null;
  duplicate_of?: string | null;
}

export function rowFromWire(turnId: string, wire: unknown, meta: TurnMeta = {}): TurnRow {
  const w = (wire ?? {}) as Record<string, unknown>;
  const chipsRaw = Array.isArray(w.suggested_actions) ? (w.suggested_actions as unknown[]) : [];
  const trace = (w._diagnostic_trace ?? null) as Record<string, unknown> | null;
  const timingsRaw = trace?.substage_timings ?? trace?.timings ?? null;
  return {
    turn: turnId,
    turnClassHint: meta.turn_class_hint ?? null,
    editIntent: Boolean(meta.edit_intent),
    onlyIf: meta.only_if ?? null,
    skipped: Boolean(meta.skipped),
    duplicateOf: meta.duplicate_of ?? null,
    httpStatus: meta.http_status ?? null,
    startedAt: meta.started_at ?? null,
    wallClockMs: meta.wall_clock_ms ?? null,
    assistantText: typeof w.assistant_text === 'string' ? w.assistant_text : '',
    chips: chipsRaw.map((c) => {
      const chip = (c ?? {}) as Record<string, unknown>;
      return {
        id: String(chip.id ?? ''),
        label: String(chip.label ?? ''),
        action: chip.action != null ? String(chip.action) : null,
      };
    }),
    substageTimings:
      timingsRaw && typeof timingsRaw === 'object' && !Array.isArray(timingsRaw)
        ? (timingsRaw as Record<string, number>)
        : null,
  };
}

// ---------- shared helpers ----------

function chipKey(c: ChipRef): string {
  return `${c.id}|${c.label}`.toLowerCase().trim();
}

export function chipSet(row: TurnRow): Set<string> {
  return new Set(row.chips.map(chipKey));
}

/** SEMANTIC chip identity (C11): normalised label + action family, NO id — a
 * regenerated id on an otherwise identical chip must not evade repeat
 * detection. Label normalisation: lowercase, punctuation stripped, whitespace
 * collapsed. */
export function chipSemanticKey(c: ChipRef): string {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  return `${norm(c.label)}|${norm(String(c.action ?? ''))}`;
}

export function chipSemanticSet(row: TurnRow): Set<string> {
  return new Set(row.chips.map(chipSemanticKey));
}

/** Consent-family chips (apply/confirm/cancel…) legitimately PERSIST while a
 * proposal is held — a repeated consent set is a WANTED repeat, not a loop.
 * Property-based, mirrors runner.mjs consent detection. */
const CONSENT_FAMILY = /\b(apply|confirm|approve|go ahead|yes|cancel|dismiss|discard|keep|reject)\b/i;

export function isConsentChipSet(row: TurnRow): boolean {
  return row.chips.length > 0 && row.chips.every((c) => CONSENT_FAMILY.test(`${c.id} ${c.label} ${c.action ?? ''}`));
}

// ---------- L0 mutation oracle + guard conditioning (C10 / PQ5 turn-awareness) ----------

/** Edit-flow turns: an edit-class turn, an explicit edit intent, or a consent
 * turn ("yes, apply") — the turns whose assistant text may legitimately be an
 * applied-edit RECEIPT. */
export function isEditFlowTurn(row: TurnRow): boolean {
  return (row.turnClassHint ?? '') === 'edit' || row.editIntent || row.onlyIf === 'consent_requested';
}

/** Attach the per-turn L0 mutation outcome to each row (TurnRow.mutationCommitted).
 *
 * Oracle: the runner snapshots L0 after every executed turn with label
 * `NN-<turnId>` (plus `00-baseline`). For a row, committed = the graph sha of
 * its own post-turn snapshot differs from the immediately preceding snapshot's
 * sha (ordered by captured_at). Missing snapshot / missing shas -> null
 * (never guessed). Duplicate-capture rows (-dup) have no own snapshot -> null. */
export function attachMutationOutcomes(rows: TurnRow[], snaps: L0Snap[]): void {
  const usable = (snaps ?? []).filter((s) => s && !s.__error);
  if (usable.length === 0) return; // leave undefined — no oracle at all
  const ordered = [...usable].sort((a, b) => (a.captured_at ?? '').localeCompare(b.captured_at ?? ''));
  for (const row of rows) {
    const idx = ordered.findIndex((s) => typeof s.label === 'string' && s.label.endsWith(`-${row.turn}`));
    if (idx <= 0) {
      row.mutationCommitted = null; // no own snapshot, or nothing before it to diff against
      continue;
    }
    const after = graphSha(ordered[idx]);
    const before = graphSha(ordered[idx - 1]);
    row.mutationCommitted = after != null && before != null ? after !== before : null;
  }
}

export interface GuardViolationView {
  forbidden: string | null;
  successClaim: string | null;
  heldScience: boolean;
  /** Conditioned: raw hit minus excused applied-edit receipts. */
  mutationLanguage: boolean;
  /** Conditioned: raw hit minus turns where the L0 oracle proves a commit. */
  structuralSuccessClaim: boolean;
  /** Human-readable excusals (raw hit present but NOT a violation). */
  excused: string[];
}

/** Turn-class + L0-outcome conditioning of the raw production-guard hits
 * (C10 / PQ5 turn-awareness):
 *   - mutationLanguage — wrong on NON-edit answers; on an edit-flow turn a
 *     receipt is legitimate iff the L0 diff shows the mutation COMMITTED.
 *     With no L0 oracle an edit-flow receipt is excused-with-note (the
 *     dangerous held-claim case is still caught by PQ6(a)/(b) via the wire
 *     surfaces); a non-edit-flow hit always stands.
 *   - structuralSuccessClaim — wrong only when NO mutation committed (L0
 *     oracle). Same no-oracle handling.
 * Raw hits stay untouched on the row; dims aggregate THIS view. */
export function guardViolations(row: TurnRow): GuardViolationView | null {
  const g = row.guardHits;
  if (!g) return null;
  const excused: string[] = [];
  const committed = row.mutationCommitted;
  const editFlow = isEditFlowTurn(row);
  let mutationLanguage = g.mutationLanguage;
  let structuralSuccessClaim = g.structuralSuccessClaim;
  if (mutationLanguage) {
    if (committed === true) {
      mutationLanguage = false;
      excused.push('mutationLanguage: applied-mutation receipt (L0 graph sha changed this turn)');
    } else if (committed == null && editFlow) {
      mutationLanguage = false;
      excused.push('mutationLanguage: edit-flow receipt UNVERIFIED (no L0 oracle) — held-claim case still gated by PQ6(b)');
    }
  }
  if (structuralSuccessClaim) {
    if (committed === true) {
      structuralSuccessClaim = false;
      excused.push('structuralSuccessClaim: mutation committed (L0 graph sha changed this turn)');
    } else if (committed == null && editFlow) {
      structuralSuccessClaim = false;
      excused.push('structuralSuccessClaim: edit-flow receipt UNVERIFIED (no L0 oracle) — held case still gated by PQ6(a)');
    }
  }
  return {
    forbidden: g.forbidden,
    successClaim: g.successClaim,
    heldScience: g.heldScience,
    mutationLanguage,
    structuralSuccessClaim,
    excused,
  };
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  return inter / (a.size + b.size - inter);
}

function questionSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n/)
    .map((s) => s.trim())
    .filter((s) => s.endsWith('?'));
}

export interface QuestionClass {
  eitherOr: boolean;
  enumerated: boolean;
  sentences: string[];
}

/** Either/or + enumerated-choice classification of the ASSISTANT text (regex,
 * property-based — matches the shape of a choice question, not exact text). */
export function classifyQuestion(text: string): QuestionClass {
  const qs = questionSentences(text);
  const eitherOr = qs.some(
    (s) => /\bor\b/i.test(s) && /\b(either|prefer|choose|pick|go with|which|rather)\b/i.test(s),
  );
  const enumeratedAsk = /\bwhich of (?:the|these|your) (?:two|three|four|\d+|following|options)\b/i.test(text);
  const listThenQuestion =
    /(?:^|\n)\s*(?:\d+[.)]|[-*])\s+\S[^\n]*\n\s*(?:\d+[.)]|[-*])\s+\S/.test(text) && qs.length > 0;
  return { eitherOr, enumerated: enumeratedAsk || listThenQuestion, sentences: qs };
}

function activeRows(rows: TurnRow[]): TurnRow[] {
  return rows.filter((r) => !r.skipped && r.duplicateOf == null);
}

// ---------- D1 chip-no-repeat ----------

export function dimD1ChipNoRepeat(rows: TurnRow[], k = 3): DimResult {
  const active = activeRows(rows);
  const perTurn: { turn: string; maxSimilarity: number; repeatOf: string | null; consentSet: boolean }[] = [];
  for (let i = 0; i < active.length; i += 1) {
    const cur = chipSemanticSet(active[i]);
    if (cur.size === 0) {
      perTurn.push({ turn: active[i].turn, maxSimilarity: 0, repeatOf: null, consentSet: false });
      continue;
    }
    let max = 0;
    let repeatOf: string | null = null;
    for (let j = Math.max(0, i - k); j < i; j += 1) {
      const prev = chipSemanticSet(active[j]);
      if (prev.size === 0) continue;
      const sim = jaccard(cur, prev);
      if (sim > max) {
        max = sim;
        repeatOf = active[j].turn;
      }
    }
    perTurn.push({
      turn: active[i].turn,
      maxSimilarity: Number(max.toFixed(3)),
      repeatOf: max >= 1 ? repeatOf : null,
      consentSet: isConsentChipSet(active[i]),
    });
  }
  const identicalRepeats = perTurn.filter((t) => t.maxSimilarity >= 1);
  // C11: consent sets (apply/confirm/cancel…) legitimately persist while a
  // proposal is held — a repeated PURE consent set is reported, not failed.
  const consentRepeats = identicalRepeats.filter((t) => t.consentSet);
  const unwantedRepeats = identicalRepeats.filter((t) => !t.consentSet);
  return {
    dim: 'D1-chip-no-repeat',
    verdict: unwantedRepeats.length >= 1 ? 'fail' : 'pass',
    flaky: true,
    details: {
      k,
      perTurn,
      identicalRepeats: identicalRepeats.map((t) => t.turn),
      unwantedRepeats: unwantedRepeats.map((t) => t.turn),
      consentRepeats: consentRepeats.map((t) => t.turn),
    },
    notes: [
      'fail = the FIRST turn whose SEMANTIC chip set (normalised label + action family, ids EXCLUDED — regenerated ids cannot evade) is identical (Jaccard 1.0) to a non-empty set within the previous K turns (C11)',
      'a repeated PURE consent set (apply/confirm/cancel family) is a WANTED repeat while a proposal is held — reported in consentRepeats, not failed',
      'base includes the 1.16j post-analysis chip-sameness fix — this dim verifies it holds in conversation',
    ],
  };
}

// ---------- D2 chip-presence-per-question-class ----------

/** Tokens that carry no alternative-identifying content (question scaffolding). */
const ALT_STOPWORDS = new Set([
  'would', 'could', 'should', 'your', 'with', 'that', 'this', 'than', 'them', 'they',
  'what', 'which', 'whether', 'prefer', 'rather', 'choose', 'pick', 'want', 'like',
  'option', 'options', 'either', 'instead', 'going', 'about', 'more', 'into', 'from',
  'have', 'take', 'make', 'keep', 'move',
]);

function contentTokens(s: string): string[] {
  return s
    .toLowerCase()
    .split(/\W+/)
    .filter((t) => t.length > 3 && !ALT_STOPWORDS.has(t));
}

/** Extract the STATED alternatives a choice question offers (C12).
 *   - either/or: the clauses either side of the first " or " in each either-or
 *     question sentence, leading cue phrases stripped.
 *   - enumerated: the numbered / bulleted list items in the text.
 * Property-based and conservative: returns [] when nothing extractable, and the
 * dim then falls back to the chip-count floor (never a silent pass on a parse
 * failure). */
export function extractStatedAlternatives(text: string, q: QuestionClass): string[] {
  const alts: string[] = [];
  if (q.eitherOr) {
    for (const sent of q.sentences) {
      if (!/\bor\b/i.test(sent)) continue;
      const parts = sent.replace(/\?+$/, '').split(/\bor\b/i);
      if (parts.length < 2) continue;
      for (const part of parts) {
        // Strip leading question scaffolding ("Would you prefer to", "either").
        const cleaned = part
          .replace(/^[\s,;:—-]+/, '')
          .replace(/^(?:would|do|should|could)\s+you\s+(?:prefer|rather|want|like|choose|pick|go\s+with)?\s*(?:to\s+)?/i, '')
          .replace(/^(?:either|rather|prefer(?:ring)?|choose|pick|go\s+with|which\s+is\s+better[,:]?)\s+/i, '')
          .trim();
        if (contentTokens(cleaned).length > 0) alts.push(cleaned);
      }
    }
  }
  if (q.enumerated) {
    for (const line of text.split('\n')) {
      const m = line.match(/^\s*(?:\d+[.)]|[-*])\s+(\S.*)$/);
      if (m && contentTokens(m[1]).length > 0) alts.push(m[1].trim());
    }
  }
  return alts;
}

export function dimD2ChipPresence(rows: TurnRow[]): DimResult {
  const qualifying = activeRows(rows)
    .map((r) => ({ row: r, q: classifyQuestion(r.assistantText) }))
    .filter(({ q }) => q.eitherOr || q.enumerated);
  const perTurn = qualifying.map(({ row, q }) => {
    const chipTokenSets = row.chips.map((c) => new Set(contentTokens(`${c.label} ${c.action ?? ''}`)));
    // C12: bind the chips to the STATED alternatives — each alternative the
    // question offers must be reachable via a chip that semantically overlaps
    // it (>=1 shared content token). chipCount>=2 alone is NOT correctness.
    const alternatives = extractStatedAlternatives(row.assistantText, q).slice(0, 4);
    const coverage = alternatives.map((alt) => {
      const altTokens = contentTokens(alt);
      const covered = chipTokenSets.some((chip) => altTokens.some((t) => chip.has(t)));
      return { alternative: alt, covered };
    });
    const uncovered = coverage.filter((c) => !c.covered).map((c) => c.alternative);
    const bindable = alternatives.length >= 2;
    const ok = row.chips.length >= 2 && (!bindable || uncovered.length === 0);
    return {
      turn: row.turn,
      class: q.eitherOr ? 'either-or' : 'enumerated',
      chipCount: row.chips.length,
      alternatives,
      coverage,
      uncoveredAlternatives: uncovered,
      bindable,
      ok,
    };
  });
  const failures = perTurn.filter((t) => !t.ok);
  return {
    dim: 'D2-chip-presence-per-question-class',
    verdict: qualifying.length === 0 ? 'log' : failures.length > 0 ? 'fail' : 'pass',
    flaky: true,
    details: { qualifyingTurns: perTurn, failures: failures.map((t) => t.turn) },
    notes: [
      'qualifying turn = assistant_text poses an either/or or enumerated-choice question (regex class, not exact text)',
      'fail = a qualifying turn whose SAME envelope carries <2 suggested_actions, OR (C12) whose chips do not cover every STATED alternative (>=1 shared content token per alternative) when >=2 alternatives are extractable',
      'when the alternatives cannot be extracted (bindable=false) the dim falls back to the chip-count floor — a parse failure is never a silent pass on binding',
      qualifying.length === 0 ? 'no qualifying question turns in this run — logged, not passed' : '',
    ].filter(Boolean),
  };
}

// ---------- D3 question-asking budget (BASELINE-LOG) ----------

export function dimD3QuestionBudget(rows: TurnRow[]): DimResult {
  const byClass: Record<string, { turns: number; questions: number; max: number }> = {};
  for (const r of activeRows(rows)) {
    const cls = r.turnClassHint ?? 'unknown';
    const count = (r.assistantText.match(/\?/g) ?? []).length;
    byClass[cls] = byClass[cls] ?? { turns: 0, questions: 0, max: 0 };
    byClass[cls].turns += 1;
    byClass[cls].questions += count;
    byClass[cls].max = Math.max(byClass[cls].max, count);
  }
  return {
    dim: 'D3-question-budget',
    verdict: 'log',
    flaky: false,
    details: { byClass },
    notes: ['BASELINE-LOG mode: no pass/fail until ROADMAP 2.47(b) lands a ratified per-class budget'],
  };
}

// ---------- D4 brevity (kept from the proven scorer; advisory) ----------

export function dimD4Brevity(rows: TurnRow[], coachWordBudget = 130): DimResult {
  const coachRows = activeRows(rows).filter((r) => (r.turnClassHint ?? '') === 'coach');
  const perTurn = coachRows.map((r) => {
    const words = r.assistantText.split(/\s+/).filter(Boolean).length;
    return { turn: r.turn, words, over: words > coachWordBudget };
  });
  const over = perTurn.filter((t) => t.over);
  return {
    dim: 'D4-brevity',
    verdict: coachRows.length === 0 ? 'log' : over.length > 0 ? 'advisory-fail' : 'pass',
    flaky: false,
    details: { coachWordBudget, perTurn, overBudget: over.map((t) => t.turn) },
    notes: ['word budget ~130 applies to coach-class turns (HARNESS-GUIDE rubric); advisory, not a gate'],
  };
}

// ---------- D8 latency budgets (ADVISORY) ----------

export const D8_BUDGETS_MS: Record<string, number> = {
  coach: 30_000,
  edit: 25_000,
  run_analysis: 25_000,
  draft: 75_000,
};

export function dimD8Latency(rows: TurnRow[], budgets: Record<string, number> = D8_BUDGETS_MS): DimResult {
  const measured = rows.filter(
    (r) => !r.skipped && r.wallClockMs != null && r.turnClassHint != null && budgets[r.turnClassHint] != null,
  );
  const perTurn = measured.map((r) => {
    const budget = budgets[r.turnClassHint as string];
    const slowest = r.substageTimings
      ? Object.entries(r.substageTimings)
          .filter(([, v]) => typeof v === 'number')
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
      : null;
    return {
      turn: r.turn,
      class: r.turnClassHint,
      wallClockMs: r.wallClockMs,
      budgetMs: budget,
      over: (r.wallClockMs as number) > budget,
      slowestSubstages: slowest,
    };
  });
  const over = perTurn.filter((t) => t.over);
  return {
    dim: 'D8-latency-budget',
    verdict: measured.length === 0 ? 'unmeasurable' : over.length > 0 ? 'advisory-fail' : 'pass',
    flaky: false,
    details: { budgets, perTurn, overBudget: over.map((t) => t.turn) },
    notes: [
      'ADVISORY budgets per turn class: coach<=30s, edit<=25s, run_analysis<=25s, draft<=75s',
      measured.length === 0 ? 'no turns carried both wall_clock_ms and a budgeted turn_class_hint' : '',
    ].filter(Boolean),
  };
}

// ---------- D9 consent friction (MEASURE, not assume) ----------

function graphSha(snap: L0Snap): string | null {
  return snap.graph?.sha256 ?? null;
}

export function dimD9ConsentFriction(rows: TurnRow[], snaps: L0Snap[]): DimResult {
  const editRows = rows.filter((r) => r.editIntent && !r.skipped);
  if (editRows.length === 0) {
    return {
      dim: 'D9-consent-friction',
      verdict: 'log',
      flaky: false,
      details: { editIntents: 0 },
      notes: ['no edit-intent turns in this journey'],
    };
  }
  if (!snaps || snaps.length === 0 || snaps.every((s) => s.__error)) {
    return {
      dim: 'D9-consent-friction',
      verdict: 'unmeasurable',
      flaky: false,
      details: { reason: 'no L0 snapshots captured (run with --l0)' },
      notes: ['applied-in-DB timing needs the L0 graph sha series — never reported green without it'],
    };
  }
  const consentTurns = rows.filter((r) => r.onlyIf === 'consent_requested' && !r.skipped).map((r) => r.turn);
  const skippedConsent = rows.filter((r) => r.onlyIf === 'consent_requested' && r.skipped).map((r) => r.turn);
  const ordered = [...snaps].sort((a, b) => a.captured_at.localeCompare(b.captured_at));
  const perEdit = editRows.map((edit) => {
    if (!edit.startedAt) return { turn: edit.turn, applied: null, frictionSeconds: null };
    const before = ordered.filter((s) => s.captured_at <= edit.startedAt!);
    const baselineSha = before.length > 0 ? graphSha(before[before.length - 1]) : null;
    const after = ordered.filter((s) => s.captured_at > edit.startedAt!);
    const appliedSnap = after.find((s) => graphSha(s) != null && graphSha(s) !== baselineSha) ?? null;
    return {
      turn: edit.turn,
      applied: appliedSnap ? appliedSnap.label : null,
      frictionSeconds: appliedSnap
        ? Number(((Date.parse(appliedSnap.captured_at) - Date.parse(edit.startedAt!)) / 1000).toFixed(1))
        : null,
    };
  });
  return {
    dim: 'D9-consent-friction',
    verdict: 'log',
    flaky: false,
    details: { consentTurnsRun: consentTurns, consentTurnsSkipped: skippedConsent, perEdit },
    notes: [
      'MEASURES consent turns + edit-intent -> applied-in-DB seconds (turn-boundary granularity via L0 graph sha)',
      'LOG mode on purpose: the in-flight tunable-auto-apply lane changes consent counts — no pass/fail assumption',
      'applied=null means the graph sha never changed after the edit intent — the edit did NOT land in DB',
    ],
  };
}

// ---------- D10-api re-click safety ----------

function factsOf(snap: L0Snap | undefined): L0HandlerFact[] {
  const f = snap?.handler_facts;
  return Array.isArray(f) ? f : [];
}

export function dimD10ReclickSafety(rows: TurnRow[], snaps: L0Snap[]): DimResult {
  const dupRow = rows.find((r) => r.duplicateOf != null);
  const primary = dupRow ? rows.find((r) => r.turn === dupRow.duplicateOf) : undefined;
  if (!dupRow || !primary) {
    return {
      dim: 'D10-reclick-safety',
      verdict: 'unmeasurable',
      flaky: false,
      details: { reason: 'journey has no concurrent_duplicate turn' },
      notes: [],
    };
  }
  if (!snaps || snaps.length === 0 || snaps.every((s) => s.__error) || !primary.startedAt) {
    return {
      dim: 'D10-reclick-safety',
      verdict: 'unmeasurable',
      flaky: false,
      details: { reason: 'no L0 snapshots captured (run with --l0)' },
      notes: ['fact-commit-set diffing needs L0 — never reported green without it'],
    };
  }
  const ordered = [...snaps].sort((a, b) => a.captured_at.localeCompare(b.captured_at));
  const before = ordered.filter((s) => s.captured_at <= primary.startedAt!);
  const after = ordered.filter((s) => s.captured_at > primary.startedAt!);
  const beforeSnap = before[before.length - 1];
  const afterSnap = after[0];
  if (!beforeSnap || !afterSnap) {
    return {
      dim: 'D10-reclick-safety',
      verdict: 'unmeasurable',
      flaky: false,
      details: { reason: 'no L0 snapshot on both sides of the duplicate turn' },
      notes: [],
    };
  }
  const beforeKeys = new Set(factsOf(beforeSnap).map((f) => `${f.v5_conversation_turn_id}|${f.payload_sha256}`));
  const newFacts = factsOf(afterSnap).filter(
    (f) => !beforeKeys.has(`${f.v5_conversation_turn_id}|${f.payload_sha256}`),
  );
  // Double-commit signature #1: the SAME fact content (fact_type + payload sha)
  // committed 2+ times among the new facts. l0-snapshot.mjs hashes the payload
  // with VOLATILE fields (computed_at, request ids…) stripped (C9), so a true
  // double execution matches even when per-request timestamps differ.
  const byContent = new Map<string, number>();
  for (const f of newFacts) {
    const key = `${f.fact_type}|${f.payload_sha256}`;
    byContent.set(key, (byContent.get(key) ?? 0) + 1);
  }
  const doubleCommits = [...byContent.entries()].filter(([, n]) => n >= 2);
  // Double-commit signature #2 (C9 count assertion): the duplicate window must
  // commit at most ONE new semantic ANALYSIS fact — 2+ analysis-class commits
  // is a double execution even when residual volatile/nondeterministic payload
  // fields make the shas differ (older snapshots, unnormalised fields).
  const analysisFacts = newFacts.filter((f) => /analysis/i.test(`${f.fact_type ?? ''} ${f.action_type ?? ''}`));
  const analysisFactCount = analysisFacts.length;
  const failed = doubleCommits.length > 0 || analysisFactCount >= 2;
  return {
    dim: 'D10-reclick-safety',
    verdict: failed ? 'fail' : 'pass',
    flaky: false,
    details: {
      dupTurn: dupRow.turn,
      primaryTurn: primary.turn,
      dupHttpStatus: dupRow.httpStatus,
      newFactCount: newFacts.length,
      newFactTypes: newFacts.map((f) => f.fact_type),
      analysisFactCount,
      doubleCommits: doubleCommits.map(([k, n]) => ({ content: k, commits: n })),
    },
    notes: [
      'fail = identical (fact_type, volatile-normalised payload_sha256) committed 2+ times across the duplicate window (L0 diff), OR 2+ new ANALYSIS-class facts in the window (count assertion — sha-divergent double executions cannot evade)',
      'CEE #430 client-abort reclassification landed at this base — this dim MEASURES the current behaviour',
    ],
  };
}

// ---------- D11 production-guard aggregation ----------

export function dimD11ProductionGuards(rows: TurnRow[]): DimResult {
  const scored = activeRows(rows).filter((r) => r.guardHits != null);
  if (scored.length === 0) {
    return {
      dim: 'D11-production-guards',
      verdict: 'unmeasurable',
      flaky: false,
      details: { reason: 'rows carry no guardHits (score-run.ts computes them via the src/ guard imports)' },
      notes: [],
    };
  }
  // C10: aggregate the turn-class + L0-outcome CONDITIONED view — a legitimate
  // applied-edit receipt ("I've set X to 40%" after the L0 diff proves the
  // commit) is not a violation. Raw hits stay on the row; excusals disclosed.
  const views = scored.map((r) => ({ turn: r.turn, v: guardViolations(r)! }));
  const hits = views
    .map(({ turn, v }) => ({
      turn,
      forbidden: v.forbidden,
      successClaim: v.successClaim,
      heldScience: v.heldScience,
      mutationLanguage: v.mutationLanguage,
      structuralSuccessClaim: v.structuralSuccessClaim,
    }))
    .filter(
      (h) => h.forbidden || h.successClaim || h.heldScience || h.mutationLanguage || h.structuralSuccessClaim,
    );
  const excused = views.filter(({ v }) => v.excused.length > 0).map(({ turn, v }) => ({ turn, excused: v.excused }));
  return {
    dim: 'D11-production-guards',
    verdict: hits.length > 0 ? 'fail' : 'pass',
    flaky: false,
    details: { turnsScored: scored.length, hits, excusedReceipts: excused },
    notes: [
      'guards are the PRODUCTION modules imported from src/ (forbidden phrases, success claims, held-science vocabulary, mutation language, structural success claims)',
      'mutation-language / structural-success-claim hits are CONDITIONED on turn class + the L0 mutation oracle (C10): an applied-edit receipt with a proven commit is excused (details.excusedReceipts), a claim with NO commit still fails',
    ],
  };
}

// ---------- orchestration + rerun aggregation ----------

export function runAllDims(rows: TurnRow[], snaps: L0Snap[]): DimResult[] {
  return [
    dimD1ChipNoRepeat(rows),
    dimD2ChipPresence(rows),
    dimD3QuestionBudget(rows),
    dimD4Brevity(rows),
    dimD8Latency(rows),
    dimD9ConsentFriction(rows, snaps),
    dimD10ReclickSafety(rows, snaps),
    dimD11ProductionGuards(rows),
  ];
}

/** Majority verdict per FLAKY dim across N reruns (N=3 recommended); non-flaky
 * dims keep the first run's verdict and note the rerun spread. */
export function aggregateFlakyDims(perRun: DimResult[][]): DimResult[] {
  if (perRun.length === 0) return [];
  const first = perRun[0];
  return first.map((dimFirst) => {
    const across = perRun.map((run) => run.find((d) => d.dim === dimFirst.dim)).filter((d): d is DimResult => d != null);
    const verdicts = across.map((d) => d.verdict);
    if (!dimFirst.flaky) {
      return { ...dimFirst, notes: [...dimFirst.notes, `rerun spread: [${verdicts.join(', ')}]`] };
    }
    const counts = new Map<DimVerdict, number>();
    for (const v of verdicts) counts.set(v, (counts.get(v) ?? 0) + 1);
    const majority = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    return {
      ...dimFirst,
      verdict: majority,
      notes: [...dimFirst.notes, `flaky-dim majority over ${verdicts.length} runs: [${verdicts.join(', ')}] -> ${majority}`],
    };
  });
}
