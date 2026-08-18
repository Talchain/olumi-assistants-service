#!/usr/bin/env node
/**
 * THE STRUCTURAL-DELETE ACCEPTANCE WITNESS (Canonical State / Transactional
 * Editing — the domain's stated exit condition).
 *
 * WHY THIS EXISTS
 * ---------------
 * The founder's defect, in his words: *"Every time I try to re-run the analysis,
 * it fails because it keeps adding the option that I deleted back."* The CEE
 * server half (`system-events/structural-delete.ts`) is merged and deployed. A
 * merged writer is not a closed domain — the board's standing rule is that a
 * status may not improve on merged code alone. This script is the mechanism that
 * turns "the code is merged" into "the journey was witnessed", by DRIVING the
 * acceptance over HTTP against the DEPLOYED staging service:
 *
 *   delete an option → acknowledged truthfully → the persisted canonical graph
 *   changes → rerun → the option is still gone → reload → still gone
 *
 * …plus the four negatives the acceptance names: no silent HTTP 200, no second
 * add-option authority, no misuse of `direct_graph_edit`, atomic batched delete
 * semantics preserved.
 *
 * WHAT IT DELIBERATELY IS NOT
 * ---------------------------
 * It is NOT a browser test. The UI client half (DecisionGuideAI #763) is open
 * and unmerged, so a browser arm cannot run yet. Every leg is wire-level against
 * CEE. `LEG_COVERAGE` states, per leg, what the wire version proves; the leg
 * where the distinction bites is RELOAD, and `RELOAD_EPISTEMICS` states it in
 * full. The witness proves the DELETE journey and is silent about every other
 * path.
 *
 * DESIGN — the assertions are exported PURE functions
 * ---------------------------------------------------
 * Same idiom as `staging-journey-smoke.mjs`, for the same reason. Every
 * `assert*` takes parsed data and returns findings; it does no I/O. That lets
 * the committed spec feed each one a REAL post-delete capture (must PASS) and
 * the REAL pre-delete capture of the same scenario (must FAIL, with named
 * signatures) — a positive control, so an ABSENCE assertion can never pass by
 * testing nothing. This estate once shipped a leak test that captured zero bytes
 * and passed every assertion vacuously. There is no fixture mode on the CLI: the
 * CLI always drives real HTTP, because a smoke test against mocks proves nothing
 * about a deployed service.
 *
 * THREE RULES THE ASSERTIONS BELOW OBEY, EACH BECAUSE OF A MEASURED DEFECT:
 *
 *   1. EVERY ABSENCE IS PAIRED WITH A PRESENCE, ON THE SAME PAYLOAD.
 *      `assertModelWithout` never only checks that the deleted id is gone; it
 *      checks that a NAMED survivor is still there. A response carrying nothing
 *      satisfies "the option is absent" perfectly, and a witness that accepted
 *      it would report wholesale model loss as a successful deletion.
 *
 *   2. BIND BY IDENTITY, NEVER BY COUNT. `options.length === 3` is satisfied by
 *      any three options and cannot tell "the right option went" from "a
 *      different option went". Every check names an exact node id.
 *
 *   3. A CHECK THAT COULD NOT HAVE FAILED IS NOT A PASS. The orphan-reference
 *      assertion measures, BEFORE the delete, how many references to the target
 *      the model actually held. Zero means the check was vacuous, and the leg
 *      reports UNKNOWN — never PASS. Deleting an OPTION cannot orphan an
 *      intervention (interventions are keyed on FACTOR ids), so without this
 *      counter the orphan leg would be a guard agreeing with itself on every run.
 *
 * USAGE
 *   node scripts/ci/staging-structural-delete-witness.mjs
 * ENV
 *   WITNESS_BASE_URL     (required) e.g. https://cee-staging.onrender.com
 *   WITNESS_API_KEY      (required) value for the X-Olumi-Assist-Key header
 *   WITNESS_EXPECT_SHA   (optional) commit expected to be serving; enables the
 *                        deploy-freshness assertion. Without it the witness
 *                        still RECORDS the served build and every per-turn
 *                        build_sha, so the report always names the build tested.
 *   WITNESS_SUPABASE_URL (optional) enables the CANONICAL-DB leg — a read of
 *   WITNESS_SUPABASE_KEY (optional) `scenarios.graph` that does not go through
 *                        CEE at all. It is the only surface on which
 *                        `options[]`, `meta.roots` and `meta.leaves` are
 *                        observable. Without BOTH, those sub-claims report
 *                        UNKNOWN, never PASS.
 *   WITNESS_TURN_TIMEOUT_MS      (default 300000)
 *   WITNESS_FRESHNESS_TIMEOUT_MS (default 900000)
 *
 * This script reads and writes NO repository files, and writes nothing to disk
 * at all — which is what makes the workflow's sparse checkout honest. The
 * committed spec fixtures were produced by a throwaway wrapper around these same
 * exports, not by a capture mode living in the CI path.
 *
 * COST: exactly ONE staging scenario row per run.
 */

/* ------------------------------------------------------------------ */
/* Epistemics — in code, so a reader cannot take a leg's scope from a  */
/* summary that has drifted away from it.                              */
/* ------------------------------------------------------------------ */

/**
 * WHAT "RELOAD" MEANS AT THE WIRE, EXACTLY.
 *
 * A browser reload re-hydrates a client store. This witness has no browser, so
 * it cannot make that claim and does not. What it CAN claim is stronger than it
 * first looks, and both halves are DERIVED from the producer rather than assumed:
 *
 *   1. The UI sends a TURN, never a graph — CEE reloads its own persisted graph
 *      on every turn (`loadPersistedGraphStrict`). There is no client-held graph
 *      anywhere in this witness's loop, so nothing here can be a cached client
 *      object by construction.
 *   2. `scenarios.*` is NOT cached by CEE. `supabase-store.ts:1680-1692` says so
 *      in terms: *"scenarios.* fields are NOT cached by SessionLRUCache (which is
 *      scoped to v5_conversation_turns). Every call hits Supabase directly."*
 *
 * So the wire RELOAD leg proves: a NEW turn, on a NEW connection, with a NEW
 * turn_id, served from an UNCACHED SELECT of the canonical row, does not name the
 * deleted option. It does NOT prove the browser leg — that the UI, after a page
 * refresh, renders a canvas without the option. That is #763's half and needs a
 * browser arm. Where `WITNESS_SUPABASE_*` is configured, CANONICAL-DB settles the
 * remaining question at the row itself, with CEE out of the path entirely.
 */
export const RELOAD_EPISTEMICS = Object.freeze({
  proves: "a fresh UNCACHED CEE read of scenarios.graph on a new turn and a new connection",
  does_not_prove: "the browser reload leg (UI hydration) — DecisionGuideAI #763 is unmerged",
  strengthened_by: "WITNESS_SUPABASE_* — a direct row read that does not go through CEE",
});

/** Per-leg scope, printed beside the verdict so a PASS is never read wider than it is. */
export const LEG_COVERAGE = Object.freeze({
  BUILD: "which deployed build answered — stamped per turn, not once per run",
  DRAFT: "a fresh session reaches a model with >=2 identifiable options",
  "CONTROL-STALE": "a diverged base hash is REFUSED 409 and writes nothing",
  "CONTROL-DGE": "direct_graph_edit is NOT a second mutation authority",
  DELETE: "one atomic batched event removes the option; the acknowledgement is truthful",
  PERSISTED: "the canonical graph hash moved, and the server agrees it moved",
  ORPHAN: "no surviving reference names a removed node (and the check was exercised)",
  RERUN: "after re-running the analysis the option is still gone",
  RELOAD: RELOAD_EPISTEMICS.proves,
  "CANONICAL-DB": "the persisted row itself, read with CEE out of the path",
});

/**
 * THE ACCEPTANCE CHAIN, CLAUSE BY CLAUSE — which leg entitles the report to say
 * which sentence.
 *
 * WHY THIS EXISTS. The report used to print ONE fixed banner —
 * *"a deleted option was acknowledged truthfully, left the persisted canonical
 * graph, and stayed gone across a rerun and a fresh uncached read"* — whenever
 * no leg had FAILED. UNKNOWN legs did not count. So a run whose RERUN never
 * recomputed and whose CANONICAL-DB was never configured printed that sentence
 * in full and exited 0, asserting two properties it had not measured. This is
 * the acceptance authority for a domain closure; a banner that overstates will
 * eventually be believed.
 *
 * The banner is now DERIVED from this map: a clause is printed as established
 * only when its leg actually PASSED, and every other clause is printed under
 * NOT ESTABLISHED with the verdict that withheld it. Adding a leg to the
 * acceptance chain therefore cannot silently escape the banner, and removing a
 * clause's leg cannot silently strengthen it.
 *
 * The five clauses are the founder's own acceptance, in his order. `ORPHAN` is
 * the leg that carries *"a second delete also succeeds"* — it issues the second
 * `structural_delete` on the same scenario. RERUN does not; RERUN re-runs the
 * ANALYSIS. Those two were conflated on the board once.
 */
export const ACCEPTANCE_CLAUSES = Object.freeze({
  DELETE: "the delete was acknowledged truthfully",
  PERSISTED: "the deletion changed the persisted canonical graph",
  ORPHAN: "a second delete on the same scenario also succeeded, orphaning nothing",
  RERUN: "the option was still gone after re-running the analysis",
  RELOAD: "the option was still gone on a fresh uncached read of the canonical state",
  "CANONICAL-DB": "the persisted row itself agrees, with CEE out of the path",
});

