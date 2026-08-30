/**
 * HASH-KEYED WAIVERS.
 *
 * Divergences FOUND and TRIAGED but not fixed in the lane that found them.
 *
 * Each waiver is keyed to the sha256 of the prompt it was ratified against.
 * When that prompt changes -- a PMS re-pin needs no deploy, which is the whole
 * hazard -- every waiver on it EXPIRES and the gate goes RED demanding
 * re-ratification. A waiver can therefore never quietly outlive the bytes it
 * was granted for. The idiom is the one already ratified in this repo by
 * `prompt-pack-sanction.gate.test.ts`; it is reused deliberately rather than
 * reinvented.
 *
 * Two rules the gate enforces, so this list cannot rot in either direction:
 *   - a waiver whose divergence no longer occurs is STALE and REDs (remove it);
 *   - a divergence with no waiver REDs (fix it, or triage and waive it).
 *
 * ⚠ A waiver is a statement that someone LOOKED. It is not a licence to stop
 * looking, and `note` must carry the derivation, not a reassurance.
 */

export interface Waiver {
  /** Route this applies to -- waivers are per-route; ids repeat across routes. */
  readonly route: string;
  /** sha256 of the prompt bytes this was ratified against. */
  readonly promptSha256: string;
  /** Violation `id` from the checker. */
  readonly id: string;
  readonly note: string;
}

/** sha256 of the served bytes each waiver below was ratified against. */
const DRAFT_GRAPH_V195 = '152998b447819c2e9e797b1727f8e05b34480486dca6f672a5d2839facd2353f';
const ROUTING_V121 = 'bec840a6488009284f4bf3c5a6b5ebe604a96ab973946911fec8639af182d949';
const EDIT_GRAPH_V11 = '40b79180ad739011cb1438f64fd2427c73a3647b0c63b5b5a371cdf8705f1bfb';
const REPAIR_EDIT_GRAPH_V2 = 'd641bd276c5f80a82532f78fe85d0ec45addd2d742ffa449ac66e2e6e23f31c0';

/**
 * draft_graph v195: EVERY JSON example in the served prompt instructs a shape
 * `buildDraftRecordsSchema()` accepts nowhere. 11 of 11.
 *
 * This is a REAL, OPEN DEFECT, waived only because fixing it means promoting a
 * new PMS version -- a deploy-and-promote action outside a test lane's remit,
 * and one that must be measured on live drafts before and after. It is NOT
 * benign and must not be read as such.
 *
 * WHAT IS WRONG. The grammar is `required: ["stated_items", "claims"]` with
 * `additionalProperties: false`, so `nodes`, `edges`, `goal_constraints`,
 * `causal_claims` and `coaching` are UNEMITTABLE -- and `isGraphShapedResponse`
 * (src/cee/draft/records/seam.ts:130) types compliance with them as the
 * failure `graph_shaped_response`. The grammar's own required keys appear
 * nowhere in the served bytes; they reach the model only through
 * DRAFT_RECORDS_INSTRUCTION, appended after the cache breakpoint. So the
 * served half of the instruction points away from the only channel through
 * which the user's own words enter the model.
 *
 * THE FIX, when a lane owns the promotion: replace the output-contract half of
 * the prompt with a contract EMITTED FROM `buildDraftRecordsSchema()`, so the
 * served prompt and the grammar cannot diverge again -- the same derivation
 * DRAFT_RECORDS_INSTRUCTION already uses. Do not hand-write it, and do not
 * point the fix at the banked v200, whose change-note names the retired
 * `buildDraftGraphSchema` (nodes/edges/goal_constraints) and would install a
 * fix written against the wrong consumer.
 */
const DRAFT_GRAPH_WAIVERS: readonly Waiver[] = [
  'unacceptable_example:id,kind,label',
  'unacceptable_example:id,kind,label,data,is_baseline',
  'unacceptable_example:id,kind,label,goal_threshold,goal_threshold_raw,goal_threshold_unit,goal_threshold_cap',
  'unacceptable_example:id,kind,label,category,provenance,data',
  'unacceptable_example:id,kind,label,category,provenance,extractionType,factor_type,prior',
  'unacceptable_example:from,to,strength,exists_probability,effect_direction',
  'unacceptable_example:constraint_id,node_id,operator,value,label,unit,source_quote,confidence,provenance',
  'unacceptable_example:nodes,edges,goal_constraints,causal_claims,coaching',
].map((id) => ({
  route: 'draft_graph',
  promptSha256: DRAFT_GRAPH_V195,
  id,
  note:
    'OPEN DEFECT, not benign. The served v195 output contract instructs the GRAPH shape while the ' +
    'attached grammar is the RECORDS shape (required stated_items/claims, additionalProperties:false). ' +
    'Fix = promote a draft_graph version whose output contract is emitted from buildDraftRecordsSchema(). ' +
    'See this file for the full triage.',
}));

