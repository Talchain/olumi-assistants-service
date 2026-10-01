/**
 * ⭐ M2 — THE RERUN'S EXPLANATION NAMES WHAT THE USER CHANGED, FROM run_delta's TYPED ROWS, AND NEVER CLAIMS A MOVEMENT
 * THE PAIR CANNOT SHOW (RC contract `RERUN-EXPLANATION` @a00cb9c8, policy.ts; DL assignment to MG; lease #85 5939005849).
 *
 * The investor moment (R3 5938917543, final seed `eeeff8b4`): Accept Olumi's estimate → Run. No figure changes; the
 * comparison appears for the first time. The explanation must say what the user did ("You accepted Olumi's estimate for
 * how much A changes B.") and, when the earlier Run held its figures back (`win_probabilities_unavailable:
 * 'prior_withheld'`, schemas 0.70.0), that THIS is what held the comparison back — never that anything rose or fell.
 *
 * Pure. Read from the TYPED run_delta only (never words; never an inference from an empty array):
 *   · the change sentences — RC's `change_label_templates`, rendered with the graph's labels for the link's node ids
 *     (a `sizing` and a `strength` row on one link are ONE change); a non-link row says its own label, before → after;
 *   · the `MethodInputs` RC's `checkMethodTurn('RERUN-EXPLANATION')` judges the reply on;
 *   · an instruction handing the model those exact sentences, and RC's deterministic fallback for a reply that fails.
 * The CHECK is the control; the instruction only makes a passing reply likely.
 *
 * Inert by construction: no run_delta, or no change rows (a pre-0.70 Accept pair carries none) → no plan, and the
 * route's explanation is exactly what it was.
 */
import { checkMethodTurn, type MethodInputs } from './guidance/index.js';

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | undefined => (v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Rec : undefined);
const text = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined);

/** The most changes named, as the contract's format allows. */
export const MAX_NAMED_CHANGES = 3;

/** RC's change sentences (`change_label_templates`), verbatim. */
const acceptedEstimate = (from: string, to: string) => `You accepted Olumi's estimate for how much ${from} changes ${to}.`;
const ownEstimate = (from: string, to: string) => `You gave your own estimate for how much ${from} changes ${to}.`;
const ownEstimateMoved = (from: string, to: string, before: string, after: string) =>
  `You gave your own estimate for how much ${from} changes ${to}: ${before} → ${after}.`;
const strengthMoved = (from: string, to: string, before: string, after: string) =>
  `You changed how much ${from} changes ${to}: ${before} → ${after}.`;

/** RC's fallback case lines (policy `fallback`); C3–C5 never say "a new draw" (it may be the engine that differed). */
export const RERUN_FALLBACK_LINES = {
  unwithheld: 'That was what held the comparison back, so Olumi can now compare the options.',
  C2: 'This run also used a new draw, so the difference can’t be put down to your edit alone.',
  other: 'Other things also differed between these two runs, so the difference can’t be put down to your edit alone.',
  C1: 'The comparison was rerun on the same draw.',
  C0: 'Nothing else changed.',
} as const;