/**
 * Exit codes. INCOMPLETE is deliberately its OWN code, not folded into either
 * neighbour: a caller that treats non-zero as "broken" must not read an
 * unmeasured leg as a defect, and a caller that treats zero as "witnessed" must
 * not read it as a pass. 2 is already spoken for by the preflight refusals
 * (missing secret, production host, unparseable base URL), which must keep it.
 */
export const EXIT = Object.freeze({ PASS: 0, FAIL: 1, PREFLIGHT: 2, INCOMPLETE: 3 });

/**
 * Which UNKNOWN legs get an explicit remedy printed, because the reader can act
 * on them. CANONICAL-DB is the one that matters most: `options[]`, `meta.roots`
 * and `meta.leaves` are NOT emitted on the CEE wire at all
 * (`compose/applied-graph-emit.ts` emits nodes+edges), so when this leg is
 * unconfigured those fields are unverifiable ON EVERY SURFACE — not merely
 * unverified on this run.
 */
const UNKNOWN_REMEDIES = Object.freeze({
  "CANONICAL-DB":
    "set WITNESS_SUPABASE_URL and WITNESS_SUPABASE_KEY. Without them options[], meta.roots and " +
    "meta.leaves are unverifiable ON EVERY SURFACE — they are not on the CEE wire at all — so the " +
    "persisted row is never inspected directly and the closure rests on CEE's own account of itself.",
});

/**
 * Decide the run's outcome from its legs. PURE — no I/O, no process.exit — so
 * the spec can drive every state, including the ones a live run rarely reaches.
 *
 * THE RULE: a PASS requires every acceptance clause's leg to have PASSED and no
 * leg anywhere to be UNKNOWN. An UNKNOWN can never be reported as, or contribute
 * to, a PASS — it yields INCOMPLETE, which is neither.
 *
 * @param {Array<{name?: string, verdict?: string, detail?: string}>} legs
 * @returns {{status: "PASS"|"FAIL"|"INCOMPLETE", exitCode: number, lines: string[]}}
 */
export function decideOutcome(legs) {
  const list = Array.isArray(legs) ? legs.filter((l) => l && typeof l.name === "string") : [];
  const verdictOf = (name) => list.find((l) => l.name === name)?.verdict ?? null;

  const failed = list.filter((l) => l.verdict === "FAIL");
  const unknown = list.filter((l) => l.verdict === "UNKNOWN");
  const recorded = list.filter((l) => l.verdict === "RECORDED");

  /** @type {string[]} */ const established = [];
  /** @type {string[]} */ const withheld = [];
  for (const [leg, clause] of Object.entries(ACCEPTANCE_CLAUSES)) {
    const v = verdictOf(leg);
    if (v === "PASS") established.push(clause);
    else withheld.push(`${leg} [${v ?? "NEVER REACHED"}] — NOT established: ${clause}`);
  }

  const status = failed.length > 0 ? "FAIL" : unknown.length > 0 || withheld.length > 0 || list.length === 0 ? "INCOMPLETE" : "PASS";
  const exitCode = status === "PASS" ? EXIT.PASS : status === "FAIL" ? EXIT.FAIL : EXIT.INCOMPLETE;

  /** @type {string[]} */ const lines = [];
  if (status === "PASS") {
    lines.push(`PASS — the structural_delete acceptance chain was witnessed end to end:`);
    for (const c of established) lines.push(`  + ${c}`);
    lines.push(`This witness covers the DELETE journey and is silent about every other path.`);
  } else {
    lines.push(
      status === "FAIL"
        ? `FAIL — ${failed.length} leg(s) failed. The closure is NOT witnessed.`
        : `INCOMPLETE — no leg failed, but the closure is NOT witnessed: ` +
          `${unknown.length} leg(s) were not measured and ${withheld.length} acceptance clause(s) are unestablished.`,
    );
    lines.push(``, `  ESTABLISHED (${established.length}/${Object.keys(ACCEPTANCE_CLAUSES).length}):`);
    if (established.length === 0) lines.push(`    (nothing)`);
    for (const c of established) lines.push(`    + ${c}`);
    lines.push(``, `  NOT ESTABLISHED — do not report these as witnessed:`);
    if (withheld.length === 0) lines.push(`    (nothing)`);
    for (const w of withheld) {
      lines.push(`    - ${w}`);
      const remedy = UNKNOWN_REMEDIES[w.split(" [")[0]];
      if (remedy) lines.push(`      REMEDY: ${remedy}`);
    }
  }
  if (recorded.length > 0) {
    lines.push(
      ``,
      `  RECORDED, not asserted: ${recorded.map((l) => l.name).join(", ")} — ` +
        `set WITNESS_EXPECT_SHA to turn build freshness into an assertion rather than a note.`,
    );
  }
  return { status, exitCode, lines };
}

/* ------------------------------------------------------------------ */
/* Producer-derived constants — each cites where it came from.         */
/* ------------------------------------------------------------------ */

/** `GraphV3` node kind for a comparable alternative (`src/schemas/cee-v3.ts`). */
const OPTION_KIND = "option";

/**
 * The base-hash-divergence category (`graph-management/reason-codes.ts`, surfaced
 * by `dispatch.ts` as the 409's `details.conflict_category`). The canonical-read
 * probe asserts THIS category, because it is the only arm that provably writes
 * nothing: `structural-delete.ts` returns the conflict before any commit and
 * `dispatch.ts` says *"Append NOTHING"*.
 */
const BASE_HASH_DIVERGED = "BASE_HASH_DIVERGED";

/**
 * A `base_graph_hash` that cannot collide with a real one.
 *
 * The contract types the field `string, minLength 1` with no format, and the
 * stale gate runs BEFORE target resolution (`structural-delete.ts` step 2 before
 * step 3). So this sentinel turns the request into a pure canonical READ: it
 * always short-circuits on the no-write arm and returns the hash the server
 * holds. A hex-looking sentinel would be a lottery ticket against collision, and
 * in a log it would read as if the witness thought it held a real hash.
 */
export const CANONICAL_READ_SENTINEL = "witness-canonical-read-not-a-hash";

/** The production host this witness must never touch. Compared as a parsed hostname. */
const PRODUCTION_HOST = "olumi-assistants-service.onrender.com";

/** A node id that cannot exist, for the read-only probe's required non-empty array. */
const CANONICAL_READ_PROBE_NODE = "witness-canonical-read-probe-node";

/**
 * `run_state.kind` values that mean an analysis ACTUALLY produced a current
 * result. Derived from the producer (`compose/analysis-state-v1.ts:199-245`),
 * whose full vocabulary is refused | blocked | never_run | complete_current |
 * complete_stale | unknown_degraded. Only `complete_current` is a rerun that ran
 * against the model as it now stands.
 */
const RERUN_RECOMPUTED_KINDS = new Set(["complete_current"]);

/**
 * THE SUCCESS DISCRIMINATOR — and it is not the status code.
 *
 * Every refusal arm of `structural_delete` also answers HTTP 200 with non-empty
 * prose (`no_persisted_graph`, `node_target_not_found`, `dangling_edge`,
 * `no_effect`, …). So "200, and the text is not empty" cannot tell a committed
 * deletion from an honest refusal, and a witness keyed on it would bless a
 * refusal as an acceptance.
 *
 * Derived at the producer instead: `dispatch.ts` attaches `draft_graph`
 * (`buildAppliedGraphWireField(graphForReadiness)`) ONLY on the committed-success
 * path, AFTER the post-commit receipt check has proven the removals landed in the
 * committed bytes. No refusal arm sets it. Presence of `draft_graph` on a
 * `structural_delete` response is therefore the server's own receipt that the
 * write happened — an identity-grade discriminator, not a text match.
 */
export function carriedCommittedGraph(body) {
  const g = body?.draft_graph;
  return Boolean(g) && typeof g === "object" && Array.isArray(g.nodes);
}

/* ------------------------------------------------------------------ */
/* Readers                                                             */
/* ------------------------------------------------------------------ */

/** Node objects on a response's applied/drafted graph (`[]` when absent). */
export function graphNodes(body) {
  const n = body?.draft_graph?.nodes;
  return Array.isArray(n) ? n : [];
}

/** Edge objects on a response's applied/drafted graph (`[]` when absent). */
export function graphEdges(body) {
  const e = body?.draft_graph?.edges;
  return Array.isArray(e) ? e : [];
}

/** `from::to` for every edge — the canonical pair form the applier parses. */
export function edgePairs(edgesOrBody) {
  const edges = Array.isArray(edgesOrBody) ? edgesOrBody : graphEdges(edgesOrBody);
  return edges
    .filter((e) => e && typeof e.from === "string" && typeof e.to === "string")
    .map((e) => `${e.from}::${e.to}`);
}

/**
 * The USABLE `option_id`s a response says the model is comparing.
 *
 * Drops unusable ids deliberately — an option object with `option_id` `""`,
 * `null` or absent cannot participate in an identity check, and the contract
 * admits all three (`OptionForAnalysis.id` is a bare `z.string()`). Callers pin
 * that precondition rather than silently judging on a short list.
 */
export function readyOptionIds(body) {
  const opts = body?.analysis_ready?.options;
  return (Array.isArray(opts) ? opts : [])
    .map((o) => o?.option_id)
    .filter((id) => typeof id === "string" && id.length > 0);
}

/** Intervention target ids named by a node/option holder, sorted and de-duplicated. */
export function interventionKeys(holder) {
  const out = new Set();
  for (const field of ["interventions", "raw_interventions"]) {
    const bag = holder?.[field];
    if (bag && typeof bag === "object" && !Array.isArray(bag)) for (const k of Object.keys(bag)) out.add(k);
  }
  return [...out].sort();
}

