/**
 * THE DRAFT RECORDS GRAMMAR — what the draft model emits, INSTEAD of a graph.
 *
 * ── THE THREE SHAPES, NAMED APART (trap 21) ────────────────────────────────
 * There are three distinct shapes in this mechanism and they must never share a
 * name:
 *
 *   1. THIS FILE — the MODEL-FACING GRAMMAR. Lives in CEE code, occupies the
 *      `output_config.format.json_schema` slot. Governed by Anthropic's grammar
 *      budgets. Changes on instruction/grammar iteration and NEVER on a
 *      `@talchain/schemas` train.
 *   2. The CEE-INTERNAL STORED RECORDS (the ledger) — CEE-side only, no
 *      published contract.
 *   3. The PUBLISHED WIRE CONTRACT (`@talchain/schemas`) — untouched by this
 *      change. The maths never reads records: PLoT and ISL continue to receive
 *      the GRAPH only.
 *
 * ── WHY RECORDS AND NOT A GRAPH ────────────────────────────────────────────
 * Measured per atom at the raw provider bytes over 42 same-window runs
 * (2026-08-11): 83–89 % of material loss happens at GENERATION — the model never
 * emitted the fact — not in repair or validation. No downstream hardening can
 * recover an atom that was never produced. The output contract is therefore the
 * right seam, and a record set is the shape that lets the model state what the
 * user said SEPARATELY from what the model itself is adding.
 *
 * ── ⚠ TERMINOLOGY: THIS IS NOT A TOOL SCHEMA ───────────────────────────────
 * The draft path does not use a `tools[]` entry. It uses Anthropic STRUCTURED
 * OUTPUTS — `output_config.format = { type: "json_schema", schema }`
 * (`anthropic.ts`, `buildCallParams`). The seam this grammar occupies is the
 * structured-outputs schema slot the graph grammar occupies today.
 *
 * ── ⚠ THE BINDING BUDGET IS COMPILED GRAMMAR SIZE ──────────────────────────
 * The published optional-parameter limit is real but is not what killed the
 * graph schema. The dominant, UNPUBLISHED constraint is COMPILED GRAMMAR SIZE,
 * established by a 15-probe live bisect on 2026-07-07:
 *   PASS boundary ~3.2KB / 7 object schemas · FAIL ~3.5KB / 9 object schemas
 * The repo pins `SERIALIZED_BYTES_BUDGET = 3400`. A schema can satisfy every
 * static budget and still draw 400 "The compiled grammar is too large" — at
 * which point the adapter SILENTLY falls back to prompt-only JSON on every
 * draft. That silent fallback is the real hazard, which is why the budget
 * instruments below are exported and asserted in CI rather than being a
 * one-off probe.
 *
 * This grammar is structurally CHEAPER than the graph grammar on every axis at
 * once, and was live-compile-probed (HTTP 200, with a 400-producing negative
 * control and a same-run contrast control) before any run was spent on it.
 *
 * ── DESIGN DECISIONS THAT ARE NOT FREE (each one recorded) ─────────────────
 *
 * 1. THE MODEL MINTS NO IDENTIFIERS. It cannot cite an id CEE has not minted
 *    yet, so records reference each other by ARRAY POSITION on the wire and the
 *    PROJECTOR resolves position → minted id. No identifier crosses the wire;
 *    the projector — a pure function — owns identity.
 *
 * 1b. ⭐⭐ THE NAMESPACE IS CARRIED BY THE FIELD NAME, NOT BY A PREFIX INSIDE A
 *    STRING (v4, 2026-08-12). This replaces `from_ref`/`to_ref`, which were
 *    single strings whose FIRST CHARACTER selected the namespace: `s<N>` =
 *    `stated_items[N]`, `c<N>` = `claims[N]`.
 *
 *    MEASURED, and it cost a whole acceptance block. On the long brief B1 the
 *    model emitted `to_ref="c0"` on the only three links intended to terminate
 *    at the goal. The goal was `s0`; `c0` was `claims[0]`, an
 *    `option_refinement`. Every one resolved SUCCESSFULLY — to the wrong node —
 *    so nothing reached the goal, the projector pruned everything that could
 *    not, and a complete 23-item / 34-claim emission collapsed to 8 nodes and 6
 *    edges. A one-character namespace selector inside a free string is
 *    unguardable: both spellings are well-formed, so the error is invisible
 *    everywhere upstream of the graph.
 *
 *    ⚠ THE GRAMMAR CANNOT ENFORCE A STRING'S SHAPE HERE. `pattern` is in
 *    `FORBIDDEN_SCHEMA_KEYWORDS` — the structured-outputs compiler rejects it —
 *    so there is no regex the schema could carry. The only enforcement the
 *    grammar CAN apply is a TYPE, and a type applies to a FIELD. So the
 *    namespace becomes four typed integer fields:
 *
 *      from_stated / to_stated → an index into `stated_items`
 *      from_claim  / to_claim  → an index into `claims`
 *
 *    A claims index can no longer be written where a stated index belongs while
 *    LOOKING correct: it would have to be written into a differently-named,
 *    self-describing field. `"c0"` is not even emittable — a string in an
 *    integer field is rejected by the decoder itself.
 *
 *    ⚠ HONEST LIMIT, stated because the fix is not total: the model can still
 *    put the right integer in the WRONG FIELD. That residue is caught
 *    downstream, not here — `projector.ts` rejects and DISCLOSES any reference
 *    whose resolved node kinds cannot form a legal edge, instead of silently
 *    mis-binding it. Two harms, two mechanisms (trap 21/22b); neither is asked
 *    to cover the other.
 *
 *    A UNIFIED namespace (one flat index over stated_items ++ claims) was
 *    considered and REJECTED: referencing `claims[k]` would require the model to
 *    emit `stated_items.length + k`, converting a class confusion into an
 *    ARITHMETIC one — and an off-by-one still lands on a real node of a
 *    plausible kind, which is strictly harder to machine-catch than what it
 *    replaces.
 *
 * 2. `stated_items` CARRIES `minItems: 1`; `claims` DELIBERATELY DOES NOT.
 *    `required` + an unbounded array means `[]` is strictly conformant, and
 *    this estate has shipped that hole twice. A brief always states something,
 *    so bounding `stated_items` is safe. Bounding `claims` is NOT: forcing >=1
 *    inference on every draft manufactures pressure to INVENT one, and zero
 *    false authorship is the property this mechanism exists to defend. A
 *    grammar can forbid a shape; it cannot compel sufficiency (trap 23) — a
 *    forced floor would buy a better-looking claim count and a worse
 *    authorship number. Anthropic accepts `minItems` ∈ {0,1} ONLY
 *    (`minItems: 4` → HTTP 400, live-probed), so no larger floor exists anyway.
 *
 * 3. KIND-SCOPED FIELDS ARE OPTIONAL, NOT REQUIRED-NULLABLE. Required-nullable
 *    forces EVERY item to emit EVERY field, and draft latency is near-linear in
 *    output tokens. Optional costs a slot on the 24-budget; required-nullable
 *    costs a slot on the 16-union budget AND real wall-clock on every run.
 *    Discriminators (`kind`, `source_quote`, `claim_kind`, `label`) stay
 *    REQUIRED so the projector's switch is never undefined.
 *
 * 5. ⭐⭐ `is_baseline` EXISTS BECAUSE THE SERVED PROMPT MANDATES A FLAG THIS
 *    GRAMMAR COULD NOT EXPRESS (2026-08-14). The served `draft_graph` v195
 *    (content_hash `152998b447819c2e`, byte-matched to `/admin/prompts/status`)
 *    says at `:282-283`: *"Set `is_baseline: true` on Status Quo; all others
 *    `is_baseline: false`"* and *"mandatory on ANY option representing the status
 *    quo … whatever its label or id"*. The records path had **zero**
 *    `is_baseline` anywhere — grammar, projector and instruction alike (measured
 *    with contrast controls: `option` → 28 in this file). So the mandate was
 *    addressed to a shape the model had no field in which to emit, and the flag
 *    was DETERMINISTICALLY destroyed at generation. Same mechanism as the
 *    `risk`/`outcome` outage above: an enforced structured-output grammar does
 *    not degrade an inexpressible fact, it deletes it.
 *
 *    ⚠ AND THE HARM IT REPLACES IS NOT MERELY AN ABSENCE. With no honest
 *    channel, the downstream consumer GUESSED from labels, and the guess was
 *    inverted on every measured draw: `analysis-ready.ts`'s keyword list holds
 *    the bare tokens `current` and `keep` and takes the first match by array
 *    index, so *"replace our **current** CRM with HubSpot"* was flagged the
 *    status quo and *"**keep** what we have"* was not (B_crm, 3/3). The flag
 *    drives which option the analysis treats as the comparison base, so an
 *    inverted one corrupts every comparison the user reads. **This field is what
 *    lets that consumer stop guessing** — the two changes ship together, because
 *    tightening the guess without providing the channel would only trade a wrong
 *    baseline for no baseline.
 *
 *    COST against the budget that actually binds: two optional booleans, ~50
 *    serialised bytes, NO new object schema and NO union — so the compiled-
 *    grammar-size boundary is untouched. Measured before the change at 1198 /
 *    3400 bytes and 14 / 24 optional params; asserted by
 *    `records-grammar-budget.test.ts`.
 *
 * 4. `direction` IS `floor` | `ceiling` — THE USER'S LANGUAGE, NEVER THE WIRE
 *    OPERATOR. CEE #888 burned four rounds on a floor/ceiling predicate. The
 *    projector performs the single mapping to `ConstraintOperator`
 *    (`z.enum([">=", "<="])`, `schemas/graph.ts:171`), derived at the consumer's
 *    bytes rather than inferred, and pinned by a test.
 */

