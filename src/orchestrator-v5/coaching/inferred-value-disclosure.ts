/**
 * THE INFERRED-VALUE DISCLOSURE — the analysis says whose numbers it ran on.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE GAP, MEASURED ON DEPLOYED STAGING (23 Sep, scenario `e243debd`).
 *
 * The brief stated no numbers. The product supplied three of its four factor values —
 * `source: "cee_inference"`, `extractionType: "inferred"`, identical across
 * three draws — ran the analysis, and told the user *"Hire a Tech Lead scored
 * highest against your goal in 81% of runs."* **The user was never told a single
 * one of those numbers was ours.**
 *
 * ⭐ THIS IS NOT NEW DOCTRINE. It is Paul's ratified decision D-ask-1 (ROADMAP
 * 2.11), applied to the population it does not yet cover:
 *
 *   *"an option added without configuration gets SCAFFOLDED, DISCLOSED
 *    placeholder values so analysis keeps running. Disclosure is claim-safety-
 *    critical — the analysis result must never present a scaffolded option's
 *    numbers as user-provided."*
 *
 * That ruling is thoroughly plumbed for scaffolded OPTIONS (`scaffold`: 59
 * non-test files). It says nothing about CEE-inferred FACTOR values, and
 * measured, nothing else does either: **0 of the six disclosure modules
 * reference `cee_inference`/`inferred`/`extractionType`**, and the 6 non-test
 * files that mention `cee_inference` are all producers, schema or normalisers —
 * none is user-facing. Same claim-safety principle, different population.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⭐⭐ WHY DISCLOSE RATHER THAN REFUSE TO ESTIMATE.
 *
 * Olumi's purpose states its own *"assumptions, estimates, causal claims and
 * alternatives remain distinguishable, appropriately uncertain and open to
 * correction"* — estimates are contemplated, not forbidden. And *"provisional
 * means the user can change something and see how much it matters"* REQUIRES a
 * value to exist before it can be varied. Refusing to estimate would block the
 * first answer behind N questions, which is the failure that cost a real user
 * thirty-seven minutes on 23 Sep.
 *
 * So the product may supply a value. It may never present it as the team's.
 * The defect was never the estimate; it was the silence.
 *
 * ⛔ IT COUNTS, IT DOES NOT NAME. Naming every inferred factor would bury the
 * result, and the count is what the user needs to decide whether to look. The
 * labels are already on the canvas, where they can be changed.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⛔ IT COUNTED ONLY FACTOR BASELINES, AND SO UNDERSTATED HOW MUCH WAS OURS
 * (A6 `olumi-authored-disclosure-undercounts`, P2 re-measure on CEE 523e18d).
 *
 * Served, journey A run 2 (scenario `1ceb77d8`, graph `a8ef47fe52bebbaa`): the
 * run said *"I supplied 6 of the values behind this"*. The graph it ran on also
 * carried 4 option levels Olumi proposed (`cee_hypothesis`) and 12 link
 * strengths Olumi drafted. The sentence counted 6 of 22.
 *
 * So the count is now every Olumi value the model carries into the analysis —
 * {@link deriveOlumiAuthoredValues}. Authorship is read by the estate's ONE
 * classifier (`classifyValueSource`, `obligation-provenance.ts`), never a list
 * kept here, and a value the user stated OR confirmed is never counted as ours.
 * The sentence is unchanged; only its number is.
 *
 * ⚠ NOT COUNTED HERE, DELIBERATELY: the ENGINE's 0.0 for a root node nobody gave
 * a starting value (`ROOT_NODE_DEFAULT_VALUE`). It is not in the graph; PLoT
 * names its node by id only in `inference_warnings`, a ratified Tier-3 deny key that a
 * user-facing string producer may not read without claim-safety review
 * (`tests/contract/tier3-leak-guard.static.guard.test.ts`). It has its own
 * disclosure family (`pick-defaulted-assumptions.ts`, which reads
 * `decision_brief.defaulted_assumptions`); counting it in THIS sentence is a
 * claim-safety-review change, not this one.
 */