/** A wire response reduced to the graph shape the scanners take. */
export function wireGraphOf(body) {
  return { nodes: graphNodes(body), edges: graphEdges(body) };
}

/* ------------------------------------------------------------------ */
/* Target selection — deterministic, and it REFUSES rather than guesses */
/* ------------------------------------------------------------------ */

/**
 * Choose the delete targets from a drafted model.
 *
 * Determinism matters twice: the run must be reproducible, and every assertion
 * downstream binds to these exact ids. Sorted by id, never "whichever the model
 * happened to emit first".
 *
 * ⚠ THE PRECONDITION IS DELIBERATELY NARROW, and that is a MEASURED correction.
 * The first version of this function also required two options CARRYING
 * INTERVENTIONS, so the orphan leg would always be exercised. Measured on two
 * consecutive fresh drafts against build 1f5eb2b: one draft synthesised
 * `cee_hypothesis` interventions on every option, the next produced *"No
 * interventions extracted"* on all four and the model was never analysable. A
 * precondition that fails on roughly half of fresh drafts would make this a
 * flaky alarm, and an alarm people learn to ignore is worse than none. So the
 * hard precondition is only what the ACCEPTANCE needs — a target and a surviving
 * twin — and the orphan leg reports honestly on whether it could be exercised.
 *
 * @returns `{ error }` rather than a best guess when the model cannot support
 *   the acceptance. A witness that quietly weakens its own preconditions is how
 *   a vacuous PASS gets written.
 */
export function pickDeleteTargets(body) {
  const nodes = graphNodes(body);
  const optionNodes = nodes
    .filter((n) => n && n.kind === OPTION_KIND && typeof n.id === "string" && n.id.length > 0)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  if (optionNodes.length < 2) {
    return {
      error:
        `cannot bind targets: the drafted model has ${optionNodes.length} identifiable option node(s), ` +
        `and the acceptance needs 2 — one to delete, one to prove the model survived. ` +
        `Total nodes: ${nodes.length}.`,
    };
  }

  const target = optionNodes[0];
  const twin = optionNodes[optionNodes.length - 1];

  // An edge the client ENUMERATES alongside the node it is incident to. Naming
  // it exercises `elideCascadeRedundantRemoveEdges` — the BATCHED path — rather
  // than the single-node path, which is what "atomic batched delete semantics"
  // means here. Deterministic: the lexicographically first incident pair.
  const incidentEdgePairs = edgePairs(body)
    .filter((p) => p.startsWith(`${target.id}::`) || p.endsWith(`::${target.id}`))
    .sort();

  return {
    target: { id: target.id, label: typeof target.label === "string" ? target.label : null },
    twin: { id: twin.id, interventionKeys: interventionKeys(twin) },
    incidentEdgePairs,
    namedEdge: incidentEdgePairs.length > 0 ? incidentEdgePairs[0] : null,
  };
}

/* ------------------------------------------------------------------ */
/* Assertions — pure. Each returns string[]; empty means healthy.      */
/* ------------------------------------------------------------------ */

/**
 * THE CORE PAIR: the named ids are ABSENT and the named ids are PRESENT, read
 * from the SAME payload.
 *
 * Both surfaces are checked when both are available. They have different
 * lifecycles, and collapsing them is how `nodes=0 options=4` once got printed as
 * if it described an incoherent payload; a surface simply not present on this
 * turn is reported as such rather than read as an absence.
 */
export function assertModelWithout(label, body, { absentIds, presentIds }) {
  if (!body || typeof body !== "object") {
    return { observable: false, why: "the response body was not a JSON object", findings: [] };
  }

  const nodeIds = graphNodes(body)
    .map((n) => n?.id)
    .filter((id) => typeof id === "string");
  const optionIds = readyOptionIds(body);
  const hasGraph = carriedCommittedGraph(body);
  const hasOptions = Array.isArray(body?.analysis_ready?.options);

  // ⚠ OBSERVABILITY IS SEPARATE FROM THE VERDICT, and that separation is a
  // MEASURED correction to this file. The first version treated an EMPTY
  // `analysis_ready.options` as a present surface, so a legitimate refusal turn
  // (`run_state.kind: "refused"`, `MISSING_OPTION_VALUE`) — which carries no
  // graph and an empty options array — was reported as *"wholesale loss, not a
  // deletion"*. The very next turn showed the model intact. That message would
  // have sent someone to the wrong subsystem, which is exactly the
  // misattribution this estate keeps paying for. A turn that names NOTHING
  // cannot support an absence claim OR a loss claim: it is UNMEASURED, and the
  // caller must report it as such rather than as either verdict.
  const observable = (hasGraph && nodeIds.length > 0) || (hasOptions && optionIds.length > 0);
  if (!observable) {
    return {
      observable: false,
      why:
        `the response named no model elements at all ` +
        `(draft_graph=${hasGraph ? `${nodeIds.length} nodes` : "absent"}, ` +
        `analysis_ready.options=${hasOptions ? "empty" : "absent"}, ` +
        `exit_path=${body?._diagnostic_trace?.exit_path ?? "?"}). ` +
        `"The deleted option is absent" cannot be told apart from "nothing came back".`,
      findings: [],
    };
  }

  const findings = [];
  for (const id of absentIds) {
    if (hasGraph && nodeIds.includes(id)) {
      findings.push(`${label}: draft_graph still contains the deleted node '${id}' — it came back`);
    }
    if (hasOptions && optionIds.includes(id)) {
      findings.push(
        `${label}: analysis_ready.options still names the deleted option '${id}' — the product is ` +
          `describing a model that includes what the user removed`,
      );
    }
  }
  for (const id of presentIds) {
    // The anti-vacuity anchor. The payload DID name elements (checked above), so
    // a named survivor missing from it is a real loss, not an unmeasured turn.
    const inGraph = hasGraph && nodeIds.includes(id);
    const inOptions = hasOptions && optionIds.includes(id);
    if (!inGraph && !inOptions) {
      findings.push(
        `${label}: this turn names model elements but NOT the surviving element '${id}' ` +
          `(draft_graph=${hasGraph ? nodeIds.join(",") : "absent"}, ` +
          `analysis_ready.options=${hasOptions ? optionIds.join("|") || "empty" : "absent"}). ` +
          `The delete assertions on this turn are vacuous — this is loss, not a deletion.`,
      );
    }
  }
  return { observable: true, why: null, findings };
}

/**
 * Choose a node whose removal will actually EXERCISE the orphan scan.
 *
 * Priority order, and each rung says what it can prove:
 *
 *   1. FACTOR — a factor id that a SURVIVING option's interventions name. This
 *      is the highest-severity class: an orphaned intervention turns a working
 *      analysis into a NON-RETRYABLE refusal. Only available when the draft
 *      synthesised interventions, which — measured across five fresh drafts
 *      against builds 1f5eb2b and 83a1157 — happens on roughly half of them.
 *   2. META — a node id listed in `meta.roots`/`meta.leaves`. Always populated,
 *      but only observable in the persisted row, so this rung needs the
 *      canonical-DB arm. The goal node is excluded: `structural-delete.ts`
 *      deliberately REFUSES to remove it rather than auto-repairing the
 *      reference, so choosing it would test the refusal, not the prune.
 *   3. none — and the leg reports UNKNOWN. A scan with nothing to find is not a
 *      pass.
 */
export function pickOrphanTarget({ wireGraph, dbGraph, twin, excludeIds }) {
  const exclude = new Set(excludeIds);
  const twinFactors = interventionKeys(twin).filter((id) => !exclude.has(id));
  if (twinFactors.length >= 2) {
    return { id: twinFactors[0], mode: "FACTOR", why: null };
  }
  if (dbGraph) {
    const goal = typeof dbGraph.goal_node_id === "string" ? dbGraph.goal_node_id : null;
    const present = new Set(
      (Array.isArray(wireGraph?.nodes) ? wireGraph.nodes : []).map((n) => n?.id).filter((id) => typeof id === "string"),
    );
    const metaIds = ["roots", "leaves"]
      .flatMap((f) => (Array.isArray(dbGraph?.meta?.[f]) ? dbGraph.meta[f] : []))
      .filter((id) => typeof id === "string" && id !== goal && id !== twin?.id && !exclude.has(id) && present.has(id))
      .sort();
    if (metaIds.length > 0) return { id: metaIds[0], mode: "META", why: null };
  }
  return {
    id: null,
    mode: "NONE",
    why:
      `no orphanable target: the surviving option names ${twinFactors.length} intervention target(s) ` +
      `(2 needed), and ${dbGraph ? "meta.roots/meta.leaves offered no eligible non-goal id" : "the canonical-DB arm is not configured, so meta.roots/meta.leaves cannot be read"}`,
  };
}

/**
 * THE ACKNOWLEDGEMENT MUST BE TRUTHFUL — with "truthful" derived from the
 * producer, not from what the copy happens to say today.
 *
 * `structural-delete.ts` `buildConfirmationText` is the authority:
 *   `Removed '<label>' from your model[, along with N connection(s)]. That change
 *    is saved, so it stays removed when you re-run.`
 * The label is resolved from the BASE graph and N is counted base-minus-projected
 * — what actually left, never what was requested.
 *
 * Three things a silent 200 fails:
 *   1. the server's own receipt is present (`carriedCommittedGraph`) — the only
 *      thing separating a commit from an honest refusal, both of which are 200;
 *   2. the prose NAMES the removed element by its exact label. A confirmation
 *      that does not say what went is not an acknowledgement;
 *   3. the connection count it states MATCHES the incident edges the base graph
 *      actually held. A MAGNITUDE check, not a sign check: an ack claiming
 *      "1 connection" about a 4-edge cascade is a false receipt, and every other
 *      assertion here would wave it through.
 */
