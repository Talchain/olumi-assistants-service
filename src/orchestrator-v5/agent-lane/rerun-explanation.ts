/**
 * ⭐ M2 — WHAT CHANGED BETWEEN TWO RUNS IS OLUMI'S OWN LINE, RENDERED FROM run_delta's TYPED ROWS; THE MODEL ONLY SAYS WHY
 * (RC contract `RERUN-EXPLANATION`, policy.ts; DL assignment to MG; lease #85 5939005849; DL ruling 5940472067: the
 * input-change claim is CODE-OWNED, MG mechanics 5940496939).
 *
 * The investor moment (R3 5938917543, final seed `eeeff8b4`): Accept Olumi's estimate → Run. No figure changes; the
 * comparison appears for the first time. Olumi's line says what the user did ("You accepted Olumi's estimate for how much
 * A changes B.") and, when the earlier Run held its figures back (`win_probabilities_unavailable: 'prior_withheld'`,
 * schemas 0.70.0), that THIS is what held the comparison back — never that anything rose or fell.
 *
 * Pure. Read from the TYPED run_delta only (never words; never an inference from an empty array):
 *   · the CODE LINE: rows → RC's `change_label_templates` with the graph's labels for the link's node ids (a `sizing` and a
 *     `strength` row on one link are ONE change; at most 3 named, the rest disclosed as "You also made N other changes.")
 *     + the case line; `complete` coverage with no rows → "Nothing you entered
 *     changed."; anything else → "Olumi can't say what changed between these two runs.";
 *   · the `MethodInputs` RC's `checkMethodTurn('RERUN-EXPLANATION')` judges on;
 *   · an instruction handing the model that line, told never to restate whether inputs changed.
 * The sent text is the code line, then the model's sentences that pass RC's checker beside it (a hit drops that sentence
 * only: the line above already carries the fact, so a false positive costs a sentence and a false negative can't
 * contradict the record). No delta (a first Run) → no plan, and the route's explanation is exactly what it was.
 */
import { checkMethodTurn, type MethodInputs } from './guidance/index.js';
import { POLICY } from './guidance/policy.js';

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | undefined => (v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Rec : undefined);
const text = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined);

/** The most changes named, as the contract's format allows. */
export const MAX_NAMED_CHANGES = 3;

/**
 * RC's `accept_olumi_estimate` sentence, rendered from the contract itself: the ONE sentence for an Accept, said by the
 * rerun's code line AND by the Accept's own receipt (`formatEdgeStrengthConfirmed`; DL ruling on R3 5942069984).
 */
export const acceptedOlumiEstimateSentence = (from: string, to: string): string =>
  POLICY.method_turns['RERUN-EXPLANATION'].change_label_templates.accept_olumi_estimate.label
    .replace(/\{(from|to)\}/gu, (_m, key: string) => (key === 'from' ? from : to));
/** RC's other change sentences (`change_label_templates`), verbatim. */
const acceptedEstimate = acceptedOlumiEstimateSentence;
const ownEstimate = (from: string, to: string) => `You gave your own estimate for how much ${from} changes ${to}.`;
const ownEstimateMoved = (from: string, to: string, before: string, after: string) =>
  `You gave your own estimate for how much ${from} changes ${to}: ${before} → ${after}.`;
const strengthMoved = (from: string, to: string, before: string, after: string) =>
  `You changed how much ${from} changes ${to}: ${before} → ${after}.`;

/** RC's fallback case lines (policy `fallback`); C3–C5 never say "a new draw" (it may be the engine that differed). */
export const RERUN_FALLBACK_LINES = {
  unwithheld: 'That was what held the comparison back, so Olumi can now compare the options.',
  // C2 = the draw is NOT shown equal: a recorded new draw OR an unrecorded draw structure (`build-run-delta.ts` classifier).
  // Only "can't confirm" is true of both (CODEX on 3d0891e2 P1; RC to mirror in policy `fallback`).
  C2: 'Olumi can’t confirm both runs used the same draw, so the difference can’t be put down to your edit alone.',
  other: 'Other things also differed between these two runs, so the difference can’t be put down to your edit alone.',
  /** Unknown, not observed (MG 5943403202; CODEX on b6e52dbc P1): partial coverage or an unattributed pair. */
  unverified: 'Olumi can’t confirm nothing else differed between these two runs, so the difference can’t be put down to your edit alone.',
  C1: 'The comparison was rerun on the same draw.',
  C0: 'Nothing else changed.',
} as const;

