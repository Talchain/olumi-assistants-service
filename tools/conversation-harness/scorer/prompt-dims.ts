/**
 * Prompt-quality dims (conversation-harness — ROADMAP 1.70 v1).
 *
 * Where the v0 dims (dims.ts) answer "does this RUN pass?", these answer "is
 * prompt A better than prompt B?". Each dim yields a COMPARABLE scalar with a
 * direction, so an A/B verdict (ab-verdict.ts) can diff a baseline run against a
 * candidate run per dim. Same discipline as v0: property-based, NEVER exact-text.
 *
 * PURE — no src/ imports, no I/O. Production-guard signals (PQ5, PQ6) are read
 * off `TurnRow.guardHits`, which score-run.ts computes via the REAL guard
 * modules imported from src/ (never copied). So this file stays unit-testable
 * on fixture rows without the service module graph, exactly like dims.ts.
 *
 * Direction / gating vocabulary (drives the overall A/B call in ab-verdict.ts):
 *   higher-better / lower-better / neutral — comparison direction
 *   gating = true  — a regression here caps the overall verdict at worse/mixed
 *                    (guard-cleanliness and coherence are non-negotiable)
 *   flaky  = true  — LLM-composition dependent → aggregate by MEDIAN over N>=3
 *                    reruns per side (see ab-verdict.ts), not a single run
 *   value  = null  — the dim was not measurable in this run (e.g. no coach turn,
 *                    or rows carry no guardHits) → excluded from the A/B call,
 *                    never silently treated as 0/"good"
 */
import {
  type TurnRow,
  chipSet,
  jaccard,
  classifyQuestion,
} from './dims.js';

export type PromptDimDirection = 'higher-better' | 'lower-better' | 'neutral';

export interface PromptDimScore {
  dim: string;
  label: string;
  direction: PromptDimDirection;
  gating: boolean;
  flaky: boolean;
  value: number | null;
  unit: string;
  details: Record<string, unknown>;
  notes: string[];
}

/** Cross-surface signals lifted off a wire envelope for the coherence dim.
 * Kept separate from TurnRow so the v0 dims are untouched; score-run.ts builds
 * the per-turn map from the same wires it already loads. */
export interface TurnSurfaces {
  hasHeldProposal: boolean;
  winProbabilities: Record<string, number> | null; // option label -> win probability
  leadingOptionLabel: string | null;
  optionLabels: string[];
}

export function surfacesFromWire(wire: unknown): TurnSurfaces {
  const w = (wire ?? {}) as Record<string, unknown>;
  const blocks = Array.isArray(w.blocks) ? (w.blocks as Record<string, unknown>[]) : [];
  const analysis = blocks.find((b) => b?.type === 'analysis_result') ?? null;
  const winProbabilities =
    analysis && typeof analysis.win_probabilities === 'object' && analysis.win_probabilities !== null
      ? (analysis.win_probabilities as Record<string, number>)
      : null;
  // Leading option: prefer the block's stated leading_option_id resolved to a
  // label via option_comparison; fall back to argmax of win_probabilities.
  let leadingOptionLabel: string | null = null;
  const optionLabels: string[] = [];
  const comparison = analysis && Array.isArray(analysis.enrichment)
    ? []
    : ((analysis?.enrichment as Record<string, unknown> | undefined)?.option_comparison as
        | Record<string, unknown>[]
        | undefined) ?? [];
  for (const opt of comparison) {
    const label = String(opt?.label ?? opt?.option_label ?? '');
    if (label) optionLabels.push(label);
    if (analysis?.leading_option_id != null && opt?.id === analysis.leading_option_id) {
      leadingOptionLabel = label || leadingOptionLabel;
    }
  }
  if (leadingOptionLabel == null && winProbabilities) {
    const entries = Object.entries(winProbabilities);
    if (entries.length > 0) {
      leadingOptionLabel = entries.sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))[0][0];
    }
    for (const k of Object.keys(winProbabilities)) if (!optionLabels.includes(k)) optionLabels.push(k);
  }
  return {
    hasHeldProposal: w.held_proposal != null && w.held_proposal !== false,
    winProbabilities,
    leadingOptionLabel,
    optionLabels,
  };
}

