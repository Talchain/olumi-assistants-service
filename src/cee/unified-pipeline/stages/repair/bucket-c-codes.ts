/**
 * BUCKET C VIOLATION CODES — THE SINGLE AUTHORITY.
 *
 * Bucket C is the set of validator codes that are SEMANTIC: no deterministic
 * repair can resolve them, so their presence in the post-sweep violation set is
 * what makes `ctx.llmRepairNeeded` true. Every site that answers the question
 * "which REMAINING violation codes block / route to LLM repair" reads this set
 * and never restates it.
 *
 * WHY THIS IS ITS OWN MODULE, and not simply an export of deterministic-sweep.ts
 * ---------------------------------------------------------------------------
 * The list was previously declared TWICE — here's-a-copy in
 * `options-identical-graceful-dedup.ts` under a "KEEP IN SYNC" comment. That is
 * the estate's dominant defect class (platform trap 12: a list a human must
 * remember to sync WILL drift, and the drift always reads as green).
 *
 * The obvious repair — import it from `deterministic-sweep.ts` — is REFUTED BY
 * EXECUTION. Two wiring specs replace that module wholesale with a `vi.mock`
 * factory that returns only `runDeterministicSweep`:
 *   - tests/unit/cee.unified-pipeline.repair-bypass-wiring.test.ts
 *   - tests/unit/cee.clarifier-retired.test.ts
 * A `vi.mock` factory REPLACES the module, so under those mocks an import of
 * `BUCKET_C_CODES` from the sweep resolves to nothing, and the
 * `llmRepairNeeded` derivation in the graceful dedup dies at
 * `BUCKET_C_CODES.has(...)`. Measured on this branch: with a plain sweep
 * import in place, a spec that mocks the sweep wholesale AND actually calls
 * `attemptOptionsIdenticalGracefulDedup` fails at the derivation line. Worse,
 * the two specs above stay GREEN under that same defect, because neither of
 * them ever calls the dedup — the hazard is latent and invisible to the suite
 * that would supposedly catch it.
 *
 * Fixing each mock site with an `importOriginal` spread would work TODAY and
 * would depend, forever, on every future wholesale mock of the sweep being
 * written correctly — the same hand-maintained discipline this change exists to
 * abolish, one level up. A leaf constants module with no behaviour, no imports
 * and no reason to be mocked makes the hazard structurally impossible instead.
 *
 * `deterministic-sweep.ts` re-exports this set, so importing it from there
 * still works and remains a supported path — but a consumer that does so
 * inherits the mock exposure described above. Prefer importing from here.
 *
 * Enforced by tests/unit/cee.bucket-c-codes-single-authority.test.ts, which
 * derives the check from this set rather than restating it.
 */

/**
 * Bucket C: semantic, LLM only — we identify these to decide llmRepairNeeded.
 *
 * `ReadonlySet` because this is now a shared singleton: a consumer that mutated
 * it would silently re-route every other consumer's violations.
 */
export const BUCKET_C_CODES: ReadonlySet<string> = new Set([
  "NO_PATH_TO_GOAL",
  "NO_EFFECT_PATH",
  "UNREACHABLE_FROM_DECISION",
  "MISSING_BRIDGE",
  "MISSING_GOAL",
  "MISSING_DECISION",
  "INVALID_EDGE_TYPE",
  // CYCLE_DETECTED: moved to Bucket A (deterministic back-edge removal)
  "OPTIONS_IDENTICAL",
  "GOAL_NUMBER_AS_FACTOR",
  "INSUFFICIENT_OPTIONS",
  // INVALID_INTERVENTION_REF: moved to Bucket B (fuzzy matching)
]);
