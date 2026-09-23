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

/** The longest suffix this module can emit, for the caller's length budget. */
export const INFERRED_VALUE_DISCLOSURE_MAX_CHARS = 200;

/**
 * The grammar the egress allowlist must admit, or this suffix is silently
 * replaced by the locked template — the failure mode `scaffold-disclosure.ts`
 * records for its own family. Kept in ONE place so the copy and the allowlist
 * cannot drift apart (trap 21).
 */
export const INFERRED_VALUE_DISCLOSURE_RE_SRC =
  ' (?:I supplied (?:the value|\\d{1,2} of the values) behind this, because your brief did not state (?:it|them)\\. (?:It is|They are) mine rather than yours, and changing (?:it|any of them) changes what this model implies\\.)';

/** A factor value the product chose, rather than one the team stated. */
export interface InferredValueRecord {
  readonly factor_id: string;
}

/**
 * The suffix. Empty when the team stated everything — silence is correct there,
 * because there is nothing of ours in the result to distinguish.
 */
export function buildInferredValueDisclosure(
  inferred: readonly InferredValueRecord[],
): string {
  const n = inferred.length;
  if (n === 0) return '';
  // `\d{1,2}` in the grammar: clamp so a pathological graph cannot emit a
  // sentence the allowlist would reject and thereby lose the whole disclosure.
  const clamped = Math.min(n, 99);
  return clamped === 1
    ? ' I supplied the value behind this, because your brief did not state it.'
      + ' It is mine rather than yours, and changing it changes what this model implies.'
    : ` I supplied ${clamped} of the values behind this, because your brief did not state them.`
      + ' They are mine rather than yours, and changing any of them changes what this model implies.';
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
