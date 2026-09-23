/**
 * THE INFERRED-VALUE DISCLOSURE — the analysis says whose numbers it ran on.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE GAP, MEASURED ON DEPLOYED STAGING (23 Sep, scenario `e243debd`).
 *
 * The brief stated no numbers. The product supplied all four factor values —
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
 */

/**
 * The longest suffix this module can emit, for the caller's length budget.
 *
 * ⛔ DERIVED FROM THE BUILDER, NEVER HAND-ESTIMATED. A budget under the real
 * worst case does not truncate — the caller DROPS the suffix, and the user is
 * silently not told the numbers were ours. `inferred-value-disclosure.test.ts`
 * re-derives this by running the builder over every (count, resolution) shape
 * and asserts EQUALITY, so lengthening a sentence fails a test rather than
 * going dark. A hand count of the same sentences said 280; the builder says
 * 272.
 */
export const INFERRED_VALUE_DISCLOSURE_MAX_CHARS = 272;

/**
 * The grammar the egress allowlist must admit, or this suffix is silently
 * replaced by the locked template — the failure mode `scaffold-disclosure.ts`
 * records for its own family. Kept in ONE place so the copy and the allowlist
 * cannot drift apart (trap 21).
 */
export const INFERRED_VALUE_DISCLOSURE_RE_SRC =
  ' (?:I supplied (?:the value|\\d{1,2} of the values) behind this, because your brief did not state (?:it|them)\\. (?:It is|They are) mine rather than yours\\.(?: (?:Changing (?:it|any of them) changes what this model implies\\.|Within the range the engine can resolve, (?:it does not change|none of them changes) which option comes out in front — so the place to push back is the reasoning, not (?:that number|those numbers)\\.|At least one of them does change which option comes out in front, so it is worth settling\\.)))';

/** A factor value the product chose, rather than one the team stated. */
export interface InferredValueRecord {
  readonly factor_id: string;
}

/**
 * What the run itself says about whether OUR numbers matter.
 *
 * ⭐ THIS IS WHERE "PROVISIONAL" BECOMES REAL. The purpose statement says
 * *"provisional means the user can change something and see how much it
 * matters"* — and the engine already answers it per factor: `p_win_sensitivity`
 * carries `status: "below_resolution"` when resolving that factor perfectly
 * would move the result LESS than the noise floor.
 *
 * Measured on scenario `e243debd`: all four inferred values were
 * `below_resolution`. So the product invented four numbers, named a leading
 * option, and **not one of those numbers would have changed which option led** —
 * a fact that makes the result MORE trustworthy and which the user was never
 * told.
 *
 * ⛔ IT DOES NOT SUPPRESS THE DISCLOSURE. Sensitivity decides the EMPHASIS,
 * never whether the user is told a number is ours: an assumption the team would
 * DISPUTE is worth seeing whether or not it moves the ranking, because
 * disputing it is the reasoning this product exists to provoke.
 */
export type InferredValueResolution = 'none_matter' | 'some_matter' | 'unknown';

/**
 * Read the run's own per-factor verdict for the values WE supplied.
 *
 * Returns `unknown` unless every inferred factor is accounted for — a partial
 * sweep cannot support "none of them matters", and claiming it would be the
 * absence-without-a-manifest error.
 */
export function readInferredValueResolution(
  enrichment: unknown,
  inferred: readonly InferredValueRecord[],
): InferredValueResolution {
  if (inferred.length === 0) return 'unknown';
  const rows = (enrichment as { p_win_sensitivity?: unknown } | undefined)?.p_win_sensitivity;
  if (!Array.isArray(rows)) return 'unknown';
  const byId = new Map<string, string>();
  for (const r of rows as Array<Record<string, unknown>>) {
    if (r === null || typeof r !== 'object') continue;
    if (typeof r.factor_id === 'string' && typeof r.status === 'string') {
      byId.set(r.factor_id, r.status);
    }
  }
  let seen = 0;
  let anyMatters = false;
  for (const rec of inferred) {
    const status = byId.get(rec.factor_id);
    if (status === undefined) continue;
    seen += 1;
    if (status !== 'below_resolution') anyMatters = true;
  }
  if (seen !== inferred.length) return 'unknown';
  return anyMatters ? 'some_matter' : 'none_matter';
}

/**
 * The suffix. Empty when the team stated everything — silence is correct there,
 * because there is nothing of ours in the result to distinguish.
 */
export function buildInferredValueDisclosure(
  inferred: readonly InferredValueRecord[],
  resolution: InferredValueResolution = 'unknown',
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
  // The run's own verdict on whether ours move the result. `unknown` says the
  // plain provisional truth rather than guessing either way.
  const tail =
    resolution === 'none_matter'
      ? ` Within the range the engine can resolve, ${one ? 'it does not change' : 'none of them changes'} which option comes out in front — so the place to push back is the reasoning, not ${one ? 'that number' : 'those numbers'}.`
      : resolution === 'some_matter'
        ? ' At least one of them does change which option comes out in front, so it is worth settling.'
        : ` Changing ${one ? 'it' : 'any of them'} changes what this model implies.`;
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