import { createHash } from "node:crypto";

// ── Vocabulary, seeded from shipped machinery, minting nothing new ──────────

/**
 * The `STATED_KINDS` SUBSET with live relevance to drafting.
 * Full shipped vocabulary is 8 (`cee/context-integrity/not-modelled-manifest.ts`);
 * this grammar takes the 4 the projector can actually place on a graph. The other four
 * (`evidence`, `assumption`, `disagreement`, `correction`) have no node kind to
 * land on and are OUT OF SCOPE for the DRAFTABLE subset — an omission
 * on the record, not a silent narrowing. They ship as explicit not-tracked
 * entries at the receipt surface (slice R2), never silently absent.
 *
 * ⚠ DELIBERATELY NOT WIDENED WITH `risk`/`outcome` when the CLAIM list was
 * (2026-08-14). A user-stated hazard already reaches a `risk` node through
 * `constraint` + `NODE_KIND_MAP`; see the note on `DRAFT_RECORD_CLAIM_KINDS`
 * for the full derivation and the positive control that pins it.
 */
export const DRAFT_RECORD_STATED_KINDS = ["goal", "option", "constraint", "figure"] as const;
export type DraftRecordStatedKind = (typeof DRAFT_RECORD_STATED_KINDS)[number];

/** ≈ `NumericAnchor.role` (`cee/signals/types.ts:22-27`). */
export const DRAFT_RECORD_ROLES = ["target", "baseline", "constraint", "context"] as const;
export type DraftRecordRole = (typeof DRAFT_RECORD_ROLES)[number];