import {
  classifyValueSource,
  type StructureProvenance,
} from '../../cee/graph-readiness/obligation-provenance.js';
import { readEdgeParams } from '../../cee/unified-pipeline/utils/edge-format.js';
import { isLegalStructuralEdge } from '../../cee/utils/structural-edge-classifier.js';

/**
 * The longest suffix this module can emit, for the caller's length budget.
 *
 * ⛔ DERIVED FROM THE BUILDER, NEVER HAND-ESTIMATED. A budget under the real
 * worst case does not truncate — the caller DROPS the suffix, so the user is
 * silently not told the numbers were ours, which is the exact claim-safety
 * failure this module exists to close. `inferred-value-disclosure.test.ts`
 * re-derives this by running the builder over every count it can render and
 * asserts EQUALITY, so lengthening the copy fails a test rather than going
 * dark. Hand-counting the same sentences gave a different number; the builder
 * is the authority.
 */
export const INFERRED_VALUE_DISCLOSURE_MAX_CHARS = 167;

/**
 * The grammar the egress allowlist must admit, or this suffix is silently
 * replaced by the locked template — the failure mode `scaffold-disclosure.ts`
 * records for its own family. Kept in ONE place so the copy and the allowlist
 * cannot drift apart (trap 21).
 */
export const INFERRED_VALUE_DISCLOSURE_RE_SRC =
  ' (?:I supplied (?:the value|\\d{1,2} of the values) behind this, because your brief did not state (?:it|them)\\. (?:It is|They are) mine rather than yours\\. Changing (?:it|any of them) changes what this model implies\\.)';

/** A factor value the product chose, rather than one the team stated. */
export interface InferredValueRecord {
  readonly factor_id: string;
}

/**
 * One value the analysis computes on that is Olumi's, by what it is. The
 * disclosure spends only the COUNT; the kind and ids exist so a test can bind
 * the count to the exact values it covers, never to a number another set could
 * also produce.
 */
export type OlumiAuthoredValue =
  | { readonly kind: 'factor_baseline'; readonly factor_id: string }
  | { readonly kind: 'option_level'; readonly option_id: string; readonly factor_id: string }
  | { readonly kind: 'link_strength'; readonly from: string; readonly to: string };

/**
 * ⛔⛔ PARKED, NOT FORGOTTEN: "AND DOES OUR NUMBER ACTUALLY MATTER?"
 *
 * The obvious next sentence here is whether the values WE supplied move the
 * result — the purpose statement's *"provisional means the user can change
 * something and see how much it matters"*. It was built (a
 * `readInferredValueResolution` over `p_win_sensitivity[].status ===
 * 'below_resolution'`, with six tests) and then WITHDRAWN UNSHIPPED on 23 Sep,
 * for two independent reasons. Recorded here so the next lane does not rebuild
 * it and hit the same wall.
 *
 * 1. THE COPY WOULD HAVE BEEN FALSE. The drafted sentence said our numbers do
 *    not change *"which option comes out in front"*. ISL says of this exact
 *    field (`src/models/response_v2.py:1766-1771`) that *"holding the decision
 *    fixed, it structurally cannot capture option-switching"* — option-switching
 *    is `factor_evppi`'s question, not this one. The quantity is
 *    `perfect_metric − current_metric` with THE DECISION HELD FIXED, so it can
 *    never license a claim about the ranking. That is trap 13c: an expectation
 *    written from the implementer's reading of a field name rather than from
 *    the producer's stated semantics.
 *
 * 2. USER-FACING NARRATION OF THIS FIELD IS UNDER A STANDING BAN, and the
 *    tempting way out is already closed. `uncertainty-priority.ts:38-51`
 *    records the counter-reading — the field was renamed off "EVPI", so
 *    arguably the EVPI narration ban no longer covers it — as CONSIDERED AND
 *    REJECTED: *"A rename means the NAME was wrong, not that the narration
 *    constraint lapsed."*
 *
 * WHAT WOULD LIFT IT (unchanged from that module): a non-provisional EVPI
 * labelling doctrine at ISL, or an explicit science sign-off scoping
 * `p_win_sensitivity` out of the ban. **Either is a ruling, not a lane's call.**
 *
 * ⭐ IF IT IS LIFTED, the honest metric-neutral gloss is *"the uncertainty this
 * run's result is most sensitive to"* — never a claim about which option leads.
 * And note the ban does NOT touch this module's actual job: saying a number is
 * ours is a statement about AUTHORSHIP, which needs no sensitivity science.
 */