/** Olumi's line when no change row can be named: the record says nothing changed, or it can't say. */
export const RERUN_NO_CHANGE_LINES = {
  nothing: 'Nothing you entered changed.',
  unknown: 'Olumi can’t say what changed between these two runs.',
  unwithheld: 'Olumi can now compare the options.',
} as const;

export interface RerunExplanationPlan {
  /** What RC's check judges the reply on. */
  readonly inputs: MethodInputs;
  /** The change sentences, in the producer's order, at most `MAX_NAMED_CHANGES`. */
  readonly changes: readonly string[];
  /** Olumi's own line from the typed rows: what changed (or that nothing the user entered did, or that it can't say). */
  readonly codeLine: string;
  /** Appended to the explanation request's instructions. */
  readonly instruction: string;
  /** Said when the model gives nothing usable: the code line alone. */
  readonly fallback: string;
}

const value = (v: unknown): string | undefined => {
  const r = rec(v);
  if (r === undefined) return undefined;
  const raw = r.raw;
  const shown = typeof raw === 'number' || typeof raw === 'boolean' ? String(raw) : text(raw);
  if (shown === undefined) return undefined;
  const unit = text(r.unit);
  return unit === undefined ? shown : `${shown} ${unit}`;
};

/**
 * The change sentences: one per link (its sizing + strength rows together), one per other row. `skipped` counts rows no
 * template can name (unknown link ends, a link `presence` row, a row with no label): those changes happened but go unsaid,
 * so the line never says "Nothing else changed" beside them (Codex pre-review e1c7c788 P2).
 */
function changeSentences(rows: readonly Rec[], labelOf: (id: string) => string | undefined): { sentences: string[]; skipped: number } {
  let skipped = 0;
  const out: string[] = [];
  const links = new Map<string, { from: string; to: string; sizing?: Rec; strength?: Rec }>();
  for (const row of rows) {
    const link = rec(row.link);
    if (row.entity_kind === 'link' && link !== undefined && (row.field === 'sizing' || row.field === 'strength')) {
      const from = labelOf(String(link.from)); const to = labelOf(String(link.to));
      if (from === undefined || to === undefined) { skipped += 1; continue; }
      const key = `${String(link.from)}->${String(link.to)}`;
      const at = links.get(key) ?? { from, to };
      if (!links.has(key)) { links.set(key, at); out.push(key); }
      if (row.field === 'sizing') at.sizing = row; else at.strength = row;
      continue;
    }
    const label = text(row.label_after) ?? text(row.label_before);
    const before = value(row.before); const after = value(row.after);
    if (label === undefined) { skipped += 1; continue; }
    out.push(before !== undefined && after !== undefined ? `You changed ${label}: ${before} → ${after}.` : `You changed ${label}.`);
  }
  const sentences = out.map((s) => {
    const l = links.get(s);
    if (l === undefined) return s;
    const sizedTo = text(rec(l.sizing?.after)?.raw);
    const band = l.strength !== undefined ? { before: value(l.strength.before), after: value(l.strength.after) } : undefined;
    if (sizedTo === 'user') {
      return band?.before !== undefined && band.after !== undefined ? ownEstimateMoved(l.from, l.to, band.before, band.after) : ownEstimate(l.from, l.to);
    }
    if (sizedTo === 'olumi_accepted') {
      // ⛔ The Accept is never folded away (buddy draft CR 5939351197): with a band move on the same link it is still said.
      return band?.before !== undefined && band.after !== undefined
        ? `You accepted Olumi's estimate for how much ${l.from} changes ${l.to}: ${band.before} → ${band.after}.` : acceptedEstimate(l.from, l.to);
    }
    if (band?.before !== undefined && band.after !== undefined) return strengthMoved(l.from, l.to, band.before, band.after);
    skipped += 1;
    return undefined;
  }).filter((s): s is string => s !== undefined);
  return { sentences, skipped };
}

/** Recorded changes past the cap are disclosed, never dropped from the record (CODEX CEE BUDDY CR 5940970957). */
const moreChangesLine = (n: number) => `You also made ${n} other change${n === 1 ? '' : 's'}.`;

type CheckCase = 'C0_identical' | 'C1_attributable' | 'C2_unpaired';
/** The wire case → the check's three (C3–C5 are not attributable: judged as C2, said with their own fallback line). */
const checkCase = (c: unknown): CheckCase => (c === 'C0_identical' || c === 'C1_attributable' ? c : 'C2_unpaired');