export function assertTruthfulAcknowledgement(label, status, body, expected) {
  if (status !== 200) {
    const d = body?.details ?? {};
    return [
      `${label}: HTTP ${status} (expected 200). error=${body?.error ?? "?"} ` +
        `conflict_category=${d.conflict_category ?? "?"} reason=${d.reason ?? "?"}`,
    ];
  }
  const f = [];
  const text = typeof body?.assistant_text === "string" ? body.assistant_text : "";

  if (!carriedCommittedGraph(body)) {
    return [
      `${label}: HTTP 200 with NO applied graph on the response. Every refusal arm of ` +
        `structural_delete also answers 200, so this is a refusal or a silent acknowledgement, not ` +
        `a committed deletion. assistant_text=${JSON.stringify(text.slice(0, 200))}`,
    ];
  }
  if (text.trim().length === 0) {
    f.push(`${label}: the deletion committed and the product said NOTHING — a silent HTTP 200`);
  }
  if (typeof expected.label === "string" && expected.label.length > 0 && !text.includes(expected.label)) {
    f.push(
      `${label}: the acknowledgement does not name what was removed. Expected the label ` +
        `${JSON.stringify(expected.label)} in the prose; got ${JSON.stringify(text.slice(0, 200))}`,
    );
  }
  const stated = /along with (\d+) connection/.exec(text);
  const statedCount = stated ? Number(stated[1]) : /connection/.test(text) ? Number.NaN : 0;
  if (Number.isNaN(statedCount)) {
    f.push(
      `${label}: the acknowledgement mentions connections but states no count: ` +
        `${JSON.stringify(text.slice(0, 200))}`,
    );
  } else if (statedCount !== expected.incidentEdgeCount) {
    f.push(
      `${label}: the acknowledgement says ${statedCount} connection(s) went, but the base graph held ` +
        `${expected.incidentEdgeCount} edge(s) incident to '${expected.id}'. A receipt whose magnitude ` +
        `is wrong is a false receipt.`,
    );
  }
  return f;
}

/**
 * ATOMIC BATCHED DELETE SEMANTICS, asserted on the bytes that came back.
 *
 * Three claims, and the second and third are the twins of the first — a cascade
 * that took everything would satisfy "the incident edges are gone" perfectly:
 *   1. every edge incident to a removed node is gone;
 *   2. every edge NOT incident to one survives, named individually;
 *   3. no surviving edge has an endpoint that no longer exists. That is the
 *      postcondition a partial apply violates, and it is strictly worse than not
 *      applying at all — the model becomes incoherent rather than unchanged.
 */
export function assertBatchAtomicity(label, body, baseEdgePairs, removedNodeIds) {
  if (!carriedCommittedGraph(body)) {
    return [`${label}: no applied graph on the response — batch atomicity cannot be judged`];
  }
  const f = [];
  const removed = new Set(removedNodeIds);
  const after = new Set(edgePairs(body));
  const incident = baseEdgePairs.filter((p) => {
    const [from, to] = p.split("::");
    return removed.has(from) || removed.has(to);
  });

  for (const p of incident) {
    if (after.has(p)) f.push(`${label}: edge '${p}' is incident to a removed node but SURVIVED — dangling`);
  }
  for (const p of baseEdgePairs) {
    if (incident.includes(p)) continue;
    if (!after.has(p)) {
      f.push(
        `${label}: edge '${p}' touches nothing that was removed but is GONE — the cascade over-reached, ` +
          `which is a worse defect than the one being fixed`,
      );
    }
  }
  const ids = new Set(
    graphNodes(body)
      .map((n) => n?.id)
      .filter((id) => typeof id === "string"),
  );
  for (const p of edgePairs(body)) {
    const [from, to] = p.split("::");
    if (!ids.has(from) || !ids.has(to)) {
      f.push(
        `${label}: surviving edge '${p}' has an endpoint that is not in the graph — referential ` +
          `integrity is broken`,
      );
    }
  }
  return f;
}

/**
 * NO SURVIVING REFERENCE NAMES A REMOVED NODE.
 *
 * ⭐ Why this is not tidiness, in the words of the module that does the pruning:
 * an orphaned intervention *"TURNS A WORKING ANALYSIS INTO A REFUSAL"*. Deleting
 * a factor removes its cap from the scale map, the canonical
 * `{value, raw_value}` shape then projects the RAW magnitude instead of the unit
 * value, the request projection reports `mixedUnresolved: true`, and the run is
 * refused NON-RETRYABLY — naming a factor that is no longer in the user's model.
 *
 * @param scopeLabel names the surface scanned, because the wire and the database
 *   expose DIFFERENT field sets. The wire's `draft_graph` carries `nodes` and
 *   `edges` ONLY (`compose/applied-graph-emit.ts`), so `options[].interventions`,
 *   `meta.roots` and `meta.leaves` are NOT observable there. Reporting "no
 *   orphans" from a wire scan alone would be an absence claim about fields the
 *   probe cannot see.
 */
export function assertNoOrphanedReferences(scopeLabel, graph, removedNodeIds) {
  const f = [];
  const removed = new Set(removedNodeIds);
  const scan = (holder, where) => {
    for (const field of ["interventions", "raw_interventions"]) {
      const bag = holder?.[field];
      if (!bag || typeof bag !== "object" || Array.isArray(bag)) continue;
      for (const key of Object.keys(bag)) {
        if (removed.has(key)) {
          f.push(
            `${scopeLabel}: ${where}.${field} still has a key naming the removed node '${key}' — an ` +
              `orphaned intervention turns a later analysis into a non-retryable refusal`,
          );
        }
      }
    }
  };
  for (const n of Array.isArray(graph?.nodes) ? graph.nodes : []) scan(n, `nodes['${n?.id}']`);
  for (const o of Array.isArray(graph?.options) ? graph.options : []) {
    scan(o, `options['${o?.id}']`);
    if (typeof o?.id === "string" && removed.has(o.id)) {
      // The P0 wearing a different field name: GraphV3 carries options in TWO
      // places, and live CEE readers PREFER the top-level roster.
      f.push(`${scopeLabel}: options[] still lists the removed option '${o.id}'`);
    }
  }
  const meta = graph?.meta;
  if (meta && typeof meta === "object") {
    for (const field of ["roots", "leaves"]) {
      const list = meta[field];
      if (!Array.isArray(list)) continue;
      for (const id of list) {
        if (typeof id === "string" && removed.has(id)) {
          f.push(`${scopeLabel}: meta.${field} still names the removed node '${id}'`);
        }
      }
    }
  }
  if (typeof graph?.goal_node_id === "string" && removed.has(graph.goal_node_id)) {
    f.push(`${scopeLabel}: goal_node_id still names the removed node '${graph.goal_node_id}'`);
  }
  return f;
}

/**
 * How many references to `nodeIds` a graph carries — the precondition the orphan
 * assertion needs, measured BEFORE the delete on the SAME surface.
 *
 * Pinned in code, not in a comment (a discriminator whose power depends on a
 * fixture nothing asserts is one that can silently stop discriminating). This is
 * what turns "no orphans found" from a hope into a measurement: zero references
 * beforehand means the scan could not have failed.
 */
export function countReferencesTo(graph, nodeIds) {
  const wanted = new Set(nodeIds);
  let n = 0;
  const scan = (holder) => {
    for (const field of ["interventions", "raw_interventions"]) {
      const bag = holder?.[field];
      if (!bag || typeof bag !== "object" || Array.isArray(bag)) continue;
      for (const key of Object.keys(bag)) if (wanted.has(key)) n += 1;
    }
  };
  for (const node of Array.isArray(graph?.nodes) ? graph.nodes : []) scan(node);
  for (const o of Array.isArray(graph?.options) ? graph.options : []) {
    scan(o);
    if (typeof o?.id === "string" && wanted.has(o.id)) n += 1;
  }
  for (const field of ["roots", "leaves"]) {
    const list = graph?.meta?.[field];
    if (Array.isArray(list)) for (const id of list) if (typeof id === "string" && wanted.has(id)) n += 1;
  }
  if (typeof graph?.goal_node_id === "string" && wanted.has(graph.goal_node_id)) n += 1;
  return n;
}

/**
 * The surviving twin's interventions are INTACT — key-set equality against the
 * pre-delete baseline, minus whatever this delete legitimately removed.
 *
 * The opposite-direction twin of the prune. A prune that also took the survivor's
 * interventions would leave every absence check perfectly green while quietly
 * destroying the rest of the model.
 */
export function assertTwinInterventionsIntact(label, body, twinId, expectedKeys) {
  const node = graphNodes(body).find((n) => n?.id === twinId);
  if (!node) return [`${label}: the surviving option '${twinId}' is not on the applied graph at all`];
  const got = interventionKeys(node);
  const want = [...expectedKeys].sort();
  const f = [];
  const missing = want.filter((k) => !got.includes(k));
  const extra = got.filter((k) => !want.includes(k));
  if (missing.length > 0) {
    f.push(`${label}: '${twinId}' LOST intervention target(s) ${missing.join(",")} — the delete over-reached`);
  }
  if (extra.length > 0) {
    f.push(`${label}: '${twinId}' GAINED intervention target(s) ${extra.join(",")} — unexpected mutation`);
  }
  return f;
}

/**
 * `direct_graph_edit` must NOT be a second mutation authority.
 *
 * `SYSTEM_EVENT_HANDLING` classifies it `'ack_and_commit'` — a turn row, NO graph
 * write — and that classification IS the acceptance's "no misuse of
 * `direct_graph_edit`" clause. Asserted behaviourally: send one claiming a
 * removal, then read the canonical hash again. If it moved, a client notification
 * just mutated the user's model.
 */
