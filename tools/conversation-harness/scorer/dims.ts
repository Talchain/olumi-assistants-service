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
      return { id: String(chip.id ?? ''), label: String(chip.label ?? '') };
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
  const perTurn: { turn: string; maxSimilarity: number; repeatOf: string | null }[] = [];
  for (let i = 0; i < active.length; i += 1) {
    const cur = chipSet(active[i]);
    if (cur.size === 0) {
      perTurn.push({ turn: active[i].turn, maxSimilarity: 0, repeatOf: null });
      continue;
    }
    let max = 0;
    let repeatOf: string | null = null;
    for (let j = Math.max(0, i - k); j < i; j += 1) {
      const prev = chipSet(active[j]);
      if (prev.size === 0) continue;
      const sim = jaccard(cur, prev);
      if (sim > max) {
        max = sim;
        repeatOf = active[j].turn;
      }
    }
    perTurn.push({ turn: active[i].turn, maxSimilarity: Number(max.toFixed(3)), repeatOf: max >= 1 ? repeatOf : null });
  }
  const identicalRepeats = perTurn.filter((t) => t.maxSimilarity >= 1);
  return {
    dim: 'D1-chip-no-repeat',
    verdict: identicalRepeats.length >= 2 ? 'fail' : 'pass',
    flaky: true,
    details: { k, perTurn, identicalRepeats: identicalRepeats.map((t) => t.turn) },
    notes: [
      'fail = 2+ turns whose chip id+label set is IDENTICAL (Jaccard 1.0) to a non-empty set within the previous K turns',
      'base includes the 1.16j post-analysis chip-sameness fix — this dim verifies it holds in conversation',
    ],
  };
}

// ---------- D2 chip-presence-per-question-class ----------

export function dimD2ChipPresence(rows: TurnRow[]): DimResult {
  const qualifying = activeRows(rows)
    .map((r) => ({ row: r, q: classifyQuestion(r.assistantText) }))
    .filter(({ q }) => q.eitherOr || q.enumerated);
  const perTurn = qualifying.map(({ row, q }) => {
    const chipTokens = new Set(
      row.chips.flatMap((c) => c.label.toLowerCase().split(/\W+/).filter((t) => t.length > 3)),
    );
    const questionTokens = q.sentences
      .join(' ')
      .toLowerCase()
      .split(/\W+/)
      .filter((t) => t.length > 3);
    const overlap = questionTokens.filter((t) => chipTokens.has(t)).length;
    return {
      turn: row.turn,
      class: q.eitherOr ? 'either-or' : 'enumerated',
      chipCount: row.chips.length,
      ok: row.chips.length >= 2,
      labelOverlapTokens: overlap,
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
      'fail = a qualifying turn whose SAME envelope carries <2 suggested_actions; label-token overlap is advisory',
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
  // Double-commit signature: the SAME fact content (fact_type + payload sha)
  // committed 2+ times among the new facts. On a frozen graph a true double
  // execution is payload-sha identical (deterministic analysis).
  const byContent = new Map<string, number>();
  for (const f of newFacts) {
    const key = `${f.fact_type}|${f.payload_sha256}`;
    byContent.set(key, (byContent.get(key) ?? 0) + 1);
  }
  const doubleCommits = [...byContent.entries()].filter(([, n]) => n >= 2);
  return {
    dim: 'D10-reclick-safety',
    verdict: doubleCommits.length > 0 ? 'fail' : 'pass',
    flaky: false,
    details: {
      dupTurn: dupRow.turn,
      primaryTurn: primary.turn,
      dupHttpStatus: dupRow.httpStatus,
      newFactCount: newFacts.length,
      newFactTypes: newFacts.map((f) => f.fact_type),
      doubleCommits: doubleCommits.map(([k, n]) => ({ content: k, commits: n })),
    },
    notes: [
      'fail = identical (fact_type, payload_sha256) committed 2+ times across the duplicate window (L0 diff)',
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
  const hits = scored
    .map((r) => ({
      turn: r.turn,
      forbidden: r.guardHits!.forbidden,
      successClaim: r.guardHits!.successClaim,
      heldScience: r.guardHits!.heldScience,
      mutationLanguage: r.guardHits!.mutationLanguage,
      structuralSuccessClaim: r.guardHits!.structuralSuccessClaim,
    }))
    .filter(
      (h) => h.forbidden || h.successClaim || h.heldScience || h.mutationLanguage || h.structuralSuccessClaim,
    );
  return {
    dim: 'D11-production-guards',
    verdict: hits.length > 0 ? 'fail' : 'pass',
    flaky: false,
    details: { turnsScored: scored.length, hits },
    notes: ['guards are the PRODUCTION modules imported from src/ (forbidden phrases, success claims, held-science vocabulary, mutation language, structural success claims)'],
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