/** The GATE's language. Never the wire operator — see design note 4. */
export const DRAFT_RECORD_DIRECTIONS = ["floor", "ceiling"] as const;
export type DraftRecordDirection = (typeof DRAFT_RECORD_DIRECTIONS)[number];

/**
 * The inference-claim kinds — what the MODEL adds.
 *
 * ── ⭐⭐ `risk` AND `outcome` ARE HERE BECAUSE THEIR ABSENCE WAS A LIVE OUTAGE ──
 * The R1 cutover shipped this list with four members. `risk` and `outcome` were
 * not "removed" — this file was NEW at `9f94e81b` (verified: `A` in that
 * commit's name-status) and its DRAFTABLE subset simply never admitted them. The
 * effect was the same and it was total, because this list IS the Anthropic
 * structured-output enum: a model reasoning about a hazard had no field in which
 * to say so.
 *
 * MEASURED on the deployed build `dbd012e`, 5/5 draws on the pinned brief
 * (`olumi-docs/PHASE0-EVIDENCE-2026-07-28/analysis-outage-2026-08-14/`):
 *   · `riskCount: 0` — every time;
 *   · every outcome on every graph was minted by `fixFactorGoalEdges`, i.e.
 *     100 % of the outcome layer was machine scaffolding.
 * The flattening is visible in the model's own words in the banked capture
 * `__tests__/fixtures/live-emission-round11-set12.json`, which carries a FACTOR
 * claim labelled "Engineering Attrition Risk".
 *
 * The served graph prompt (system block 1) has asked for "≥1 outcome and ≥1
 * risk" throughout. The grammar is what catches up.
 *
 * ── WHY THE *STATED* LIST IS NOT WIDENED TO MATCH ─────────────────────────
 * Derived, not assumed. `normaliseDraftResponse` runs immediately after
 * projection and `NODE_KIND_MAP` maps `constraint → risk`, so a hazard the USER
 * states ALREADY reaches a risk node through the existing `constraint` stated
 * kind (pinned as a positive control in
 * `__tests__/risk-outcome-expressible.test.ts`). Adding `risk` there would buy
 * no reachable capability, cost grammar bytes, and invite the model to file
 * genuinely thresholded constraints as bare risks — losing the floor/ceiling
 * machinery `direction` exists for. And no user "states an outcome": they state
 * a goal, and an outcome is by definition something inferred. So the widening is
 * exactly the CLAIM axis, which is where the loss was.
 *
 * ── COST, MEASURED AGAINST THE BUDGET THAT ACTUALLY BINDS ─────────────────
 * Two enum members add ~17 serialised bytes and NO object schema, NO optional
 * parameter and NO union — so the compiled-grammar-size boundary (the
 * unpublished constraint that silently degrades a draft to prompt-only JSON) is
 * untouched. Asserted by `records-grammar-budget.test.ts` and again by the
 * expressibility suite.
 */