export function assertNotifyDidNotMutate(label, hashBefore, hashAfter) {
  if (hashBefore === null || hashAfter === null) {
    return [
      `${label}: could not read the canonical hash on both sides (before=${hashBefore}, ` +
        `after=${hashAfter}) — the claim is UNPROVEN, not proven`,
    ];
  }
  return hashBefore === hashAfter
    ? []
    : [
        `${label}: a direct_graph_edit notification CHANGED the canonical graph ` +
          `(${hashBefore} -> ${hashAfter}). It is classified 'ack_and_commit' — a turn row and no ` +
          `graph write — so this is a second, unaudited mutation authority.`,
      ];
}

/** The 16-hex analysis-affecting hash shape, so a garbage read cannot pass as one. */
export function looksLikeAnalysisHash(v) {
  return typeof v === "string" && /^[0-9a-f]{16}$/.test(v);
}

/**
 * Did the rerun actually recompute, and — the question that matters — is any
 * refusal ABOUT something the user deleted?
 *
 * Split deliberately. The founder's symptom is a re-run that fails BECAUSE the
 * deleted option came back, so a refusal naming a removed id is a hard failure of
 * THIS domain. A refusal that names nothing removed is a model-readiness
 * condition belonging to the Model Compiler domain; failing the witness on it
 * would make this a flaky alarm about someone else's defect, and an alarm people
 * learn to ignore is worse than no alarm. It is reported, never swallowed.
 */
export function classifyRerun(body, removedIds) {
  const run = body?.analysis_state?.run_state ?? null;
  const kind = typeof run?.kind === "string" ? run.kind : null;
  const blob = JSON.stringify({
    reason: run?.reason_code ?? null,
    blockers: run?.blockers ?? null,
    readiness: body?.analysis_state?.readiness ?? null,
  });
  const namesRemoved = removedIds.filter((id) => blob.includes(id));
  return {
    kind,
    recomputed: kind !== null && RERUN_RECOMPUTED_KINDS.has(kind),
    namesRemoved,
    reason_code: run?.reason_code ?? null,
  };
}

/* ------------------------------------------------------------------ */
/* CLI — real HTTP only.                                               */
/* ------------------------------------------------------------------ */

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;

const uuid = () => globalThis.crypto.randomUUID();
const log = (msg) => process.stdout.write(`${msg}\n`);

/** Leg results, in order, each with its own verdict. Never collapsed into one boolean. */
const legs = [];
/** The scenario this run created, echoed in the report so the row stays findable. */
let witnessScenarioId = null;

/**
 * OBSERVATIONS that are not leg verdicts.
 *
 * A concurrent-writer race is a real product finding and must appear in the
 * report — but failing the alarm on it would make this flaky about a BACKGROUND
 * writer rather than about the delete, and an alarm people learn to ignore is
 * worse than no alarm. So it is recorded loudly and separately, never absorbed.
 */
const notes = [];

/**
 * On a leg whose whole point is a committed receipt (DELETE, ORPHAN), a turn that
 * names no model elements is a FAILURE, not an unmeasured turn — the server is
 * contractually required to return the applied graph there.
 */
function requireObservable(legName, r) {
  if (r.observable) return r.findings;
  return [`${legName}: ${r.why} A committed deletion must return its applied graph.`];
}

function noteCasConflicts(legName, outcome) {
  if (!outcome?.casConflicts?.length) return;
  const committed = outcome.res?.status === 200;
  notes.push(
    `${legName}: the deletion was refused ${outcome.casConflicts.length} time(s) with ` +
      `409 GRAPH_DIVERGED / rpc_cas_conflict / retryable:false / assistant_text:"" ` +
      `${committed ? `before committing on attempt ${outcome.attempts}` : `and never committed`}. ` +
      `The base_graph_hash sent was the value the server itself reported moments earlier, so the ` +
      `client was NOT stale — the refusal comes from the in-transaction identity CAS. ` +
      `Whether that is a race or a permanent mismatch is settled by the ROOT-CAUSE READ in the leg ` +
      `finding (needs the canonical-DB arm). Either way a real client obeying retryable:false stops ` +
      `here, and the user's deletion silently does not happen. [${outcome.casConflicts.join("; ")}]`,
  );
}

function recordLeg(name, verdict, detail, findings = []) {
  legs.push({ name, verdict, detail, findings });
  log(`\n[${verdict}] ${name} — ${LEG_COVERAGE[name] ?? ""}`);
  if (detail) log(`   ${detail}`);
  for (const m of findings) log(`   x ${m}`);
}

async function postTurn(base, key, payload, timeoutMs) {
  const started = Date.now();
  const res = await fetch(`${base}/orchestrate/v2/turn`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Olumi-Assist-Key": key },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { __unparseable: text.slice(0, 500) };
  }
  return { status: res.status, body, ms: Date.now() - started };
}

/**
 * READ the canonical persisted graph hash, writing nothing. See
 * `CANONICAL_READ_SENTINEL`. Asserting the conflict CATEGORY is what makes this a
 * read rather than a hope: `BASE_HASH_DIVERGED` is the arm that returns before
 * any commit. Any other category means the request went somewhere else and the
 * value must not be trusted.
 */
async function readCanonicalHash(ctx) {
  const r = await postTurn(
    ctx.base,
    ctx.key,
    {
      kind: "system_event",
      turn_id: uuid(),
      scenario_id: ctx.scenarioId,
      stage: "analyse",
      event: {
        kind: "structural_delete",
        removed_node_ids: [CANONICAL_READ_PROBE_NODE],
        removed_edges: [],
        base_graph_hash: CANONICAL_READ_SENTINEL,
      },
    },
    ctx.turnTimeout,
  );
  const d = r.body?.details ?? {};
  if (r.status !== 409 || d.conflict_category !== BASE_HASH_DIVERGED) {
    return { hash: null, why: `status=${r.status} conflict_category=${d.conflict_category ?? "?"}` };
  }
  const hash = d.expected_base_graph_hash ?? null;
  return looksLikeAnalysisHash(hash)
    ? { hash, why: null }
    : { hash: null, why: `expected_base_graph_hash was not a 16-hex analysis hash: ${JSON.stringify(hash)}` };
}

/**
 * The stored CAS column, read with CEE out of the path.
 *
 * This is the diagnostic that turns "409 rpc_cas_conflict" from a symptom into a
 * root cause. The in-transaction CAS compares the identity hash CEE derives from
 * its own read of `scenarios.graph` against the `scenarios.graph_identity_hash`
 * column. If the two disagree at rest, no client value can ever satisfy the gate,
 * and the refusal is permanent rather than a race — a distinction nothing in the
 * 409 payload lets you make.
 */
async function readCasColumn(ctx) {
  if (!ctx.dbUrl || !ctx.dbKey) return { error: "canonical-DB arm not configured" };
  try {
    const res = await fetch(
      `${ctx.dbUrl.replace(/\/$/, "")}/rest/v1/scenarios?id=eq.${encodeURIComponent(ctx.scenarioId)}` +
        `&select=graph_identity_hash,updated_at`,
      { headers: { apikey: ctx.dbKey, Authorization: `Bearer ${ctx.dbKey}` }, signal: AbortSignal.timeout(30000) },
    );
    if (!res.ok) return { error: `row read HTTP ${res.status}` };
    return (await res.json())?.[0] ?? { error: "no scenarios row" };
  } catch (e) {
    return { error: `row read threw: ${e?.name ?? e}` };
  }
}

/** Read `scenarios.graph` with CEE OUT of the path. Optional; never fabricates. */
async function readCanonicalRow(ctx) {
  if (!ctx.dbUrl || !ctx.dbKey) return { graph: null, why: "WITNESS_SUPABASE_URL/KEY not configured" };
  try {
    const res = await fetch(
      `${ctx.dbUrl.replace(/\/$/, "")}/rest/v1/scenarios?id=eq.${encodeURIComponent(ctx.scenarioId)}&select=graph`,
      { headers: { apikey: ctx.dbKey, Authorization: `Bearer ${ctx.dbKey}` }, signal: AbortSignal.timeout(30000) },
    );
    if (!res.ok) return { graph: null, why: `row read HTTP ${res.status}` };
    const rows = await res.json();
    const graph = rows?.[0]?.graph ?? null;
    return graph ? { graph, why: null } : { graph: null, why: "no scenarios row, or a null graph" };
  } catch (e) {
    return { graph: null, why: `row read threw: ${e?.name ?? e}` };
  }
}

async function waitForBuild(base, expectSha, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const want = expectSha.slice(0, 7);
  let served = null;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt += 1;
    try {
      const res = await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(20000) });
      served = (await res.json())?.build ?? null;
      if (served && served.slice(0, 7) === want) return { ok: true, served, attempt };
      log(`  [freshness] attempt ${attempt}: serving ${served ?? "?"}, want ${want} — waiting…`);
    } catch (e) {
      log(`  [freshness] attempt ${attempt}: /healthz unreachable (${e.name}) — waiting…`);
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await new Promise((r) => setTimeout(r, Math.min(15000, remaining)));
  }
  return { ok: false, served, attempt };
}

/** build_sha is stamped PER TURN. Render has made a rolled-back parent live mid-run. */
const buildShaOf = (body) => body?._diagnostic_trace?.environment?.build_sha ?? null;