export interface RerunExplanationPlan {
  /** What RC's check judges the reply on. */
  readonly inputs: MethodInputs;
  /** The change sentences, in the producer's order, at most `MAX_NAMED_CHANGES`. */
  readonly changes: readonly string[];
  /** Appended to the explanation request's instructions. */
  readonly instruction: string;
  /** RC's deterministic fallback, said when the reply fails the check. */
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

/** The change sentences: one per link (its sizing + strength rows together), one per other row. */
function changeSentences(rows: readonly Rec[], labelOf: (id: string) => string | undefined): string[] {
  const out: string[] = [];
  const links = new Map<string, { from: string; to: string; sizing?: Rec; strength?: Rec }>();
  for (const row of rows) {
    const link = rec(row.link);
    if (row.entity_kind === 'link' && link !== undefined && (row.field === 'sizing' || row.field === 'strength')) {
      const from = labelOf(String(link.from)); const to = labelOf(String(link.to));
      if (from === undefined || to === undefined) continue;
      const key = `${String(link.from)}->${String(link.to)}`;
      const at = links.get(key) ?? { from, to };
      if (!links.has(key)) { links.set(key, at); out.push(key); }
      if (row.field === 'sizing') at.sizing = row; else at.strength = row;
      continue;
    }
    const label = text(row.label_after) ?? text(row.label_before);
    const before = value(row.before); const after = value(row.after);
    if (label === undefined) continue;
    out.push(before !== undefined && after !== undefined ? `You changed ${label}: ${before} → ${after}.` : `You changed ${label}.`);
  }
  return out.map((s) => {
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
    return undefined;
  }).filter((s): s is string => s !== undefined).slice(0, MAX_NAMED_CHANGES);
}

type CheckCase = 'C0_identical' | 'C1_attributable' | 'C2_unpaired';
/** The wire case → the check's three (C3–C5 are not attributable: judged as C2, said with their own fallback line). */
const checkCase = (c: unknown): CheckCase => (c === 'C0_identical' || c === 'C1_attributable' ? c : 'C2_unpaired');

/**
 * The plan for a RERUN's explanation, or `null` when there is nothing typed to name (no delta, no change rows).
 * `labelOf`: a node id → its label in the graph the Run used; `optionLabels`: the current options' labels;
 * `modelLabels`: EVERY node label, masked before RC's text bans run (#2478: a label like "Qualified leads per month" must
 * never read as the reply saying an option "leads").
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
  const changes = changeSentences(rows, labelOf);
  if (changes.length === 0) return null;
  // ⛔ Partial or unrecorded coverage never licenses "same inputs" or a cause (CODEX CEE BUDDY preflight 5939219187): other
  // inputs may have differed unseen, so the pair is judged as unpaired and said as "other things also differed".
  const coverageComplete = d.input_coverage === 'complete';
  const wireCase = coverageComplete ? d.attribution_case : 'coverage_incomplete';
  const priorWithheld = d.win_probabilities_unavailable === 'prior_withheld';
  const noMatched = !priorWithheld && Array.isArray(d.win_probabilities) && d.win_probabilities.length === 0;
  const noise = text(rec(d.leader)?.noise_verdict);
  const inputs: MethodInputs = {
    change_labels: changes,
    attribution_case: checkCase(wireCase),
    leader_licensed: leaderLicensed,
    ...(noise !== undefined ? { noise_verdict: noise } : {}),
    prior_withheld: priorWithheld,
    no_matched_figures: noMatched,
    current_option_labels: optionLabels,
    model_labels: modelLabels,
  };
  const caseLine = priorWithheld ? RERUN_FALLBACK_LINES.unwithheld
    : wireCase === 'C0_identical' ? RERUN_FALLBACK_LINES.C0
      : wireCase === 'C1_attributable' ? RERUN_FALLBACK_LINES.C1
        : wireCase === 'C2_unpaired' ? RERUN_FALLBACK_LINES.C2 : RERUN_FALLBACK_LINES.other;
  const instruction = [
    'This Run follows the user’s change. Start by naming each change in exactly these words, one line each:',
    ...changes.map((c) => `- ${c}`),
    'Never say the inputs were the same or that nothing changed: the user changed what is named above.',
    priorWithheld
      ? `Then say: "${RERUN_FALLBACK_LINES.unwithheld}" The earlier Run had no figures, so never say anything rose, fell, moved or changed in value.`
      : noMatched
        ? 'No option has figures in both Runs, so never say anything rose, fell or moved; say only what this Run shows.'
        : inputs.attribution_case === 'C1_attributable'
          ? 'Then say what moved in the comparison.'
          : 'Other things also differed between the two Runs, so never say the change caused the difference.',
  ].join('\n');
  return { inputs, changes, instruction, fallback: `${changes.join(' ')} ${caseLine}` };
}

/** The reply as sent: the model's when it passes RC's ONE checker (incl. RX-UNWITHHELD-LINE, RX-NO-CONTRARY-SAME, #2483), else RC's fallback. */
export function guardRerunExplanation(reply: string, plan: RerunExplanationPlan): { readonly text: string; readonly passed: boolean; readonly failed: readonly string[] } {
  const verdict = checkMethodTurn('RERUN-EXPLANATION', reply, plan.inputs);
  return verdict.failed.length === 0 ? { text: reply, passed: true, failed: [] } : { text: plan.fallback, passed: false, failed: verdict.failed };
}