export const DRAFT_RECORD_CLAIM_KINDS = [
  "factor",
  "causal_link",
  "option_refinement",
  "prior",
  "risk",
  "outcome",
] as const;
export type DraftRecordClaimKind = (typeof DRAFT_RECORD_CLAIM_KINDS)[number];

/**
 * The REQUIRED discriminator on every claim — and therefore the only field that
 * is present EXACTLY ONCE PER DECODED CLAIM, whatever the claim's kind.
 *
 * ⭐ WHY IT IS A CONSTANT RATHER THAN A LITERAL IN TWO PLACES. The streaming
 * runaway detector needs a structural "this stream is making forward progress"
 * probe for the records grammar, the way `"from"`/`"from_ref"` serves the graph
 * one. A probe written as its own string literal is a HAND-MAINTAINED MIRROR of
 * this schema (trap 12): rename the field here and the probe silently stops
 * matching, the detector silently stops seeing progress, and every slow records
 * draft is silently aborted as a runaway. Nothing goes red. So the schema below
 * and the probe are both BUILT FROM THIS ONE NAME, and cannot drift.
 *
 * ⚠ `label` is also required, but it is NOT a safe progress probe: the string
 * `"label"` appears in no other claim field today, yet nothing in the grammar
 * prevents a future optional field from containing it inside a VALUE. The
 * discriminator is the field whose semantics are "exactly one per claim".
 */
export const DRAFT_RECORD_CLAIM_DISCRIMINATOR = "claim_kind";

/**
 * ⭐ THE TYPED REFERENCE FIELDS — one per (endpoint × namespace), and the ONE
 * place their names are written.
 *
 * The schema below, the projector's resolver, the seam's carried-key set, the
 * completion grammar and the streaming edge-progress probe are ALL built from
 * this object. A rename therefore moves every consumer at once; none of them is
 * a hand-maintained mirror of the others (trap 12), which is the defect that put
 * `sets_to` on the wire and silently dropped it at the seam.
 *
 * `stated` and `claim` are the ARRAY NAMES the model is already emitting, so the
 * field name tells the model which list it is indexing without the instruction
 * having to teach a token grammar.
 */
export const DRAFT_RECORD_REF_FIELDS = {
  fromStated: "from_stated",
  fromClaim: "from_claim",
  toStated: "to_stated",
  toClaim: "to_claim",
} as const;

/** Every reference field name, derived — never re-listed. */
export const DRAFT_RECORD_REF_FIELD_NAMES = Object.values(DRAFT_RECORD_REF_FIELDS) as readonly string[];

/**
 * ⚠ NOTE FOR THE ADAPTER, recorded because a silence here is invisible.
 * `DRAFT_EDGES_REACHED_RE` (`draft-budget.ts`) is `/"from(_ref)?"\s*:/`, and it
 * matched records streams ONLY because the old reference field happened to be
 * called `from_ref`. With the fields renamed (design note 1b) it no longer
 * matches a records stream at all. That regex is NOT widened to chase them: it
 * is the GRAPH path's probe, the historic captures it serves still carry
 * graph-shaped edges, and adding records field names to it would make one
 * literal serve two grammars — the mirror this file exists to avoid. The records
 * path carries its own derived signals instead: the claim probe above and the
 * stated-item probe below.
 */