/**
 * The plan for a RERUN's explanation, or `null` when there is no delta (a first Run).
 * `labelOf`: a node id → its label in the graph the Run used; `optionLabels`: the current options' labels;
 * `modelLabels`: EVERY node label, masked before RC's text bans run (#2478/#2485: a label like "Qualified leads per month"
 * must never read as the reply saying an option "leads").
 */
export function rerunExplanationPlan(
  runDelta: unknown,
  labelOf: (id: string) => string | undefined,
  optionLabels: readonly string[],
  leaderLicensed: boolean,
  modelLabels: readonly string[] = [],
): RerunExplanationPlan | null {
  const d = rec(runDelta);
  if (d === undefined) return null;
  const rows = Array.isArray(d.input_changes) ? d.input_changes.map(rec).filter((r): r is Rec => r !== undefined) : [];
  const { sentences, skipped } = changeSentences(rows, labelOf);
  const changes = sentences.slice(0, MAX_NAMED_CHANGES);
  const more = sentences.length - changes.length;
  // ⛔ Partial or unrecorded coverage never licenses "same inputs" or a cause (CODEX CEE BUDDY preflight 5939219187): other
  // inputs may have differed unseen, so the pair is judged as unpaired. A recorded change no template can name is the same
  // for the check: it differed, unsaid.
  // ⛔ WHAT IS SAID tells OBSERVED from UNKNOWN (CODEX on b6e52dbc P1; MG 5943403202): "Other things also differed" only
  // where a difference is RECORDED (an unnamed recorded row; engine drift C3; sample-budget drift C4). `partial` means
  // "can't verify every sent input was the same" (an end may simply predate the residual), and C5 is unattributed: both
  // say "Olumi can't confirm nothing else differed".
  const coverageComplete = d.input_coverage === 'complete' && skipped === 0;
  const differenceUnknown = skipped === 0
    && (d.input_coverage !== 'complete' || d.attribution_case === 'C5_unattributed');
  const wireCase = coverageComplete ? d.attribution_case : 'coverage_incomplete';
  const priorWithheld = d.win_probabilities_unavailable === 'prior_withheld';
  const noMatched = !priorWithheld && Array.isArray(d.win_probabilities) && d.win_probabilities.length === 0;
  const noise = text(rec(d.leader)?.noise_verdict);
  const inputs: MethodInputs = {
    change_labels: changes,
    changes_recorded: rows.length,
    attribution_case: checkCase(wireCase),
    leader_licensed: leaderLicensed,
    ...(noise !== undefined ? { noise_verdict: noise } : {}),
    prior_withheld: priorWithheld,
    no_matched_figures: noMatched,
    current_option_labels: optionLabels,
    model_labels: modelLabels,
  };
  // "Nothing you entered changed" ONLY on a typed, complete, empty record; rows the graph can't name → "can't say".
  const recordedNothing = coverageComplete && Array.isArray(d.input_changes) && rows.length === 0;
  // ⛔ "That was what held the comparison back" credits the user's change, so it rides ONLY a C1 pair (complete coverage,
  // same draw and builds: the named changes are the only differences). Any other case can owe the comparison to
  // something else (an engine that now evaluates what it withheld, a new draw, an unrecorded input), so the line is
  // the neutral "Olumi can now compare the options." followed by the case line (CODEX on CEE 864e915c, P1).
  const caseLine = wireCase === 'C0_identical' ? RERUN_FALLBACK_LINES.C0
    : wireCase === 'C1_attributable' ? RERUN_FALLBACK_LINES.C1
      : wireCase === 'C2_unpaired' ? RERUN_FALLBACK_LINES.C2
        : differenceUnknown ? RERUN_FALLBACK_LINES.unverified : RERUN_FALLBACK_LINES.other;
  const codeLine = changes.length > 0
    ? `${changes.join(' ')}${more > 0 ? ` ${moreChangesLine(more)}` : ''} ${!priorWithheld ? caseLine
      : wireCase === 'C1_attributable' ? RERUN_FALLBACK_LINES.unwithheld
        : `${RERUN_NO_CHANGE_LINES.unwithheld} ${caseLine}`}`
    : `${recordedNothing ? RERUN_NO_CHANGE_LINES.nothing : RERUN_NO_CHANGE_LINES.unknown}${priorWithheld ? ` ${RERUN_NO_CHANGE_LINES.unwithheld}` : ''}`;
  const instruction = [
    'Olumi has already told the user, in its own words from the run record, what changed between the two Runs:',
    `"${codeLine}"`,
    'Do not repeat that line, and never say whether the inputs changed or stayed the same: that line is the record. Say what this Run shows.',
    priorWithheld
      ? 'The earlier Run held its comparison figures back, so never say anything rose, fell, moved or changed in value.'
      : noMatched
        ? 'No option has figures in both Runs, so never say anything rose, fell or moved; say only what this Run shows.'
        : inputs.attribution_case === 'C1_attributable'
          ? 'You may say what moved in the comparison.'
          // Each premise is TRUE of its case (CODEX on 3d0891e2 P1): C0 + complete proves identity; C2 leaves the draw unshown.
          : wireCase === 'C0_identical'
            ? 'Nothing differed between the two Runs, so never say anything moved because of a change.'
            : differenceUnknown
              ? 'Olumi can’t confirm nothing else differed between the two Runs, so never say the change caused the difference.'
              : wireCase === 'C2_unpaired'
                ? 'Olumi can’t confirm both Runs used the same draw, so never say the change caused the difference.'
                : 'Other things also differed between the two Runs, so never say the change caused the difference.',
  ].join('\n');
  return { inputs, changes, codeLine, instruction, fallback: codeLine };
}

