/**
 * ⭐⭐ WHAT THE USER STATED A STORED NUMBER **AS** — the role axis, and the
 * alphabet a node's `observed_state` may carry it in.
 *
 * ── THE DEFECT THIS EXISTS FOR ─────────────────────────────────────────────
 * Measured on live staging, 14 Sep 2026, 11 fresh drafts of one brief
 * (*"…while keeping monthly churn under 4%…"*). In 3 of the 11 the 4% was
 * stored as:
 *
 *     observed_state: { value: 0.04, unit: "%", source: "brief_extraction",
 *                       extractionType: "explicit" }
 *
 * — the field whose own declaration reads *"current or proposed value"*. The
 * model therefore asserts **churn IS 4%** when the user said **keep it under
 * 4%**. In the same responses `goal_constraints[]` carried the row honestly
 * (`operator: "<=", value: 0.04, node_id: <the same node>`), so CEE already
 * knew the role and stored the number in the other one anyway.
 *
 * ── WHY A SEPARATE ALPHABET AND NOT `STATED_KINDS` ITSELF ──────────────────
 * `STATED_KINDS` (`not-modelled-manifest.ts`) is the full 8-member axis and is
 * the AUTHORITY: this file mints no classification and no vocabulary of its
 * own, it only names the SUBSET a live producer can actually stamp on a node.
 * Of the eight, exactly two have a live producer (`STATED_KIND_PRODUCERS`) —
 * `figure` and `constraint` — and `figure` is that module's declared DEFAULT,
 * the answer meaning "no producer claimed a role for this". Stamping it would
 * assert nothing while looking like an assertion, so the alphabet is one
 * member.
 *
 * ⚠ ONE MEMBER, DELIBERATELY, AND IT IS COUPLED. This is the same shape as
 * `PriorDistribution` (`schemas/graph.ts`): a narrow enum whose justification
 * is a fact declared elsewhere. `stated-role-vocabulary.test.ts` asserts, BY
 * IMPORT rather than by transcription, that every member here is a member of
 * `STATED_KINDS` and that no kind with a live producer is missing except the
 * declared default — so widening `STATED_KIND_PRODUCERS` without widening this
 * file REDs, and a member added here that the authority does not know REDs too.
 * The guard fails loud in BOTH directions (CLAUDE.md trap 12).
 *
 * ── WHAT IS NOT HERE, AND WHY THAT IS THE HONEST ANSWER ────────────────────
 * `target` is NOT a member. A stated target genuinely has no node-level
 * producer: `goal_threshold` / `goal_threshold_raw` carry targets on the GOAL
 * node by carrier choice, and `STATED_KINDS`'s `goal` member is already listed
 * in `UNSOURCED_STATED_KINDS` for exactly this reason. Minting `target` here
 * would create a member nothing can ever write — the dark-field failure this
 * estate is named for. The absence is recorded, not silently filled.
 *
 * ZERO IMPORTS BY DESIGN. Both `schemas/cee-v3.ts` (the wire declaration) and
 * `cee/context-integrity/` (the producer) read this, and the manifest module's
 * transitive import graph reaches `analysis-ready-helper.ts`, so importing the
 * authority directly into a schema module risks an ESM cycle whose symptom is
 * an `undefined` enum at module-evaluation time. A leaf cannot cycle.
 */

/**
 * The roles a node's `observed_state.stated_role` may declare.
 *
 * `constraint` — the user stated this magnitude as a LIMIT (a floor or a
 * ceiling), and the level stored beside it is that limit re-used as the node's
 * position, not a level the user asserted. The producer is
 * `deriveStatedQuantityRoles` (`not-modelled-manifest.ts`), which reads the
 * `goal_constraints[]` rows — it re-classifies nothing from prose.
 */
export const OBSERVED_STATE_STATED_ROLES = ["constraint"] as const;

export type ObservedStateStatedRole = (typeof OBSERVED_STATE_STATED_ROLES)[number];