/**
 * The REQUIRED discriminator on every `stated_item` — present exactly once per
 * decoded stated item, whatever its kind.
 */
export const DRAFT_RECORD_STATED_DISCRIMINATOR = "source_quote";

/**
 * ⭐ THE EARLY PROGRESS SIGNAL — what closes the late-lift hole properly.
 *
 * The claim probe cannot fire until the ENTIRE `stated_items` array and every
 * preceding non-causal claim has been emitted. Measured on the two banked
 * long-brief streams, the first `claim_kind` lands at roughly characters 2,568
 * and 2,777 — and the one runaway abort the measured block observed fired at
 * **1,034 characters**, inside `stated_items`, thousands of characters before
 * any lift was possible. A healthy draft was killed for being slow at the one
 * point in the stream where nothing could vouch for it.
 *
 * `source_quote` appears in the first stated item, so this fires within a few
 * dozen characters of the first content. Derived from the discriminator constant
 * exactly as the claim probe is, so a rename moves the schema and the probe
 * together and cannot silently blind the detector (trap 12).
 *
 * ⚠ RESIDUAL EXPOSURE, STATED RATHER THAN GLOSSED. Joining this into the
 * bottleneck latch means a stream that emits `stated_items` forever is no longer
 * aborted by the 25 s ceiling. It is not unbounded: `max_tokens` is a hard
 * provider-side cap on the generation, so the exposure is a pathological stream
 * costing its full token budget in latency instead of being cut at 25 s. That is
 * the trade the #923 design already made for `claims`; this widens it to the
 * one region where a FALSE abort was actually measured, and the alternative —
 * leaving the hole open — kills healthy long-brief drafts, which is the failure
 * we have evidence for rather than the one we can imagine.
 *
 * Not global, for the same `lastIndex` reason the other probes carry.
 */
export const DRAFT_RECORDS_STATED_PROGRESS_RE = new RegExp(
  `"${DRAFT_RECORD_STATED_DISCRIMINATOR}"\\s*:`,
);

/**
 * Structural "a claim has been decoded" probe over accumulated stream text —
 * the records analogue of `DRAFT_EDGES_REACHED_RE`.
 *
 * Deliberately NOT global: it is used with `.test()`/`.exec()` on a moving
 * window, and a global flag would carry `lastIndex` across calls (the same note
 * the edges probe carries).
 */
export const DRAFT_RECORDS_CLAIM_PROGRESS_RE = new RegExp(`"${DRAFT_RECORD_CLAIM_DISCRIMINATOR}"\\s*:`);

/** `FactorCategory` (graph.ts). */
export const DRAFT_RECORD_CATEGORIES = ["controllable", "observable", "external"] as const;
export type DraftRecordCategory = (typeof DRAFT_RECORD_CATEGORIES)[number];

/** `EffectDirection` (graph.ts:356). */
export const DRAFT_RECORD_EFFECTS = ["positive", "negative"] as const;
export type DraftRecordEffect = (typeof DRAFT_RECORD_EFFECTS)[number];

// ── The wire shapes (TS mirrors of the JSON Schema below) ───────────────────

/** What the user said. `id` is absent BY DESIGN — see design note 1. */
export interface DraftStatedItem {
  kind: DraftRecordStatedKind;
  /** REQUIRED, verbatim. Verified by substring location against the brief. */
  source_quote: string;
  value?: number;
  unit?: string;
  role?: DraftRecordRole;
  /** `constraint` only. */
  direction?: DraftRecordDirection;
  /**
   * `option` only — see design note 5.
   *
   * The USER's own status-quo option. Measured: users write it themselves far
   * more often than the framing assumes — "keep what we have" (B_crm, 3/3 draws)
   * and "hold price and push volume instead" (C_pricing, 3/3). Both were the real
   * baseline and neither could say so.
   */
  is_baseline?: boolean;
}