// ---------- text metric helpers (local heuristics — NOT production guards) ----------

const GENERIC_MARKERS = [
  /\bconsider your assumptions\b/i,
  /\bevaluate the risks\b/i,
  /\bit depends\b/i,
  /\bmany factors\b/i,
  /\bin general\b/i,
  /\bbest practice\b/i,
  /\bthere are (?:several|many|various) (?:factors|considerations|things)\b/i,
];

const LEAD_VERB = /\b(ahead|leads?|leading|wins?|winning|comes out (?:ahead|on top)|out in front|strongest|recommend(?:ed)?|best (?:option|choice)|favou?red)\b/i;

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function sentenceList(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function bulletLines(text: string): number {
  return text.split('\n').filter((l) => /^\s*[-*] /.test(l)).length;
}

function numbersCited(text: string): string[] {
  return text.match(/\b\d+(?:\.\d+)?%?|£[\d,]+/g) ?? [];
}

function labelsNamed(text: string, graphLabels: string[]): string[] {
  const lower = text.toLowerCase();
  return graphLabels.filter((l) => l.length > 2 && lower.includes(l.toLowerCase()));
}

function genericOnly(text: string, numbers: number, labels: number): boolean {
  return GENERIC_MARKERS.some((r) => r.test(text)) && numbers === 0 && labels === 0;
}

function activeRows(rows: TurnRow[]): TurnRow[] {
  return rows.filter((r) => !r.skipped && r.duplicateOf == null);
}

/** Coach-class turns; if no class hints exist (legacy runs), fall back to any
 * active turn with assistant text that is not a draft/edit/run_analysis turn. */
function coachRows(rows: TurnRow[]): TurnRow[] {
  const active = activeRows(rows);
  const explicit = active.filter((r) => (r.turnClassHint ?? '') === 'coach');
  if (explicit.length > 0) return explicit;
  return active.filter(
    (r) => r.assistantText.trim().length > 0 && !['draft', 'edit', 'run_analysis'].includes(r.turnClassHint ?? ''),
  );
}

function guardHitCount(row: TurnRow): number {
  const g = row.guardHits;
  if (!g) return 0;
  return (
    (g.forbidden ? 1 : 0) +
    (g.successClaim ? 1 : 0) +
    (g.heldScience ? 1 : 0) +
    (g.mutationLanguage ? 1 : 0) +
    (g.structuralSuccessClaim ? 1 : 0)
  );
}

const CONSENT_CHIP = /\b(apply|confirm|approve|go ahead|yes)\b/i;
function asksConsent(row: TurnRow, surfaces?: TurnSurfaces): boolean {
  if (surfaces?.hasHeldProposal) return true;
  return row.chips.some((c) => CONSENT_CHIP.test(`${c.id} ${c.label}`));
}

// ---------- PQ1 brevity / density (lower-better) ----------

export function pqBrevityDensity(rows: TurnRow[]): PromptDimScore {
  const coach = coachRows(rows);
  const perTurn = coach.map((r) => {
    const words = wordCount(r.assistantText);
    const sents = sentenceList(r.assistantText);
    const meanSentenceWords = sents.length ? Number((words / sents.length).toFixed(1)) : 0;
    return { turn: r.turn, words, sentences: sents.length, meanSentenceWords, bullets: bulletLines(r.assistantText) };
  });
  const meanWords = perTurn.length
    ? Number((perTurn.reduce((a, t) => a + t.words, 0) / perTurn.length).toFixed(1))
    : null;
  const meanSentenceWords = perTurn.length
    ? Number((perTurn.reduce((a, t) => a + t.meanSentenceWords, 0) / perTurn.length).toFixed(1))
    : null;
  const bulletTurns = perTurn.filter((t) => t.bullets > 0).length;
  return {
    dim: 'PQ1-brevity-density',
    label: 'Brevity / density (mean coach-turn words)',
    direction: 'lower-better',
    gating: false,
    flaky: true,
    value: meanWords,
    unit: 'words',
    details: { meanWords, meanSentenceWords, bulletTurnRatio: perTurn.length ? bulletTurns / perTurn.length : null, perTurn },
    notes: [
      'lower is tighter, but this is a comparison metric not a budget — a huge drop can mean the candidate went terse/unhelpful; read alongside PQ3 grounding',
    ],
  };
}

// ---------- PQ2 question-asking (neutral — reported, not scored) ----------

export function pqQuestionAsking(rows: TurnRow[]): PromptDimScore {
  const active = activeRows(rows);
  const coach = coachRows(rows);
  const perTurn = coach.map((r) => ({
    turn: r.turn,
    questions: (r.assistantText.match(/\?/g) ?? []).length,
    framing: classifyQuestion(r.assistantText),
  }));
  const meanQuestions = perTurn.length
    ? Number((perTurn.reduce((a, t) => a + t.questions, 0) / perTurn.length).toFixed(2))
    : null;
  // Post-draft framing: the first coach turn AFTER a draft turn asks a question.
  let postDraftFraming: boolean | null = null;
  const draftIdx = active.findIndex((r) => (r.turnClassHint ?? '') === 'draft');
  if (draftIdx >= 0) {
    const after = active.slice(draftIdx + 1).find((r) => r.assistantText.trim().length > 0);
    postDraftFraming = after ? (after.assistantText.match(/\?/g) ?? []).length > 0 : false;
  }
  return {
    dim: 'PQ2-question-asking',
    label: 'Question-asking (mean coach-turn ? + post-draft framing)',
    direction: 'neutral',
    gating: false,
    flaky: true,
    value: meanQuestions,
    unit: 'questions/turn',
    details: {
      meanQuestions,
      postDraftFraming,
      framingQuestionTurns: perTurn.filter((t) => t.framing.eitherOr || t.framing.enumerated).map((t) => t.turn),
      perTurn: perTurn.map((t) => ({ turn: t.turn, questions: t.questions, eitherOr: t.framing.eitherOr, enumerated: t.framing.enumerated })),
    },
    notes: [
      'NEUTRAL direction: more questions is good for a clarify prompt, bad for a terse coach — the A/B reports the delta, it does not score it good/bad',
      'postDraftFraming is null when the journey has no draft turn',
    ],
  };
}

// ---------- PQ3 grounding (higher-better) — coaching cites specifics not prose ----------

export function pqGrounding(rows: TurnRow[], graphLabels: string[]): PromptDimScore {
  const coach = coachRows(rows);
  const perTurn = coach.map((r) => {
    const numbers = numbersCited(r.assistantText);
    const labels = labelsNamed(r.assistantText, graphLabels);
    const grounded = (numbers.length >= 1 || labels.length >= 1) && !genericOnly(r.assistantText, numbers.length, labels.length);
    return { turn: r.turn, numbers: numbers.length, labels: labels.length, generic: genericOnly(r.assistantText, numbers.length, labels.length), grounded };
  });
  const groundedFrac = perTurn.length
    ? Number((perTurn.filter((t) => t.grounded).length / perTurn.length).toFixed(3))
    : null;
  return {
    dim: 'PQ3-grounding',
    label: 'Grounding (fraction of coach turns citing specific graph/analysis facts)',
    direction: 'higher-better',
    gating: false,
    flaky: true,
    value: groundedFrac,
    unit: 'fraction',
    details: { groundedFraction: groundedFrac, graphLabelCount: graphLabels.length, perTurn },
    notes: [
      'grounded turn = cites >=1 specific number OR names >=1 graph option/factor label, and is not dominated by a generic-advice marker',
      'reuses the v0 number-grounding direction — a coaching prompt that quotes the analysis beats one that emits generic prose',
    ],
  };
}

// ---------- PQ4 chip-correctness (higher-better) ----------

export function pqChipCorrectness(rows: TurnRow[], k = 3): PromptDimScore {
  const active = activeRows(rows);
  const qualifying = active
    .map((r) => ({ row: r, q: classifyQuestion(r.assistantText) }))
    .filter(({ q }) => q.eitherOr || q.enumerated);
  const perTurn = qualifying.map(({ row }) => ({ turn: row.turn, chips: row.chips.length, ok: row.chips.length >= 2 }));
  const presenceRate = qualifying.length ? Number((perTurn.filter((t) => t.ok).length / perTurn.length).toFixed(3)) : null;
  // Identical-repeat count (reuses the D1 direction): chip id+label set Jaccard==1
  // with a non-empty set within the previous K turns → a stale/looping chip set.
  let identicalRepeats = 0;
  for (let i = 0; i < active.length; i += 1) {
    const cur = chipSet(active[i]);
    if (cur.size === 0) continue;
    for (let j = Math.max(0, i - k); j < i; j += 1) {
      const prev = chipSet(active[j]);
      if (prev.size > 0 && jaccard(cur, prev) >= 1) {
        identicalRepeats += 1;
        break;
      }
    }
  }
  return {
    dim: 'PQ4-chip-correctness',
    label: 'Chip correctness (presence on question turns; identical-repeat penalty)',
    direction: 'higher-better',
    gating: false,
    flaky: true,
    value: presenceRate,
    unit: 'fraction',
    details: { chipPresenceRate: presenceRate, qualifyingTurns: perTurn, identicalRepeats },
    notes: [
      'value = fraction of either/or or enumerated-choice question turns whose SAME envelope carries >=2 suggested_actions',
      'identicalRepeats (lower is better) surfaces a candidate that loops the same chip set — reported in details, not folded into value',
      'null when the journey posed no qualifying question turns',
    ],
  };
}

// ---------- PQ5 production-guard cleanliness (lower-better, GATING) ----------

export function pqGuardCleanliness(rows: TurnRow[]): PromptDimScore {
  const active = activeRows(rows);
  const scored = active.filter((r) => r.guardHits != null);
  if (scored.length === 0) {
    return {
      dim: 'PQ5-guard-cleanliness',
      label: 'Production-guard cleanliness (imported src/ guards)',
      direction: 'lower-better',
      gating: true,
      flaky: false,
      value: null,
      unit: 'hits',
      details: { reason: 'rows carry no guardHits (score-run.ts computes them via the src/ guard imports)' },
      notes: ['UNMEASURABLE without guardHits — never treated as clean/0'],
    };
  }
  const hitsPerTurn = scored.map((r) => ({
    turn: r.turn,
    hits: guardHitCount(r),
    which: Object.entries({
      forbidden: r.guardHits!.forbidden,
      successClaim: r.guardHits!.successClaim,
      heldScience: r.guardHits!.heldScience,
      mutationLanguage: r.guardHits!.mutationLanguage,
      structuralSuccessClaim: r.guardHits!.structuralSuccessClaim,
    })
      .filter(([, v]) => v)
      .map(([k]) => k),
  }));
  const total = hitsPerTurn.reduce((a, t) => a + t.hits, 0);
  return {
    dim: 'PQ5-guard-cleanliness',
    label: 'Production-guard cleanliness (imported src/ guards)',
    direction: 'lower-better',
    gating: true,
    flaky: false,
    value: total,
    unit: 'hits',
    details: { totalHits: total, turnsScored: scored.length, perTurn: hitsPerTurn.filter((t) => t.hits > 0) },
    notes: [
      'GATING: a candidate that introduces ANY forbidden-phrase / success-claim / held-science / mutation-language / structural-success-claim hit cannot be graded "better"',
      'guards are the PRODUCTION modules imported from src/ — the hit signal is authoritative',
    ],
  };
}

// ---------- PQ6 coherence (lower-better, GATING) — no contradiction across surfaces ----------

export function pqCoherence(rows: TurnRow[], surfacesByTurn: Record<string, TurnSurfaces> = {}): PromptDimScore {
  const active = activeRows(rows);
  const contradictions: { turn: string; kind: string; detail: string }[] = [];
  for (const r of active) {
    const s = surfacesByTurn[r.turn];
    const g = r.guardHits;
    // (a) claims a structural change succeeded while a proposal is still HELD
    if (g?.structuralSuccessClaim && s?.hasHeldProposal) {
      contradictions.push({ turn: r.turn, kind: 'success-claim-with-held-proposal', detail: 'structural success claimed but held_proposal still present (change not applied)' });
    }
    // (b) uses mutation language ("I've set/updated…") while still asking consent
    if (g?.mutationLanguage && asksConsent(r, s)) {
      contradictions.push({ turn: r.turn, kind: 'mutation-claim-with-consent-request', detail: 'text claims the mutation happened but the turn still asks the user to apply/confirm' });
    }
    // (c) names a NON-leading option as the winner against the analysis blocks
    if (s?.leadingOptionLabel && s.optionLabels.length >= 2) {
      const leadSentences = sentenceList(r.assistantText).filter((sent) => LEAD_VERB.test(sent));
      for (const sent of leadSentences) {
        const lower = sent.toLowerCase();
        const mentioned = s.optionLabels.filter((l) => l.length > 2 && lower.includes(l.toLowerCase()));
        // Conservative: contradiction only when the lead sentence names exactly
        // one option and it is NOT the analysis' leading option.
        if (mentioned.length === 1 && mentioned[0].toLowerCase() !== s.leadingOptionLabel.toLowerCase()) {
          contradictions.push({ turn: r.turn, kind: 'win-claim-contradicts-blocks', detail: `text calls "${mentioned[0]}" ahead but blocks lead with "${s.leadingOptionLabel}"` });
        }
      }
    }
  }
  const measurable = active.some((r) => r.guardHits != null || surfacesByTurn[r.turn] != null);
  return {
    dim: 'PQ6-coherence',
    label: 'Coherence (no contradiction across text / chips / analysis blocks)',
    direction: 'lower-better',
    gating: true,
    flaky: true,
    value: measurable ? contradictions.length : null,
    unit: 'contradictions',
    details: { contradictions },
    notes: [
      'GATING: cross-surface contradictions are disqualifying — a candidate that says "done" while awaiting consent, or names the wrong winner, cannot be "better"',
      'property-based proxies only (held-proposal vs success-claim, consent-vs-mutation, lead-sentence vs blocks argmax); conservative to avoid false positives',
      measurable ? '' : 'UNMEASURABLE: rows carry neither guardHits nor wire surfaces',
    ].filter(Boolean),
  };
}

// ---------- orchestration ----------

export interface RunPromptDimsOpts {
  surfacesByTurn?: Record<string, TurnSurfaces>;
  graphLabels?: string[];
}

export function runPromptDims(rows: TurnRow[], opts: RunPromptDimsOpts = {}): PromptDimScore[] {
  const surfacesByTurn = opts.surfacesByTurn ?? {};
  // Union of caller-supplied labels + every option label seen on any surface, so
  // grounding recognises named options even on frozen (no-draft) journeys.
  const surfaceLabels = new Set<string>(opts.graphLabels ?? []);
  for (const s of Object.values(surfacesByTurn)) for (const l of s.optionLabels) surfaceLabels.add(l);
  const graphLabels = [...surfaceLabels];
  return [
    pqBrevityDensity(rows),
    pqQuestionAsking(rows),
    pqGrounding(rows, graphLabels),
    pqChipCorrectness(rows),
    pqGuardCleanliness(rows),
    pqCoherence(rows, surfacesByTurn),
  ];
}
