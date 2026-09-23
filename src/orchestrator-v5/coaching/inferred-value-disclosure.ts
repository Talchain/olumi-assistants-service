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
  inferred: readonly InferredValueRecord[],
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