/** What the model adds — the honesty half. `id` absent by design. */
export interface DraftInferenceClaim {
  claim_kind: DraftRecordClaimKind;
  label: string;
  /**
   * Indices into `stated_items`. Empty/absent ⇒ pure invention, and marked so.
   *
   * ⭐ ALSO THE PARENT LINK FOR AN `option_refinement`. A refinement whose
   * `basis` names exactly one stated `option` is a refinement OF that option,
   * and the projector merges the two rather than minting a second option node
   * for one alternative. No new field was needed: the link was already on the
   * wire (measured on B1 — 3 of 4 refinements named exactly one stated option).
   */
  basis?: number[];
  /**
   * `causal_link` only. TYPED BY NAMESPACE — see design note 1b. Exactly one
   * `from_*` and one `to_*` per link; emitting both of a pair is a contradiction
   * the projector discloses rather than resolves by preference.
   */
  from_stated?: number;
  from_claim?: number;
  to_stated?: number;
  to_claim?: number;
  effect?: DraftRecordEffect;
  strength?: number;
  category?: DraftRecordCategory;
  value?: number;
  /**
   * `causal_link` FROM AN OPTION ONLY — the value the target factor takes if
   * that option is chosen, in the factor's own unit. Becomes an entry in the
   * option node's `OptionData.interventions` (`schemas/graph.ts:163`), which is
   * what lets the analysis compute a real number rather than compare bare
   * labels.
   *
   * ⚠ DELIBERATELY NOT `strength`, and the two must never be merged. `strength`
   * answers "how strongly does A cause B" and lands on the EDGE as
   * `strength_mean`. `sets_to` answers "what level does this option put the
   * factor at" and lands on the OPTION NODE. Two questions under one name is
   * trap 21, and this estate has paid for it repeatedly; the extra optional
   * slot is cheap (13 free against Anthropic's 24) and the conflation is not.
   */
  sets_to?: number;
  /**
   * `option_refinement` only — see design note 5. The MODEL's added status quo.
   *
   * Named identically to the stated-item field on purpose: it is the SAME
   * question ("is this option the baseline?") asked of the two places an option
   * can come from, so ONE projector branch reads both. That is deliberate reuse,
   * not the twins defect — the twins defect is two DIFFERENT questions sharing a
   * name (trap 21); this is one question sharing a name.
   */
  is_baseline?: boolean;
}

export interface DraftRecordSet {
  stated_items: DraftStatedItem[];
  claims: DraftInferenceClaim[];
}

// ── The structured-outputs JSON Schema ──────────────────────────────────────

/**
 * Built by a FUNCTION, not exported as a frozen literal, so the C-K0 probe and
 * the budget test measure the EXACT object the adapter attaches (the lesson
 * `scripts/probe-grammar-compile.mjs` states: "this probes the EXACT object
 * production attaches, not a copy").
 *
 * Compliant by construction: every `type: "object"` carries
 * `additionalProperties: false`; no `$ref`, `oneOf`, `minimum`, `maximum`,
 * `pattern`, `maxItems`, or `format` anywhere.
 */
export function buildDraftRecordsSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      stated_items: {
        type: "array",
        // See design note 2. `minItems` ∈ {0,1} only.
        minItems: 1,
        items: {
          type: "object",
          properties: {
            kind: { type: "string", enum: [...DRAFT_RECORD_STATED_KINDS] },
            source_quote: { type: "string" },
            value: { type: "number" },
            unit: { type: "string" },
            role: { type: "string", enum: [...DRAFT_RECORD_ROLES] },
            direction: { type: "string", enum: [...DRAFT_RECORD_DIRECTIONS] },
            // Design note 5. `option` only; the projector ignores it elsewhere.
            is_baseline: { type: "boolean" },
          },
          required: ["kind", "source_quote"],
          additionalProperties: false,
        },
      },
      claims: {
        type: "array",
        // NO minItems — see design note 2. This absence is load-bearing.
        items: buildDraftClaimItemSchema(),
      },
    },
    required: ["stated_items", "claims"],
    additionalProperties: false,
  };
}

/**
 * The `claims[]` ITEM schema, factored out as its own builder.
 *
 * ⭐ WHY IT IS SEPARATE. The two-pass completion turn emits CLAIMS ONLY, and its
 * grammar must be this exact shape. Restating it there would be a second copy of
 * the model-facing contract (trap 12) — and the copy that drifts is the one the
 * SECOND pass uses, which is the pass nobody has a banked corpus for. So the
 * completion grammar is BUILT FROM THIS FUNCTION and cannot diverge.
 */