/**
 * The suffix. Empty when the team stated everything — silence is correct there,
 * because there is nothing of ours in the result to distinguish.
 */
export function buildInferredValueDisclosure(
  inferred: readonly (InferredValueRecord | OlumiAuthoredValue)[],
): string {
  const n = inferred.length;
  if (n === 0) return '';
  // `\d{1,2}` in the grammar: clamp so a pathological graph cannot emit a
  // sentence the allowlist would reject and thereby lose the whole disclosure.
  const clamped = Math.min(n, 99);
  const one = clamped === 1;
  const opening = one
    ? ' I supplied the value behind this, because your brief did not state it. It is mine rather than yours.'
    : ` I supplied ${clamped} of the values behind this, because your brief did not state them. They are mine rather than yours.`;
  // ⛔ MODEL-RELATIVE, AND DELIBERATELY SAYS NOTHING ABOUT MAGNITUDE. "Changing
  // it changes what this model implies" is true by construction of a model and
  // needs no sensitivity science to license. Anything stronger — whether ours
  // move the ranking — is the PARKED claim above, and is banned until a ruling.
  const tail = ` Changing ${one ? 'it' : 'any of them'} changes what this model implies.`;
  return `${opening}${tail}`;
}

/**
 * Which factors carry a value the PRODUCT chose.
 *
 * ⛔ BOUND TO PROVENANCE, NOT TO A VALUE PREDICATE. "Has a value the user did
 * not state" is a question about authorship, and only the provenance carriers
 * answer it — a value's magnitude says nothing about whose it is. The literals
 * below are the estate's own inference family (`observed_state.source`
 * `cee_inference`/`inferred`/`cee_repair`, and `data.extractionType`
 * `inferred`); `brief_extraction` and every `user*` source are excluded because
 * those ARE the team's.
 */