/**
 * The second conflict category — a RACE with a concurrent graph writer, not a
 * stale client.
 *
 * MEASURED 18 Aug 2026 against build 83a1157, and worth stating precisely because
 * it is the one thing in this journey the witness has to handle without hiding.
 * A `structural_delete` issued shortly after a draft can be refused with
 * `409 GRAPH_DIVERGED · conflict_category: rpc_cas_conflict · retryable: false`,
 * even though the client's `base_graph_hash` is exactly what the server reported
 * a moment earlier. The in-transaction CAS compares the IDENTITY hash of the
 * graph CEE read against `scenarios.graph_identity_hash` under the row lock, and
 * something else moved the row in between. Two consequences, both observed:
 *
 *   - it CLEARS on its own. The same delete, on the same scenario, committed
 *     cleanly ~90s later. It is a race, not a stuck state — but three retries
 *     inside a ten-second window all failed, so "just retry immediately" does not
 *     rescue it either;
 *   - the `expected_base_graph_hash` this arm returns is the 64-hex IDENTITY
 *     hash, which is a DIFFERENT hash space from the 16-hex analysis hash the
 *     client must put in `base_graph_hash`. So the recovery value cannot be used
 *     as the field it looks like it is for.
 *
 * The witness therefore RETRIES this category — and REPORTS every retry. Silently
 * absorbing it would hide a live defect; failing on it would make the alarm flaky
 * about a background writer rather than about the delete. A real client obeying
 * `retryable: false` would simply stop, which is the user-facing half.
 */
const RPC_CAS_CONFLICT = "rpc_cas_conflict";
const CAS_RETRY_ATTEMPTS = 3;
const CAS_RETRY_DELAY_MS = 15000;

/**
 * Post a `structural_delete`, re-reading the canonical base hash each attempt,
 * retrying ONLY the concurrent-writer race. Returns the attempts so the caller
 * can report them; it never swallows the observation.
 */
async function postStructuralDelete(ctx, event) {
  const casConflicts = [];
  let last = null;
  for (let attempt = 1; attempt <= CAS_RETRY_ATTEMPTS; attempt++) {
    const canonical = await readCanonicalHash(ctx);
    if (canonical.hash === null) return { res: null, why: canonical.why, casConflicts, attempts: attempt };
    last = await postTurn(
      ctx.base,
      ctx.key,
      {
        kind: "system_event",
        turn_id: uuid(),
        scenario_id: ctx.scenarioId,
        stage: "analyse",
        event: { ...event, base_graph_hash: canonical.hash },
      },
      ctx.turnTimeout,
    );
    if (last.body?.details?.conflict_category !== RPC_CAS_CONFLICT) {
      return { res: last, why: null, casConflicts, attempts: attempt, baseHash: canonical.hash };
    }
    casConflicts.push(
      `attempt ${attempt}: base=${canonical.hash} -> 409 ${RPC_CAS_CONFLICT} ` +
        `(server expected identity ${String(last.body?.details?.expected_base_graph_hash ?? "?").slice(0, 16)}…)`,
    );
    if (attempt < CAS_RETRY_ATTEMPTS) await new Promise((r) => setTimeout(r, CAS_RETRY_DELAY_MS));
  }
  return { res: last, why: null, casConflicts, attempts: CAS_RETRY_ATTEMPTS };
}