export function buildDraftClaimItemSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      // Built from DRAFT_RECORD_CLAIM_DISCRIMINATOR so the streaming progress
      // probe and this schema cannot drift apart.
      [DRAFT_RECORD_CLAIM_DISCRIMINATOR]: { type: "string", enum: [...DRAFT_RECORD_CLAIM_KINDS] },
      label: { type: "string" },
      basis: { type: "array", items: { type: "integer" } },
      // Typed reference fields — the namespace IS the field (design note 1b).
      // Keyed from DRAFT_RECORD_REF_FIELDS so the projector's resolver, the
      // seam's carried-key set and the streaming edge probe all move together.
      [DRAFT_RECORD_REF_FIELDS.fromStated]: { type: "integer" },
      [DRAFT_RECORD_REF_FIELDS.fromClaim]: { type: "integer" },
      [DRAFT_RECORD_REF_FIELDS.toStated]: { type: "integer" },
      [DRAFT_RECORD_REF_FIELDS.toClaim]: { type: "integer" },
      effect: { type: "string", enum: [...DRAFT_RECORD_EFFECTS] },
      strength: { type: "number" },
      category: { type: "string", enum: [...DRAFT_RECORD_CATEGORIES] },
      value: { type: "number" },
      // Option→factor intervention level. See the interface note: named apart
      // from `strength` on purpose.
      sets_to: { type: "number" },
      // Design note 5. `option_refinement` only; ignored on other claim kinds.
      is_baseline: { type: "boolean" },
    },
    required: [DRAFT_RECORD_CLAIM_DISCRIMINATOR, "label"],
    additionalProperties: false,
  };
}

/**
 * Every property key the `claims[]` item schema declares, DERIVED from the
 * schema itself.
 *
 * This is the completeness source for `seam.ts`'s field-by-field rebuild. That
 * rebuild is a hand-written list, and it HAS already drifted: `sets_to` shipped
 * on the wire and in the projector while the seam silently discarded it, so no
 * live draft ever produced an intervention and every test agreed, because every
 * interventions test calls the projector directly. A derived guard turns the
 * next such omission into a red instead of a dark capability.
 */
export function draftClaimSchemaKeys(): readonly string[] {
  const props = (buildDraftClaimItemSchema() as { properties: Record<string, unknown> }).properties;
  return Object.keys(props).sort();
}

/** The same, for `stated_items[]`. */
export function draftStatedItemSchemaKeys(): readonly string[] {
  const schema = buildDraftRecordsSchema() as {
    properties: { stated_items: { items: { properties: Record<string, unknown> } } };
  };
  return Object.keys(schema.properties.stated_items.items.properties).sort();
}

// ── Static budget instruments (C-K0's cheap half) ───────────────────────────

/**
 * Anthropic's published static limits, and the empirically-bisected grammar-size
 * boundary. The bytes budget is the repo's own pin (3400) — deliberately reused
 * rather than re-derived, because it is the number the graph schema's live
 * probes calibrated.
 */
export const ANTHROPIC_OPTIONAL_PARAM_LIMIT = 24;
export const ANTHROPIC_UNION_PARAM_LIMIT = 16;
export const SERIALIZED_BYTES_BUDGET = 3400;
/** Anthropic accepts these and only these (live-probed; `minItems: 4` → 400). */
export const MIN_ITEMS_ALLOWED_VALUES = [0, 1] as const;

/** Count properties NOT listed in their object's `required` array. */
export function countOptionalParams(obj: unknown): number {
  if (obj === null || typeof obj !== "object") return 0;
  if (Array.isArray(obj)) return obj.reduce((n: number, v) => n + countOptionalParams(v), 0);
  const rec = obj as Record<string, unknown>;
  let count = 0;
  if (rec.type === "object" && rec.properties && typeof rec.properties === "object") {
    const props = Object.keys(rec.properties as Record<string, unknown>);
    const req = new Set(Array.isArray(rec.required) ? (rec.required as string[]) : []);
    count += props.filter((p) => !req.has(p)).length;
  }
  for (const v of Object.values(rec)) count += countOptionalParams(v);
  return count;
}