/**
 * The plan from ONE graph read: its node labels name the change rows, its options' labels (plus the read's display
 * aliases) are the option labels, and every node label is masked before the bans. The post-rerun explanation and the
 * ordinary turn's `comparison` block (`comparison-answer.ts`) build it this one way, so both say the same code line.
 */
export function rerunPlanForGraph(
  runDelta: unknown,
  graph: unknown,
  leaderLicensed: boolean,
  optionDisplays: readonly string[] = [],
): RerunExplanationPlan | null {
  const nodes = Array.isArray((graph as { nodes?: unknown } | null)?.nodes)
    ? (graph as { nodes: { id?: unknown; kind?: unknown; label?: unknown }[] }).nodes : [];
  return rerunExplanationPlan(runDelta,
    (id) => { const n = nodes.find((x) => x.id === id); return typeof n?.label === 'string' ? n.label : undefined; },
    [...new Set([...nodes.filter((n) => n.kind === 'option' && typeof n.label === 'string').map((n) => n.label as string),
      ...optionDisplays])],
    leaderLicensed,
    nodes.map((n) => n.label).filter((l): l is string => typeof l === 'string' && l.trim() !== ''));
}

const SENTENCE_BREAK = /(?<=[.!?])\s+/u;
const normal = (t: string) => t.replace(/[‘’]/gu, "'").replace(/\s+/gu, ' ').trim().toLowerCase();

/**
 * The text as sent: Olumi's code line, then each model sentence that passes RC's ONE checker beside it (checked as
 * `code line + sentence`, so a hit is that sentence's own). A failing sentence is dropped, never the record; a sentence
 * that only repeats the code line is dropped too. Nothing left → the code line alone.
 */
export function composeRerunExplanation(reply: string, plan: RerunExplanationPlan): {
  readonly text: string; readonly dropped: readonly string[]; readonly failed: readonly string[];
} {
  const dropped: string[] = [];
  const failed = new Set<string>();
  const own = normal(plan.codeLine);
  const kept = reply.split(/\r?\n/u).map((line) => line.split(SENTENCE_BREAK).filter((sentence) => {
    if (sentence.trim() === '' || own.includes(normal(sentence))) return false;
    const verdict = checkMethodTurn('RERUN-EXPLANATION', `${plan.codeLine}\n${sentence}`, plan.inputs);
    if (verdict.failed.length === 0) return true;
    dropped.push(sentence);
    for (const id of verdict.failed) failed.add(id);
    return false;
  }).join(' ')).filter((line) => line.trim() !== '').join('\n').trim();
  return { text: kept === '' ? plan.codeLine : `${plan.codeLine}\n\n${kept}`, dropped, failed: [...failed] };
}

/**
 * The typed provisional view (C5b) is the model's words too (Codex pre-review e1c7c788 P1: "Its chance rose from 40% to
 * 57%." rode `provisional_view.reasoning` past the check). Each field passes the same bans beside the code line, except the
 * leader ban: the view IS the labelled provisional leaning the withheld standing permits. Any other hit → not shown.
 */
export function rerunViewFailures(view: object, plan: RerunExplanationPlan): string[] {
  const failed = new Set<string>();
  for (const field of Object.values(view as Record<string, unknown>)) {
    if (typeof field !== 'string' || field.trim() === '') continue;
    for (const id of checkMethodTurn('RERUN-EXPLANATION', `${plan.codeLine}\n${field}`, plan.inputs).failed) {
      if (id !== 'RX-NO-LEADER-UNLICENSED') failed.add(id);
    }
  }
  return [...failed];
}