export function deriveInferredValues(graph: unknown): InferredValueRecord[] {
  const nodes = (graph as { nodes?: unknown } | undefined)?.nodes;
  if (!Array.isArray(nodes)) return [];
  const out: InferredValueRecord[] = [];
  for (const raw of nodes as Array<Record<string, unknown>>) {
    if (raw === null || typeof raw !== 'object' || raw.kind !== 'factor') continue;
    const observed = raw.observed_state as Record<string, unknown> | undefined;
    const data = raw.data as Record<string, unknown> | undefined;
    const hasValue =
      typeof observed?.value === 'number' || typeof data?.value === 'number';
    if (!hasValue) continue;
    const source = typeof observed?.source === 'string' ? observed.source : undefined;
    const extraction = typeof data?.extractionType === 'string' ? data.extractionType : undefined;
    const isOurs =
      source === 'cee_inference'
      || source === 'inferred'
      || source === 'cee_repair'
      || extraction === 'inferred';
    if (!isOurs) continue;
    out.push({ factor_id: typeof raw.id === 'string' ? raw.id : '' });
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// EVERY OLUMI-AUTHORED VALUE THE ANALYSIS COMPUTES ON
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Whose value a classified stamp is, for THIS sentence ("They are mine rather than yours").
 *
 * ⛔ `user_ratified` IS THE USER'S HERE. A confirmed estimate is one a person acted on, and describing it back as
 * Olumi's own invention is the lie `reflectsAHumanAct` (`obligation-provenance.ts`) exists to prevent. `unattributed`
 * is nobody we can name, so it is never claimed as ours: wrongly calling a user's value our invention is the worse
 * error (`not-modelled-manifest.ts`). A `Record` so a sixth class must be ruled here, not absorbed by an `else`.
 */
const OLUMI_AUTHORED: Readonly<Record<StructureProvenance, boolean>> = {
  user_stated: false,
  user_ratified: false,
  ai_drafted: true,
  system_repaired: true,
  unattributed: false,
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function recordsOf(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(asRecord).filter((r): r is Record<string, unknown> => r !== null) : [];
}

/**
 * The option levels Olumi set: each option×factor `interventions` entry that carries a number and whose `source`
 * classifies as Olumi's (`cee_hypothesis` → `ai_drafted`). A level the user stated (`brief_extraction`,
 * `user_specified`) or confirmed is not counted, and a bare-number legacy entry carries no author and is not claimed.
 */
export function deriveOlumiOptionLevels(graph: unknown): OlumiAuthoredValue[] {
  const out: OlumiAuthoredValue[] = [];
  for (const node of recordsOf(asRecord(graph)?.nodes)) {
    if (node.kind !== 'option' || typeof node.id !== 'string') continue;
    const interventions = asRecord(node.interventions) ?? asRecord(asRecord(node.data)?.interventions);
    if (interventions === null) continue;
    for (const [factorId, raw] of Object.entries(interventions)) {
      const entry = asRecord(raw);
      if (entry === null) continue;
      if (typeof entry.value !== 'number' && typeof entry.raw_value !== 'number') continue;
      if (!OLUMI_AUTHORED[classifyValueSource(entry.source)]) continue;
      out.push({ kind: 'option_level', option_id: node.id, factor_id: factorId });
    }
  }
  return out;
}

/**
 * The link strengths Olumi supplied: every causal link carrying a strength whose `provenance.source` classifies as
 * Olumi's, or which nobody stamped but CEE marked `defaulted` (its own flag that a default strength was applied).
 *
 * ⛔ A link the user set or confirmed is the USER's strength (`adjust-edge-strength.ts` stamps `user_specified` and
 * ends `defaulted`), and it stays theirs even beside a stale `defaulted`. Its `exists_defaulted` / `std_defaulted`
 * say the existence and the spread are still Olumi's, but this sentence counts values the user would recognise, and
 * the link's strength is not one of Olumi's. Structural wiring (decision→option, option→factor) carries a fixed
 * 1 / 0.01, not an estimate, so it is not a strength anyone supplied.
 */
export function deriveOlumiLinkStrengths(graph: unknown): OlumiAuthoredValue[] {
  const g = asRecord(graph);
  const kindById = new Map<string, string>();
  for (const node of recordsOf(g?.nodes)) {
    if (typeof node.id === 'string' && typeof node.kind === 'string') kindById.set(node.id, node.kind);
  }
  const out: OlumiAuthoredValue[] = [];
  for (const edge of recordsOf(g?.edges)) {
    if (typeof edge.from !== 'string' || typeof edge.to !== 'string') continue;
    const fromKind = kindById.get(edge.from);
    const toKind = kindById.get(edge.to);
    // A link to nothing in the model is nothing the analysis runs on.
    if (fromKind === undefined || toKind === undefined) continue;
    if (isLegalStructuralEdge(fromKind, toKind)) continue;
    if (readEdgeParams(edge).mean === undefined) continue;
    const author = classifyValueSource(asRecord(edge.provenance)?.source);
    const ours = OLUMI_AUTHORED[author] || (author === 'unattributed' && edge.defaulted === true);
    if (!ours) continue;
    out.push({ kind: 'link_strength', from: edge.from, to: edge.to });
  }
  return out;
}

/**
 * ⭐ WHAT THE DISCLOSURE COUNTS: every Olumi-authored value the model carries into the analysis — factor baselines
 * ({@link deriveInferredValues}, unchanged), option levels and link strengths.
 */
export function deriveOlumiAuthoredValues(graph: unknown): OlumiAuthoredValue[] {
  return [
    ...deriveInferredValues(graph).map((r): OlumiAuthoredValue => ({ kind: 'factor_baseline', factor_id: r.factor_id })),
    ...deriveOlumiOptionLevels(graph),
    ...deriveOlumiLinkStrengths(graph),
  ];
}