/** Count fields typed by `anyOf` or a `type: [...]` array. */
export function countUnionParams(obj: unknown): number {
  if (obj === null || typeof obj !== "object") return 0;
  if (Array.isArray(obj)) return obj.reduce((n: number, v) => n + countUnionParams(v), 0);
  const rec = obj as Record<string, unknown>;
  let count = 0;
  if (Array.isArray(rec.anyOf) || Array.isArray(rec.type)) count += 1;
  for (const v of Object.values(rec)) count += countUnionParams(v);
  return count;
}

/** Count `type: "object"` schemas — the bisect's dominant compile-cost proxy. */
export function countObjectSchemas(obj: unknown): number {
  if (obj === null || typeof obj !== "object") return 0;
  if (Array.isArray(obj)) return obj.reduce((n: number, v) => n + countObjectSchemas(v), 0);
  const rec = obj as Record<string, unknown>;
  let count = rec.type === "object" ? 1 : 0;
  for (const v of Object.values(rec)) count += countObjectSchemas(v);
  return count;
}

/** Every `minItems` value present, so a disallowed one fails loud. */
export function collectMinItemsValues(obj: unknown): number[] {
  if (obj === null || typeof obj !== "object") return [];
  if (Array.isArray(obj)) return obj.flatMap((v) => collectMinItemsValues(v));
  const rec = obj as Record<string, unknown>;
  const out: number[] = [];
  if (typeof rec.minItems === "number") out.push(rec.minItems);
  for (const v of Object.values(rec)) out.push(...collectMinItemsValues(v));
  return out;
}

/** Keywords the structured-outputs grammar compiler rejects outright. */
export const FORBIDDEN_SCHEMA_KEYWORDS = [
  "minimum",
  "maximum",
  "pattern",
  "maxItems",
  "minLength",
  "maxLength",
  "multipleOf",
  "format",
  "$ref",
  "oneOf",
  "allOf",
] as const;

export function findForbiddenKeywords(obj: unknown): string[] {
  if (obj === null || typeof obj !== "object") return [];
  if (Array.isArray(obj)) return obj.flatMap((v) => findForbiddenKeywords(v));
  const rec = obj as Record<string, unknown>;
  const out: string[] = [];
  for (const k of Object.keys(rec)) {
    if ((FORBIDDEN_SCHEMA_KEYWORDS as readonly string[]).includes(k)) out.push(k);
  }
  for (const v of Object.values(rec)) out.push(...findForbiddenKeywords(v));
  return out;
}

/** Every `type: "object"` must carry `additionalProperties: false`. Returns offenders' paths. */
export function findObjectsMissingAdditionalPropertiesFalse(obj: unknown, path = "$"): string[] {
  if (obj === null || typeof obj !== "object") return [];
  if (Array.isArray(obj)) return obj.flatMap((v, i) => findObjectsMissingAdditionalPropertiesFalse(v, `${path}[${i}]`));
  const rec = obj as Record<string, unknown>;
  const out: string[] = [];
  if (rec.type === "object" && rec.additionalProperties !== false) out.push(path);
  for (const [k, v] of Object.entries(rec)) out.push(...findObjectsMissingAdditionalPropertiesFalse(v, `${path}.${k}`));
  return out;
}

export interface DraftRecordsBudgetReport {
  serializedBytes: number;
  optionalParams: number;
  unionParams: number;
  objectSchemas: number;
  minItemsValues: number[];
  forbiddenKeywords: string[];
  objectsMissingAdditionalPropertiesFalse: string[];
}

export function measureDraftRecordsSchemaBudget(
  schema: Record<string, unknown> = buildDraftRecordsSchema(),
): DraftRecordsBudgetReport {
  return {
    serializedBytes: JSON.stringify(schema).length,
    optionalParams: countOptionalParams(schema),
    unionParams: countUnionParams(schema),
    objectSchemas: countObjectSchemas(schema),
    minItemsValues: collectMinItemsValues(schema),
    forbiddenKeywords: findForbiddenKeywords(schema),
    objectsMissingAdditionalPropertiesFalse: findObjectsMissingAdditionalPropertiesFalse(schema),
  };
}

/**
 * sha256 of the serialised grammar attached to the request.
 *
 * Derived from `buildDraftRecordsSchema()` itself, never from a copy: the hash a
 * run records must be the hash of the object the adapter actually attached, or
 * it is a claim about a different schema.
 */
export function draftRecordsGrammarHash(): string {
  return createHash("sha256")
    .update(JSON.stringify(buildDraftRecordsSchema()), "utf8")
    .digest("hex");
}