/**
 * routing v121: the `<HANDLERS>` block teaches `draft_graph` and `edit_graph`
 * under the heading "Only propose a handler_id available in the current tool
 * set", while `olumi_action`'s `handler_id` enum admits neither.
 *
 * TRIAGED AS DELIBERATE, with a residual. `tool-schema.ts` states the design in
 * terms: "`draft_graph` and `edit_graph` are NOT in V5ActionType -- they are
 * dispatched by the system layer before routing and never reach this tool
 * call." Corroborated independently: `validation-registry.ts` declares exactly
 * the same seven handler ids as the enum, and neither appears. So the model is
 * being taught system vocabulary, not an emittable value.
 *
 * RESIDUAL, deliberately recorded rather than dismissed: the two ids sit inside
 * a list whose own heading tells the model these are things it may propose, and
 * a model that does propose one gets `Unknown handler_id` from validator.ts:326.
 * That is the exact shape of the motivating defect, one step short of firing.
 * Worth a prompt lane; not worth a test lane inventing a behavioural change.
 */
const ROUTING_WAIVERS: readonly Waiver[] = ['draft_graph', 'edit_graph'].map((token) => ({
  route: 'routing',
  promptSha256: ROUTING_V121,
  id: `enum_stray:handler_id:${token}`,
  note:
    'DELIBERATE: dispatched by the system layer before routing, so never emitted as a handler_id ' +
    '(tool-schema.ts, corroborated by validation-registry.ts declaring the same seven ids). ' +
    'RESIDUAL: they are taught under a heading that invites proposing them, and validator.ts:326 ' +
    'rejects one if the model takes the invitation.',
}));

/**
 * edit_graph v11 / repair_edit_graph v2: object fragments the prompt teaches
 * are PAYLOAD-shaped, not grammar-shaped.
 *
 * `ANTHROPIC_EDIT_GRAPH_SCHEMA`'s `operations[].value` is `type: "string"` -- a
 * JSON-encoded blob the grammar explicitly cannot look inside (its own comment:
 * "an opaque JSON string the grammar cannot look inside"). So these fragments
 * are instructed as the CONTENT of that string, and no node of the grammar
 * could ever accept them as objects. The checker is right that the grammar
 * rejects them and right that this is not a divergence to fix here.
 *
 * ⚠ THE FINDING THAT MATTERS IS THE ONE THIS WAIVER EXPOSES: for these two
 * routes the JSON Schema adjudicates almost nothing, so prompt-vs-grammar
 * conformance is nearly vacuous. The real consumer of that payload is the Zod
 * patch validator plus PLoT's canonical field list -- which is what
 * `tests/prompt-contract/prompt-contract.test.ts` checks, against a hand-copied
 * mirror stamped "Last synced: 2026-03-26" and bound to the FALLBACK prompt
 * files rather than the served bytes. Rowing that is the follow-up.
 */
const EDIT_WAIVERS: readonly Waiver[] = [
  { route: 'edit_graph', promptSha256: EDIT_GRAPH_V11, id: 'unacceptable_example:prior' },
  { route: 'edit_graph', promptSha256: EDIT_GRAPH_V11, id: 'unacceptable_example:id,kind,label' },
  {
    route: 'repair_edit_graph',
    promptSha256: REPAIR_EDIT_GRAPH_V2,
    id: 'unacceptable_example:from,to,strength,exists_probability,effect_direction',
  },
].map((w) => ({
  ...w,
  note:
    'PAYLOAD-SHAPED, not grammar-shaped: operations[].value is `type: "string"`, an opaque JSON blob ' +
    'the grammar cannot inspect, so this fragment is instructed as that string\'s CONTENT. The real ' +
    'consumer is the Zod patch validator + PLoT canonical fields, not this JSON Schema.',
}));

export const WAIVERS: readonly Waiver[] = Object.freeze([
  ...DRAFT_GRAPH_WAIVERS,
  ...ROUTING_WAIVERS,
  ...EDIT_WAIVERS,
]);

/** Waivers live for this route AND this exact prompt sha. */
export function activeWaivers(route: string, promptSha256: string): readonly Waiver[] {
  return WAIVERS.filter((w) => w.route === route && w.promptSha256 === promptSha256);
}