async function main() {
  const base = (process.env.WITNESS_BASE_URL ?? "").replace(/\/$/, "");
  const key = process.env.WITNESS_API_KEY ?? "";
  const expectSha = process.env.WITNESS_EXPECT_SHA ?? "";
  const turnTimeout = Number(process.env.WITNESS_TURN_TIMEOUT_MS ?? 300000);
  const freshnessTimeout = Number(process.env.WITNESS_FRESHNESS_TIMEOUT_MS ?? 900000);

  if (!base || !key) {
    log("FATAL: WITNESS_BASE_URL and WITNESS_API_KEY are required.");
    process.exit(2); // fail closed — a missing secret must never read as a pass
  }
  // ⚠ ANCHORED ON THE PARSED HOSTNAME, not a substring of the URL.
  // An unanchored regex over a URL matches anywhere — `https://evil.test/
  // ?x=olumi-assistants-service.onrender.com` would trip it while a genuine
  // production host reached via a redirect would not. Parse, then compare the
  // host exactly (and its subdomains). An unparseable base fails CLOSED: a
  // witness that cannot tell which environment it is pointed at must not run.
  let host;
  try {
    host = new URL(base).hostname.toLowerCase();
  } catch {
    log(`FATAL: WITNESS_BASE_URL is not a valid URL (${base}).`);
    process.exit(2);
  }
  if (host === PRODUCTION_HOST || host.endsWith(`.${PRODUCTION_HOST}`)) {
    log(`FATAL: refusing to run against production (${host}). This witness targets staging.`);
    process.exit(2);
  }

  const ctx = {
    base,
    key,
    turnTimeout,
    scenarioId: uuid(),
    dbUrl: process.env.WITNESS_SUPABASE_URL ?? "",
    dbKey: process.env.WITNESS_SUPABASE_KEY ?? "",
  };
  witnessScenarioId = ctx.scenarioId;
  const dbConfigured = Boolean(ctx.dbUrl && ctx.dbKey);

  log(`# CEE structural_delete acceptance witness`);
  log(`target: ${base}`);
  log(`state class: FRESH — a scenario_id never seen before (${ctx.scenarioId}). A seeded session is`);
  log(`             not evidence about a fresh user. This run creates exactly ONE scenario.`);
  log(`canonical-DB leg: ${dbConfigured ? "CONFIGURED" : "NOT configured — options[]/meta claims report UNKNOWN, never PASS"}`);

  const buildShas = new Set();

  // ── LEG: BUILD ──────────────────────────────────────────────────────────
  let served = null;
  try {
    served = (await (await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(20000) })).json())?.build ?? null;
  } catch {
    served = null;
  }
  if (expectSha) {
    const fresh = await waitForBuild(base, expectSha, freshnessTimeout);
    recordLeg(
      "BUILD",
      fresh.ok ? "PASS" : "FAIL",
      `serving ${fresh.served ?? "unreachable"}, expected ${expectSha.slice(0, 7)}`,
      fresh.ok ? [] : ["the deploy did not ship — every result below would describe the wrong code"],
    );
    if (!fresh.ok) return report();
    served = fresh.served;
  } else {
    recordLeg("BUILD", "RECORDED", `serving build ${served ?? "unreachable"} (no WITNESS_EXPECT_SHA — freshness not asserted)`);
  }

  // ── LEG: DRAFT ──────────────────────────────────────────────────────────
  const t1 = await postTurn(
    base,
    key,
    {
      kind: "message",
      turn_id: uuid(),
      scenario_id: ctx.scenarioId,
      stage: "frame",
      turn_class: "frame",
      source: "composer",
      message: "Should we open a second bakery location in Leeds next quarter?",
    },
    turnTimeout,
  );
  buildShas.add(buildShaOf(t1.body));
  log(
    `\n  turn 1 (frame): HTTP ${t1.status} ${(t1.ms / 1000).toFixed(1)}s ` +
      `exit=${t1.body?._diagnostic_trace?.exit_path} build_sha=${buildShaOf(t1.body)}`,
  );

  // Which turn drafts is a product decision that has changed twice; bind to
  // DELIVERY, never to a turn index.
  let drafting = t1.body;
  if (!carriedCommittedGraph(drafting)) {
    const t2 = await postTurn(
      base,
      key,
      {
        kind: "message",
        turn_id: uuid(),
        scenario_id: ctx.scenarioId,
        stage: "frame",
        turn_class: "propose",
        source: "composer",
        message: "Use your best guess for the rest and draft the model now.",
      },
      turnTimeout,
    );
    buildShas.add(buildShaOf(t2.body));
    log(
      `  turn 2 (draft): HTTP ${t2.status} ${(t2.ms / 1000).toFixed(1)}s ` +
        `exit=${t2.body?._diagnostic_trace?.exit_path} build_sha=${buildShaOf(t2.body)}`,
    );
    if (carriedCommittedGraph(t2.body)) drafting = t2.body;
  }

  const picked = pickDeleteTargets(drafting);
  if (picked.error) {
    recordLeg(
      "DRAFT",
      "FAIL",
      `nodes=${graphNodes(drafting).length} options=${readyOptionIds(drafting).join("|") || "none"}`,
      [picked.error],
    );
    return report();
  }
  const baseEdgePairs = edgePairs(drafting);
  const incidentEdgeCount = picked.incidentEdgePairs.length;
  recordLeg(
    "DRAFT",
    "PASS",
    `nodes=${graphNodes(drafting).length} edges=${baseEdgePairs.length} ` +
      `options=${readyOptionIds(drafting).join("|") || "none"}\n   ` +
      `TARGET='${picked.target.id}' label=${JSON.stringify(picked.target.label)} incident_edges=${incidentEdgeCount}\n   ` +
      `TWIN='${picked.twin.id}' interventions=[${picked.twin.interventionKeys.join(",") || "none"}]\n   ` +
      `named_edge=${picked.namedEdge ?? "none"}`,
  );

  // Pre-delete reference baselines, per surface. Measured BEFORE anything is
  // removed, because "no orphans afterwards" says nothing unless there was
  // something to orphan.
  const preDeleteRow = await readCanonicalRow(ctx);
  const baselineDbRefs = preDeleteRow.graph ? countReferencesTo(preDeleteRow.graph, [picked.target.id]) : null;

  // ── LEG: CONTROL-STALE ──────────────────────────────────────────────────
  // A delete the server MUST refuse, proving the live path can say no and that a
  // refusal changes nothing. Without it the acceptance is a script that has only
  // ever been shown succeeding.
  const hashBeforeControl = await readCanonicalHash(ctx);
  const stale = await postTurn(
    base,
    key,
    {
      kind: "system_event",
      turn_id: uuid(),
      scenario_id: ctx.scenarioId,
      stage: "analyse",
      event: {
        kind: "structural_delete",
        removed_node_ids: [picked.target.id],
        removed_edges: [],
        base_graph_hash: "1111111111111111",
      },
    },
    turnTimeout,
  );
  const hashAfterControl = await readCanonicalHash(ctx);
  {
    const f = [];
    if (stale.status !== 409) f.push(`a diverged base hash answered HTTP ${stale.status}; expected 409`);
    if (stale.body?.error !== "GRAPH_DIVERGED") {
      f.push(`error was ${JSON.stringify(stale.body?.error)}; expected GRAPH_DIVERGED`);
    }
    if (carriedCommittedGraph(stale.body)) f.push("the refusal carried an applied graph — it wrote something");
    if (hashBeforeControl.hash === null || hashAfterControl.hash === null) {
      f.push(
        `could not read the canonical hash on both sides (${hashBeforeControl.why ?? "-"} / ${hashAfterControl.why ?? "-"})`,
      );
    } else if (hashBeforeControl.hash !== hashAfterControl.hash) {
      f.push(`the REFUSED delete changed the canonical graph (${hashBeforeControl.hash} -> ${hashAfterControl.hash})`);
    }
    recordLeg(
      "CONTROL-STALE",
      f.length === 0 ? "PASS" : "FAIL",
      `HTTP ${stale.status} ${stale.body?.error ?? ""} category=${stale.body?.details?.conflict_category ?? "?"}; ` +
        `canonical hash ${hashBeforeControl.hash} -> ${hashAfterControl.hash}`,
      f,
    );
  }

  // ── LEG: CONTROL-DGE ────────────────────────────────────────────────────
  const dgeBefore = await readCanonicalHash(ctx);
  const dge = await postTurn(
    base,
    key,
    {
      kind: "system_event",
      turn_id: uuid(),
      scenario_id: ctx.scenarioId,
      stage: "analyse",
      event: {
        kind: "direct_graph_edit",
        target_id: picked.target.id,
        operation: "remove_node",
        changed_node_ids: [picked.target.id],
        summary: "witness control: a client notification claiming a removal",
      },
    },
    turnTimeout,
  );
  const dgeAfter = await readCanonicalHash(ctx);
  {
    const f = assertNotifyDidNotMutate("CONTROL-DGE", dgeBefore.hash, dgeAfter.hash);
    if (carriedCommittedGraph(dge.body)) {
      f.push("CONTROL-DGE: the notification response carried an applied graph — it behaved like a writer");
    }
    recordLeg(
      "CONTROL-DGE",
      f.length === 0 ? "PASS" : "FAIL",
      `HTTP ${dge.status}; canonical hash ${dgeBefore.hash} -> ${dgeAfter.hash}`,
      f,
    );
  }

  // ── LEG: DELETE ─────────────────────────────────────────────────────────
  const preDeleteHash = await readCanonicalHash(ctx);
  const wireHash = drafting?.graph_hash ?? null;
  if (preDeleteHash.hash !== null && wireHash !== null && preDeleteHash.hash !== wireHash) {
    log(`  note: the turn's wire graph_hash (${wireHash}) and the canonical read (${preDeleteHash.hash}) disagree — using the canonical read`);
  }
  const baseHash = preDeleteHash.hash;
  if (baseHash === null) {
    recordLeg("DELETE", "FAIL", "no base_graph_hash available", [
      `the canonical read yielded no base hash (${preDeleteHash.why})`,
    ]);
    return report();
  }
  const deleted = await postStructuralDelete(ctx, {
    kind: "structural_delete",
    removed_node_ids: [picked.target.id],
    // Naming an incident edge alongside its own node is the BATCHED path: it
    // exercises the cascade elision that a bare single-node delete does not.
    removed_edges: picked.namedEdge
      ? [{ from: picked.namedEdge.split("::")[0], to: picked.namedEdge.split("::")[1] }]
      : [],
  });
  const del = deleted.res;
  if (del === null) {
    recordLeg("DELETE", "FAIL", "no base_graph_hash available", [`canonical read failed: ${deleted.why}`]);
    return report();
  }
  buildShas.add(buildShaOf(del.body));
  noteCasConflicts("DELETE", deleted);
  {
    const f = [
      ...assertTruthfulAcknowledgement("DELETE", del.status, del.body, {
        id: picked.target.id,
        label: picked.target.label,
        incidentEdgeCount,
      }),
      ...requireObservable(
        "DELETE",
        assertModelWithout("DELETE", del.body, { absentIds: [picked.target.id], presentIds: [picked.twin.id] }),
      ),
      ...assertBatchAtomicity("DELETE", del.body, baseEdgePairs, [picked.target.id]),
      ...assertTwinInterventionsIntact("DELETE", del.body, picked.twin.id, picked.twin.interventionKeys),
    ];
    recordLeg(
      "DELETE",
      f.length === 0 ? "PASS" : "FAIL",
      `HTTP ${del.status} ${(del.ms / 1000).toFixed(1)}s base=${deleted.baseHash ?? baseHash} ` +
        `attempts=${deleted.attempts} build_sha=${buildShaOf(del.body)}\n   ` +
        `ack=${JSON.stringify((del.body?.assistant_text ?? "").slice(0, 240))}`,
      f,
    );
    if (f.length > 0) return report();
  }

  // ── LEG: PERSISTED ──────────────────────────────────────────────────────
  const afterDeleteHash = await readCanonicalHash(ctx);
  {
    const f = [];
    if (afterDeleteHash.hash === null) {
      f.push(`the canonical hash was unreadable after the delete (${afterDeleteHash.why})`);
    } else if (afterDeleteHash.hash === baseHash) {
      f.push(
        `the canonical graph hash did not move (${baseHash}) — the acknowledgement claimed a change ` +
          `the persisted state does not show`,
      );
    }
    if (del.body?.graph_hash && afterDeleteHash.hash && del.body.graph_hash !== afterDeleteHash.hash) {
      f.push(`the receipt's graph_hash (${del.body.graph_hash}) is not what the server now holds (${afterDeleteHash.hash})`);
    }
    recordLeg(
      "PERSISTED",
      f.length === 0 ? "PASS" : "FAIL",
      `${baseHash} -> ${afterDeleteHash.hash} (the receipt said ${del.body?.graph_hash})`,
      f,
    );
  }

  // ── LEG: ORPHAN ─────────────────────────────────────────────────────────
  // A second delete, aimed at a node the model ACTUALLY references, because
  // deleting an option cannot orphan an intervention (interventions are keyed on
  // FACTOR ids). See `pickOrphanTarget` for the two modes and what each proves.
  const removedIds = [picked.target.id];
  const orphanPick = pickOrphanTarget({
    wireGraph: wireGraphOf(del.body),
    dbGraph: preDeleteRow.graph,
    twin: { interventions: Object.fromEntries(picked.twin.interventionKeys.map((k) => [k, 0])), id: picked.twin.id },
    excludeIds: [picked.target.id],
  });
  // Defaults to UNKNOWN on purpose: if no branch below can measure the property,
  // the leg must report "not measured", never a pass.
  let orphanVerdict = "UNKNOWN";
  let orphanDetail = `NOT EXERCISED — ${orphanPick.why ?? "no reason recorded"}. A scan with nothing to find is not a pass.`;
  let orphanFindings = [];

  if (orphanPick.id !== null) {
    // Non-vacuity, measured BEFORE the delete, on every surface available.
    const preRefsWire = countReferencesTo(wireGraphOf(del.body), [orphanPick.id]);
    const preRefsDb = preDeleteRow.graph ? countReferencesTo(preDeleteRow.graph, [orphanPick.id]) : null;
    const orphanDeleted = await postStructuralDelete(ctx, {
      kind: "structural_delete",
      removed_node_ids: [orphanPick.id],
      removed_edges: [],
    });
    noteCasConflicts("ORPHAN", orphanDeleted);
    const fdel = orphanDeleted.res;
    if (fdel === null) {
      orphanFindings = [`could not read a base hash for the orphan-exercising delete (${orphanDeleted.why})`];
      orphanDetail = `${orphanPick.mode} mode: the canonical base-hash read failed, so the delete was never attempted`;
      orphanVerdict = "FAIL";
    } else if (fdel.status !== 200 || !carriedCommittedGraph(fdel.body)) {
      const casCol = await readCasColumn(ctx);
      const serverExpected = fdel.body?.details?.expected_base_graph_hash ?? null;
      const casReadable = casCol !== null && casCol.error === undefined;
      orphanDetail =
        `${orphanPick.mode} mode: the second structural_delete on this scenario was REFUSED. ` +
        `attempts=${orphanDeleted.attempts}`;
      orphanFindings = [
        `the orphan-exercising delete of '${orphanPick.id}' (${orphanPick.mode} mode) was NOT committed ` +
          `after ${orphanDeleted.attempts} attempt(s): HTTP ${fdel.status} error=${fdel.body?.error ?? "-"} ` +
          `category=${fdel.body?.details?.conflict_category ?? "-"} ` +
          `text=${JSON.stringify((fdel.body?.assistant_text ?? "").slice(0, 200))}` +
          (fdel.body?.details?.conflict_category !== RPC_CAS_CONFLICT
            ? ""
            : casReadable
              ? `\n     ROOT-CAUSE READ (CEE out of the path): scenarios.graph_identity_hash = ` +
                `${String(casCol.graph_identity_hash ?? "null").slice(0, 24)}… (written ${casCol.updated_at}), ` +
                `while CEE's own read of the SAME row derives ${String(serverExpected ?? "?").slice(0, 24)}…. ` +
                `${casCol.graph_identity_hash !== serverExpected ? "THEY DISAGREE AT REST, so no client value can satisfy the gate and the refusal is PERMANENT, not a race." : "They agree, so this WAS a race with a concurrent writer."}`
              : `\n     ROOT-CAUSE READ NOT AVAILABLE (${casCol?.error ?? "unknown"}) — whether this is a race or a ` +
                `permanent at-rest mismatch is therefore UNKNOWN on this run, not assumed.`),
      ];
      orphanVerdict = "FAIL";
    } else if ((preRefsWire + (preRefsDb ?? 0)) === 0) {
      orphanVerdict = "UNKNOWN";
      orphanDetail =
        `${orphanPick.mode} mode, NOT EXERCISED: '${orphanPick.id}' had ZERO references on every ` +
        `readable surface before the delete, so the scan could not have failed`;
    } else {
      buildShas.add(buildShaOf(fdel.body));
      removedIds.push(orphanPick.id);
      orphanFindings = [
        ...assertNoOrphanedReferences("ORPHAN(wire: draft_graph.nodes only)", wireGraphOf(fdel.body), removedIds),
        ...requireObservable(
          "ORPHAN",
          assertModelWithout("ORPHAN", fdel.body, { absentIds: removedIds, presentIds: [picked.twin.id] }),
        ),
        ...assertTwinInterventionsIntact(
          "ORPHAN",
          fdel.body,
          picked.twin.id,
          picked.twin.interventionKeys.filter((k) => k !== orphanPick.id),
        ),
      ];
      orphanVerdict = orphanFindings.length === 0 ? "PASS" : "FAIL";
      orphanDetail =
        `${orphanPick.mode} mode: removed '${orphanPick.id}', which ${preRefsWire} wire reference(s) and ` +
        `${preRefsDb ?? "unknown"} persisted-row reference(s) named before the delete ` +
        `(non-vacuity precondition, measured). attempts=${orphanDeleted.attempts}`;
    }
  }
  recordLeg(
    "ORPHAN",
    orphanVerdict,
    `${orphanDetail}\n   wire scope covers draft_graph.nodes[].interventions ONLY — options[], ` +
      `meta.roots and meta.leaves are NOT on the wire (compose/applied-graph-emit.ts emits nodes+edges); ` +
      `they are scanned by CANONICAL-DB when that leg is configured`,
    orphanFindings,
  );

  // ── LEG: RERUN ──────────────────────────────────────────────────────────
  const rerun = await postTurn(
    base,
    key,
    {
      kind: "message",
      turn_id: uuid(),
      scenario_id: ctx.scenarioId,
      stage: "analyse",
      turn_class: "decide",
      source: "chip",
      chip: { id: "run-analysis", action_type: "run_analysis" },
      message: "Run the analysis again.",
    },
    turnTimeout,
  );
  buildShas.add(buildShaOf(rerun.body));
  {
    const seen = assertModelWithout("RERUN", rerun.body, { absentIds: removedIds, presentIds: [picked.twin.id] });
    const f = [...seen.findings];
    if (rerun.status !== 200) f.push(`RERUN: HTTP ${rerun.status} (expected 200)`);
    const cls = classifyRerun(rerun.body, removedIds);
    if (cls.namesRemoved.length > 0) {
      f.push(
        `RERUN: the analysis outcome NAMES removed node(s) ${cls.namesRemoved.join(",")} — this is the ` +
          `founder's exact symptom: the rerun is talking about something the user deleted`,
      );
    }
    const verdict = f.length > 0 ? "FAIL" : seen.observable && cls.recomputed ? "PASS" : "UNKNOWN";
    recordLeg(
      "RERUN",
      verdict,
      `HTTP ${rerun.status} ${(rerun.ms / 1000).toFixed(1)}s exit=${rerun.body?._diagnostic_trace?.exit_path} ` +
        `run_state=${JSON.stringify(rerun.body?.analysis_state?.run_state ?? null)}\n   ` +
        `options now=${readyOptionIds(rerun.body).join("|") || "none"}` +
        (seen.observable
          ? ""
          : `\n   NOT MEASURED on this turn: ${seen.why}`) +
        (cls.recomputed
          ? ""
          : `\n   NOT A PASS: the analysis did not recompute (run_state=${cls.kind}, reason=${cls.reason_code}). ` +
            `No blocker names a removed node, so this is a model-readiness condition in the Model ` +
            `Compiler domain, not a delete regression — but the delete has NOT been witnessed across ` +
            `a COMPLETED rerun, and RELOAD below is where durability is actually settled.`),
      f,
    );
  }

  // ── LEG: RELOAD ─────────────────────────────────────────────────────────
  const reload = await postTurn(
    base,
    key,
    {
      kind: "message",
      turn_id: uuid(),
      scenario_id: ctx.scenarioId,
      stage: "analyse",
      turn_class: "clarify",
      source: "composer",
      message: "Which options are we comparing?",
    },
    turnTimeout,
  );
  buildShas.add(buildShaOf(reload.body));
  const reloadHash = await readCanonicalHash(ctx);
  {
    const seen = assertModelWithout("RELOAD", reload.body, { absentIds: removedIds, presentIds: [picked.twin.id] });
    const f = [...seen.findings];
    if (reload.status !== 200) f.push(`RELOAD: HTTP ${reload.status} (expected 200)`);
    recordLeg(
      "RELOAD",
      f.length > 0 ? "FAIL" : seen.observable ? "PASS" : "UNKNOWN",
      `HTTP ${reload.status} options=${readyOptionIds(reload.body).join("|") || "none"} ` +
        `canonical hash=${reloadHash.hash}` +
        (seen.observable ? "" : `\n   NOT MEASURED: ${seen.why}`) +
        `\n   PROVES: ${RELOAD_EPISTEMICS.proves}\n   ` +
        `DOES NOT PROVE: ${RELOAD_EPISTEMICS.does_not_prove}`,
      f,
    );
  }

  // ── LEG: CANONICAL-DB (optional) ────────────────────────────────────────
  {
    const row = await readCanonicalRow(ctx);
    if (row.graph === null) {
      recordLeg(
        "CANONICAL-DB",
        "UNKNOWN",
        `not measured: ${row.why}. options[], meta.roots and meta.leaves are therefore UNVERIFIED — ` +
          `this is not a pass.`,
      );
    } else {
      const f = [];
      const nodeIds = (Array.isArray(row.graph.nodes) ? row.graph.nodes : []).map((n) => n?.id);
      for (const id of removedIds) {
        if (nodeIds.includes(id)) f.push(`CANONICAL-DB: scenarios.graph.nodes still contains '${id}'`);
      }
      if (!nodeIds.includes(picked.twin.id)) {
        f.push(
          `CANONICAL-DB: the surviving option '${picked.twin.id}' is NOT in the persisted row — every ` +
            `absence check above is vacuous`,
        );
      }
      f.push(...assertNoOrphanedReferences("CANONICAL-DB", row.graph, removedIds));
      const exercised = baselineDbRefs === null ? "unknown" : baselineDbRefs;
      recordLeg(
        "CANONICAL-DB",
        f.length === 0 ? (baselineDbRefs === 0 ? "UNKNOWN" : "PASS") : "FAIL",
        `row read with CEE OUT of the path: nodes=${nodeIds.length} ` +
          `options[]=${Array.isArray(row.graph.options) ? row.graph.options.length : "absent"} ` +
          `meta.roots=${JSON.stringify(row.graph?.meta?.roots ?? null)} ` +
          `meta.leaves=${JSON.stringify(row.graph?.meta?.leaves ?? null)}\n   ` +
          `references to '${picked.target.id}' in the row BEFORE the delete: ${exercised}` +
          (baselineDbRefs === 0
            ? " — zero, so this scan could not have failed and is reported UNKNOWN"
            : " (non-vacuity precondition, measured)"),
        f,
      );
    }
  }

  log(`\n## Build identity`);
  log(`  /healthz served: ${served ?? "unreachable"}`);
  log(`  per-turn build_sha values seen: ${[...buildShas].map((s) => s ?? "null").join(", ")}`);
  if ([...buildShas].filter(Boolean).length > 1) {
    log(`  WARNING: more than one build answered this run — the legs do not all describe the same code.`);
  }
  return report();
}

function report() {
  if (notes.length > 0) {
    log(`\n## Observations — real, and deliberately NOT folded into a leg verdict`);
    for (const n of notes) log(`  ! ${n}`);
  }
  log(`\n## Result — scenario ${witnessScenarioId ?? "(none created)"}`);
  const failed = legs.filter((l) => l.verdict === "FAIL");
  const unknown = legs.filter((l) => l.verdict === "UNKNOWN");
  for (const l of legs) log(`  ${l.verdict.padEnd(9)} ${l.name}`);
  if (unknown.length > 0) {
    log(`\n${unknown.length} leg(s) UNKNOWN — not measured, and deliberately NOT counted as a pass:`);
    for (const l of unknown) log(`  ? ${l.name}: ${l.detail.split("\n")[0]}`);
  }
  if (failed.length > 0) {
    log(`\nFindings:`);
    for (const l of failed) for (const m of l.findings) log(`  x ${m}`);
  }
  // The banner and the exit code come from ONE pure decision, so the sentence
  // printed and the status returned cannot disagree. See `decideOutcome`.
  const outcome = decideOutcome(legs);
  log(``);
  for (const line of outcome.lines) log(line);
  process.exit(outcome.exitCode);
}

if (isMain) {
  main().catch((e) => {
    log(`\nFAIL — witness threw: ${e?.stack ?? e}`);
    process.exit(1);
  });
}
