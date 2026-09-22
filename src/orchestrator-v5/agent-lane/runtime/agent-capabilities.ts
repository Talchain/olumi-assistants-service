/**
 * Agent lane — the capabilities, each delegating to an existing Olumi path.
 *
 * ⭐ NOTHING HERE OWNS A RULE. Canonical truth, admissibility, authorisation,
 * CAS, idempotency, persistence and analysis all stay where they already live;
 * these functions carry a request to them and report what came back. Writes and
 * analysis go through the SAME `/orchestrate/v2/turn` the product uses, via an
 * internal dispatch, so the Agent cannot reach a shortcut the UI does not have.
 *
 * ⛔ A MUTATION IS CONFIRMED FROM STATE, NEVER FROM A STATUS CODE. Observed on
 * 22 Sep: a tool that returned success on HTTP 200 made the Agent tell the user
 * "Added: …" while CEE had honestly refused with "I couldn't record that
 * properly, so I haven't changed the model." Every mutating capability below
 * re-reads the model afterwards and reports what the model actually shows.
 */

import { createHash, randomUUID } from 'node:crypto';

/**
 * The durable operation identity for authorising a proposal.
 *
 * ⛔ IT MUST BE A v4-SHAPED UUID. Measured against the real
 * `SystemEventTurnPayloadSchema`: `turn_id` is regex-constrained, and a
 * readable key like `agent_authorise:<proposal_id>` is refused at ingress with
 * `INGRESS_CONTRACT_VIOLATION` before any handler runs. My first version used
 * exactly that readable form; the unit tests passed because the mock dispatch
 * does not validate the payload, and only posting it at the real boundary
 * showed all four calls refused.
 *
 * So this is a NAME-BASED uuid wearing a v4 costume: SHA-256 of the proposal
 * id with the version and variant nibbles forced. It is deterministic — the
 * same proposal always yields the same key, which is the whole point — and it
 * satisfies the wire. The trade is legibility in the turn log for a stable
 * idempotency key, and the stable key is what the replay arm needs.
 */
export function authorisationTurnId(proposalId: string): string {
  const h = createHash('sha256').update(`agent_authorise:${proposalId}`).digest();
  const b = Buffer.from(h.subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = b.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
import { createProposal, ProposalStore, type ProposalOperation } from '../proposal.js';
import { confirmEdgeWrite, describeOutcome } from '../confirm-write.js';
import { structuralFacts } from '../structural-facts.js';
import { defaultFrameFor } from '../admit-model.js';
import type { AgentCapabilities, AgentToolContext, ToolResult } from './agent-tools.js';
import { buildModelFromBrief, type CallStructuredModel } from './build-model.js';

/** One internal dispatch, so every path is the product's own. */
export type InternalDispatch = (path: string, body: unknown) => Promise<{ status: number; json: Record<string, unknown> }>;

interface GraphRead {
  readonly graph_hash: string;
  /**
   * Declared, not cast. `readGraph` passes the persisted node through verbatim,
   * so these are the carriers the stored graph really holds — counted across
   * every stored graph on 22 Sep 2026: `provenance` 209,115, `display_value`
   * 34,107, `scale_frame` 5,803. Naming them here is what lets the projection
   * read them without an `as` that would hide a later rename.
   */
  readonly nodes: {
    id: string;
    kind: string;
    label: string;
    description?: string;
    display_value?: unknown;
    scale_frame?: unknown;
    provenance?: unknown;
    observed_state?: Record<string, unknown>;
    interventions?: Record<string, unknown>;
    changes?: unknown;
  }[];
  readonly edges: { from: string; to: string }[];
  readonly analysis_state: unknown;
}

const norm = (s: unknown): string => String(s ?? '').toLowerCase().replace(/…$/, '').trim();

export function createAgentCapabilities(
  dispatch: InternalDispatch,
  proposals: ProposalStore,
  /**
   * Construction needs a structured model call. It is injected rather than
   * imported so this module still has no provider of its own — and when it is
   * absent the tool REFUSES rather than pretending the model could not be built
   * for some modelling reason.
   */
  callStructured?: CallStructuredModel,
  /**
   * 'preview' is READ-ONLY. This is the innermost of three layers: the tools
   * are not declared, `dispatchTool` refuses the names, and these refuse too.
   * Defence in depth, because a single prompt sentence is not a boundary.
   */
  mode: 'full' | 'preview' = 'full',
  /**
   * ⭐ THE UI RENDERS THE ANALYSIS FROM `blocks` AND `analysis_ready`, NOT FROM
   * THE PROSE. Measured on the real browser transport at `2fd8cbba`: the turn
   * came back 200 with a correct verdict in `assistant_text` and
   * `blocks=none`, `analysis_ready.options=0` — so a user reading the page saw
   * the sentence and an empty results panel.
   *
   * The raw payload is handed to the ROUTE through this callback rather than
   * returned in the ToolResult, because the ToolResult is JSON-stringified
   * straight back into the model's context: a full analysis payload there
   * would cost thousands of tokens per hop and tell the model nothing its own
   * summary does not already say.
   */
  onAnalysis?: (payload: { analysis_ready?: unknown; blocks?: unknown[] }) => void,
): AgentCapabilities {
  const readOnly = mode === 'preview';
  const refuseReadOnly = (): ToolResult => ({
    ok: false, mutated: false, refusal: 'read_only_preview',
    detail: 'This preview cannot change the model. Nothing has been altered.',
  });
  const readGraph = async (scenarioId: string): Promise<GraphRead | null> => {
    const r = await dispatch(`/assist/v1/scenarios/${scenarioId}/graph`, {});
    if (r.status !== 200) return null;
    const g = (r.json.graph ?? {}) as Record<string, unknown>;
    return {
      graph_hash: String(r.json.graph_hash ?? ''),
      nodes: (g.nodes as GraphRead['nodes']) ?? [],
      edges: (g.edges as GraphRead['edges']) ?? [],
      analysis_state: r.json.analysis_state,
    };
  };

  return {
    async getCanonicalState(ctx: AgentToolContext): Promise<ToolResult> {
      const g = await readGraph(ctx.scenario_id);
      if (g === null) return { ok: false, mutated: false, refusal: 'not_found' };
      return {
        ok: true,
        mutated: false,
        graph_revision: g.graph_hash,
        empty: g.nodes.length === 0,
        entities: g.nodes.map((n) => {
          // The carriers the persisted graph already holds. Reading them is not
          // enrichment — every one is a field the estate stores, and withholding
          // them made the Agent reconstruct from the prompt what canonical state
          // already knew.
          const os = (n.observed_state ?? {}) as Record<string, unknown>;
          const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
          const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
          // Value provenance is a DIFFERENT fact from entity provenance: who put
          // this NUMBER here, versus where the entity came from. Collapsing them
          // is how a system-read figure inherits a user's authority.
          const valueProvenance = {
            ...(str(os.source) ? { source: os.source } : {}),
            ...(str(os.extractionType) ? { extraction_type: os.extractionType } : {}),
          };
          return {
            // ⭐ THE ID. Without it the only way to act on an entity was a fuzzy
            // label match, which collides and cannot address two entities that
            // read alike.
            id: n.id,
            label: n.label,
            ...(n.description !== undefined ? { full_label: n.description } : {}),
            kind: n.kind,
            // A value only when one is actually stored. Absence is reported as
            // unknown rather than as a zero.
            value: num(os.value) ? os.value : null,
            // ⚠ EVERY FIELD BELOW IS OMITTED WHEN ABSENT, never nulled. A null
            // here reads to a model as a stated fact ("there is no unit") rather
            // than as silence, and the Agent would repeat it.
            ...(num(os.raw_value) ? { raw_value: os.raw_value } : {}),
            ...(str(n.display_value) ? { display_value: n.display_value } : {}),
            ...(str(os.unit) ? { unit: os.unit } : {}),
            // The scale carriers. A bare amount with none of these is not just
            // under-described, it is unanalysable downstream — the Agent needs to
            // see that to explain it.
            ...(num(os.cap) ? { cap: os.cap } : {}),
            ...(str(os.declared_scale) ? { declared_scale: os.declared_scale } : {}),
            ...(n.scale_frame === undefined ? {} : { scale_frame: n.scale_frame }),
            ...(Object.keys(valueProvenance).length === 0
              ? {}
              : { value_provenance: valueProvenance }),
            ...(n.provenance === undefined ? {} : { provenance: n.provenance }),
          };
        }),
        existing_links: g.edges.map((e) => `${e.from} -> ${e.to}`),
        // Derived by traversal of the persisted graph — facts, not estimates,
        // and the Agent may state them to the user as facts. Without these it
        // has to infer topology from an edge list, and measurably does it worse
        // than the product it is being compared against.
        structure: structuralFacts(g.nodes, g.edges),
        analysis: g.analysis_state,
        // Every proposal this user has been shown and not yet approved, newest
        // first. An approval with nothing to bind to is an approval that
        // silently does nothing.
        awaiting_your_approval: proposals.outstanding(ctx.scenario_id, ctx.authenticated_user_id),
      };
    },

    async proposeModelChange(ctx, args): Promise<ToolResult> {
      if (readOnly) return refuseReadOnly();
      const g = await readGraph(ctx.scenario_id);
      if (g === null) return { ok: false, mutated: false, refusal: 'not_found' };
      const find = (l: string) => g.nodes.find((n) => norm(n.label) === norm(l) || norm(n.description) === norm(l));
      const from = find(args.from_label);
      const to = find(args.to_label);
      if (from === undefined || to === undefined) {
        return {
          ok: false, mutated: false, refusal: 'unresolved_entity',
          detail: `No entity is labelled "${from === undefined ? args.from_label : args.to_label}". Read the state again and use a label exactly as it appears.`,
        };
      }
      if (g.edges.some((e) => e.from === from.id && e.to === to.id)) {
        return { ok: false, mutated: false, refusal: 'already_present', detail: 'That link is already in the model.' };
      }
      const operations: ProposalOperation[] = [
        { op: 'add_edge', path: `${from.id}::${to.id}`, value: { effect_direction: args.direction } },
      ];
      const proposal = createProposal({
        scenario_id: ctx.scenario_id,
        user_id: ctx.authenticated_user_id,
        base_graph_identity_hash: g.graph_hash,
        operations,
        provenance: { authored_by: 'model_proposed', basis: args.rationale },
        validation: { admitted: true, loss_count: 0, refusals: [] },
        public_label: `Connect "${from.label}" to "${to.label}" (${args.direction})`,
      });
      proposals.put(proposal);
      return {
        ok: true, mutated: false,
        proposal_id: proposal.proposal_id,
        public_label: proposal.public_label,
        base_revision: g.graph_hash,
        note: 'Nothing has changed. Show this to the user and ask them to approve it before calling authorise_change.',
      };
    },

    /**
     * ⭐ ADOPTING ASSUMPTIONS IS A PROPOSAL, NOT A WRITE.
     *
     * The gap, measured on Paul's session of 22 Sep: 17 of 20 factors held no
     * value, the Agent listed sensible starting assumptions in prose, the user
     * replied "these look like a good set of assumptions, can you update the
     * model with them?" — and the turn came back `mutated: false` with
     * `[get_canonical_state]` as its only tool call. Honest, and inert.
     *
     * The dishonest fix is the one the incumbent already ships: invent the
     * numbers during construction and attribute them to the system. The honest
     * one is this — the model SUGGESTS, the user ADOPTS, and the adoption goes
     * through the same stored-proposal/authorise boundary as any other change,
     * so what gets written is exactly what was shown.
     *
     * ⛔ It will not overwrite a value that is already there. A factor that
     * already carries a number was set by somebody; replacing it with a guess
     * under cover of "adopting assumptions" is the failure this refuses.
     */
    async proposeAssumptions(ctx, args): Promise<ToolResult> {
      if (readOnly) return refuseReadOnly();
      const g = await readGraph(ctx.scenario_id);
      if (g === null) return { ok: false, mutated: false, refusal: 'not_found' };
      const input = Array.isArray(args?.assumptions) ? args.assumptions : [];
      if (input.length === 0) {
        return { ok: false, mutated: false, refusal: 'empty_proposal', detail: 'No assumptions were given.' };
      }

      const find = (l: string) => g.nodes.find((n) => norm(n.label) === norm(l) || norm(n.description) === norm(l));
      const unresolved: string[] = [];
      const occupied: { label: string; current_value: number }[] = [];
      const seen = new Set<string>();
      const adopted: { id: string; label: string; value: number; unit: string; basis: string }[] = [];

      for (const a of input) {
        const node = find(String(a?.factor_label ?? ''));
        if (node === undefined) { unresolved.push(String(a?.factor_label ?? '')); continue; }
        const existing = node.observed_state?.value;
        if (typeof existing === 'number') { occupied.push({ label: node.label, current_value: existing }); continue; }
        if (!Number.isFinite(Number(a?.value))) { unresolved.push(node.label); continue; }
        if (seen.has(node.id)) continue;
        seen.add(node.id);
        adopted.push({
          id: node.id, label: node.label,
          value: Number(a.value), unit: String(a?.unit ?? ''), basis: String(a?.basis ?? ''),
        });
      }

      if (adopted.length === 0) {
        return {
          ok: false, mutated: false, refusal: 'nothing_to_adopt',
          unresolved_labels: unresolved, already_valued: occupied,
          detail:
            'None of those could be adopted. Read the state again and use the labels exactly as they appear; ' +
            'factors that already hold a value are left alone.',
        };
      }

      // Sorted by node id so an identical set proposed in a different order is
      // the SAME proposal, not a second one.
      const ordered = [...adopted].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
      const operations: ProposalOperation[] = ordered.map((a) => ({
        op: 'set_factor_value',
        path: a.id,
        value: { value: a.value, unit: a.unit, basis: a.basis },
      }));
      const proposal = createProposal({
        scenario_id: ctx.scenario_id,
        user_id: ctx.authenticated_user_id,
        base_graph_identity_hash: g.graph_hash,
        operations,
        provenance: { authored_by: 'model_proposed', basis: 'starting assumptions offered for the user to adopt or correct' },
        validation: { admitted: true, loss_count: 0, refusals: [] },
        public_label:
          `Adopt ${ordered.length} starting assumption${ordered.length === 1 ? '' : 's'}: ` +
          ordered.map((a) => `${a.label} = ${a.value}${a.unit !== '' ? ' ' + a.unit : ''}`).join('; '),
      });
      proposals.put(proposal);
      return {
        ok: true, mutated: false,
        proposal_id: proposal.proposal_id,
        public_label: proposal.public_label,
        base_revision: g.graph_hash,
        assumptions: ordered.map((a) => ({ factor: a.label, value: a.value, unit: a.unit, basis: a.basis })),
        ...(unresolved.length > 0 ? { unresolved_labels: unresolved } : {}),
        ...(occupied.length > 0 ? { left_alone_already_valued: occupied } : {}),
        note:
          'Nothing has changed. Show the user each value and what it rests on, say plainly that these are ' +
          'assumptions to adopt or correct and NOT measurements, and call authorise_change with this ' +
          'proposal_id only once they agree.',
      };
    },

    /**
     * ⭐ WHAT AN OPTION DOES — the last structural blocker on the journey.
     *
     * ⛔ THE CONSTRAINT THAT DECIDES THIS DESIGN. `option_intervention_edit` is
     * `.strict()` and its `value` is `z.number().min(0).max(1)`, described as
     * "the effect value on the MODEL scale … no unit, no currency and no
     * percentage: the client converts nothing, and the server licenses no
     * raw-unit conversion on this path." A first version of this capability
     * took the user's "£54" and was WITHDRAWN unshipped, because turning it
     * into a number in [0, 1] meant choosing a scale at the moment of writing,
     * which is the fabrication this lane exists to prevent.
     *
     * ⭐ IT IS HONEST NOW ONLY BECAUSE THE FACTOR CARRIES A DECLARED FRAME.
     * Construction publishes `observed_state.cap`, so `raw / cap` READS the
     * user's own number against a range the model already stated and disclosed
     * — a different act from inventing one here. Both numbers are reported.
     *
     * ⛔ AND WITHOUT A FRAME IT REFUSES. A factor with no cap whose value is
     * outside [0, 1] cannot be expressed on this wire at all; saying so is the
     * correct outcome, not picking a denominator.
     */
    async proposeOptionInterventions(ctx, args): Promise<ToolResult> {
      if (readOnly) return refuseReadOnly();
      const g = await readGraph(ctx.scenario_id);
      if (g === null) return { ok: false, mutated: false, refusal: 'not_found' };
      const input = Array.isArray(args?.interventions) ? args.interventions : [];
      if (input.length === 0) {
        return { ok: false, mutated: false, refusal: 'empty_proposal', detail: 'No interventions were given.' };
      }
      const byLabel = (l: string, kind: string) =>
        g.nodes.find((n) => n.kind === kind && (norm(n.label) === norm(l) || norm(n.description) === norm(l)));

      const unresolved: string[] = [];
      const unframed: { factor: string; detail: string }[] = [];
      const unchanged: string[] = [];
      const seen = new Set<string>();
      const set: {
        option: { id: string; label: string }; factor: { id: string; label: string };
        raw: number; normalised: number; cap: number | null; unit: string; basis: string;
        derivedFrame: number | null;
      }[] = [];

      for (const i of input) {
        const option = byLabel(String(i?.option_label ?? ''), 'option');
        const factor = byLabel(String(i?.factor_label ?? ''), 'factor');
        if (option === undefined) { unresolved.push(`option "${String(i?.option_label ?? '')}"`); continue; }
        if (factor === undefined) { unresolved.push(`factor "${String(i?.factor_label ?? '')}"`); continue; }
        const raw = Number(i?.value);
        if (!Number.isFinite(raw)) { unresolved.push(`${option.label} -> ${factor.label} (no value)`); continue; }

        const os = (factor.observed_state ?? {}) as { cap?: unknown; unit?: unknown };
        const cap = typeof os.cap === 'number' && Number.isFinite(os.cap) && os.cap > 0 ? os.cap : null;
        let normalised: number;
        let derivedFrame: number | null = null;
        if (cap !== null) {
          normalised = raw / cap;
          if (normalised < 0 || normalised > 1) {
            unframed.push({ factor: factor.label, detail: `${raw} is outside the model's range for this factor (0 to ${cap})` });
            continue;
          }
        } else if (raw >= 0 && raw <= 1) {
          normalised = raw;
        } else if (raw > 1) {
          /**
           * ⭐ DERIVE THE FRAME RATHER THAN REFUSE, and say so.
           *
           * ⛔ MEASURED on the deployed build: this branch USED to refuse, and
           * the refusal was correct in isolation and a dead end in practice.
           * A factor with no VALUE cannot carry a range at construction —
           * `ObservedStateSchema` requires `value`, and a node-level `cap` is
           * stripped by `NodeV3Schema` — so "Feature release availability" and
           * "Price rollout exposure" could never be set by any option, and the
           * comparison could never run. The Agent's advice became "a rebuild is
           * required", which is not something to ask a user for.
           *
           * The frame is taken from the user's own figure and ATTACHED to the
           * factor on authorisation, exactly as the adopted-assumption path
           * already does. Reported below as `ranges_added_for_analysis`.
           */
          derivedFrame = defaultFrameFor(raw);
          normalised = raw / derivedFrame;
        } else {
          unframed.push({
            factor: factor.label,
            detail:
              `"${factor.label}" has no stated range, and ${raw} cannot be read against one. ` +
              'Nothing here will pick a range on your behalf for a figure like that.',
          });
          continue;
        }

        const current = (option.interventions ?? {})[factor.id] as { value?: unknown } | number | undefined;
        const currentValue = typeof current === 'number' ? current : (current as { value?: unknown } | undefined)?.value;
        if (currentValue === normalised || currentValue === raw) {
          unchanged.push(`${option.label} already sets ${factor.label} to ${String(currentValue)}`);
          continue;
        }
        const key = `${option.id}::${factor.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        set.push({
          option: { id: option.id, label: option.label },
          factor: { id: factor.id, label: factor.label },
          raw, normalised, cap: cap ?? derivedFrame, unit: typeof os.unit === 'string' ? os.unit : '',
          basis: String(i?.basis ?? ''), derivedFrame,
        });
      }

      if (set.length === 0) {
        return {
          ok: false, mutated: false, refusal: 'nothing_to_set',
          ...(unresolved.length > 0 ? { unresolved } : {}),
          ...(unframed.length > 0 ? { no_stated_range: unframed } : {}),
          ...(unchanged.length > 0 ? { already_set: unchanged } : {}),
          detail: 'Nothing could be recorded. Tell the user exactly which of these it was and why.',
        };
      }

      const ordered = [...set].sort((x, y) =>
        `${x.option.id}::${x.factor.id}` < `${y.option.id}::${y.factor.id}` ? -1 : 1);
      const operations: ProposalOperation[] = ordered.map((i) => ({
        op: 'set_option_intervention',
        path: `${i.option.id}::${i.factor.id}`,
        value: { normalised: i.normalised, raw: i.raw, cap: i.cap, basis: i.basis, derived_frame: i.derivedFrame },
      }));
      const proposal = createProposal({
        scenario_id: ctx.scenario_id,
        user_id: ctx.authenticated_user_id,
        base_graph_identity_hash: g.graph_hash,
        operations,
        provenance: { authored_by: 'model_proposed', basis: 'what each option does, for the user to confirm or correct' },
        validation: { admitted: true, loss_count: 0, refusals: [] },
        public_label:
          ordered.map((i) => `${i.option.label} sets ${i.factor.label} to ${i.raw}${i.unit !== '' ? ' ' + i.unit : ''}`).join('; '),
      });
      proposals.put(proposal);
      return {
        ok: true, mutated: false,
        proposal_id: proposal.proposal_id,
        public_label: proposal.public_label,
        base_revision: g.graph_hash,
        interventions: ordered.map((i) => ({
          option: i.option.label, factor: i.factor.label,
          value: i.raw, unit: i.unit,
          // Both numbers, always. The user approves the one they said.
          recorded_on_model_scale: i.normalised,
          model_range: i.cap,
          ...(i.derivedFrame !== null ? { range_taken_from_your_figure: i.derivedFrame } : {}),
          basis: i.basis,
        })),
        ...(unresolved.length > 0 ? { unresolved } : {}),
        ...(unframed.length > 0 ? { no_stated_range: unframed } : {}),
        ...(unchanged.length > 0 ? { already_set: unchanged } : {}),
        note:
          'Nothing has changed. Show the user the value in THEIR units and what it rests on, then call ' +
          'authorise_change with this proposal_id once they agree.',
      };
    },

    async authoriseChange(ctx, args): Promise<ToolResult> {
      if (readOnly) return refuseReadOnly();
      const before = await readGraph(ctx.scenario_id);
      if (before === null) return { ok: false, mutated: false, refusal: 'not_found' };
      const decision = proposals.authorise({
        proposal_id: args.proposal_id,
        scenario_id: ctx.scenario_id,
        authenticated_user_id: ctx.authenticated_user_id,
        current_graph_identity_hash: before.graph_hash,
      });
      if (decision.status === 'already_applied') {
        return { ok: true, mutated: false, applied: true, already_applied: true, detail: 'That proposal has already been applied.' };
      }
      if (decision.status !== 'execute') {
        return { ok: false, mutated: false, refusal: decision.status, ...(decision.status === 'superseded' ? { expected: decision.expected, actual: decision.actual } : {}) };
      }

      // The STORED operations are applied. Nothing is regenerated here.
      const ops = decision.proposal.operations;

      if (ops[0]?.op === 'set_option_intervention') {
        /**
         * ⚠ THIS EVENT IS CAS-GATED AND `factor_value_edit` IS NOT — it carries
         * a REQUIRED `base_graph_hash`. Each applied edit moves the hash, so
         * the current one is re-read between edits; sending the proposal's base
         * for all of them refuses every edit after the first with a divergence
         * that is really our own preceding write.
         */
        const applied: { option: string; factor: string; requested: number; recorded: number | null }[] = [];
        const failures: { path: string; detail: string }[] = [];
        /**
         * ⭐ ATTACH ANY DERIVED FRAME FIRST, in one write, before the levels.
         * The factor must carry its range before a level is recorded against
         * it, or the level is a number the model cannot interpret. Same
         * mechanism as the adopted-assumption path, and the same disclosure.
         */
        const framedHere: { factor: string; range: number }[] = [];
        const frames = new Map<string, number>();
        for (const o of ops) {
          const f = ((o.value ?? {}) as { derived_frame?: number | null }).derived_frame;
          if (typeof f === 'number' && f > 1) frames.set(o.path.split('::')[1], f);
        }
        if (frames.size > 0) {
          const patched = before.nodes.map((n) => {
            const range = frames.get(n.id);
            if (range === undefined) return n;
            const os = (n.observed_state ?? {}) as { value?: number; raw_value?: number };
            const raw = typeof os.raw_value === 'number' ? os.raw_value : os.value;
            /**
             * ⛔ A FACTOR WITH NO VALUE IS LEFT WITHOUT ONE. `ObservedStateSchema`
             * requires `value`, so attaching a range here would mean inventing a
             * baseline — and a zero baseline is the exact fabrication this lane
             * refuses ("an absent value is unknown, never zero"). It is also
             * unnecessary: the baseline gate skips a factor with no value
             * outright (`if (baseline === undefined) continue`), so an unvalued
             * factor was never what blocked the analysis. Only a factor that
             * ALREADY carries a bare amount gets the range.
             */
            if (typeof raw !== 'number') { frames.delete(n.id); return n; }
            framedHere.push({ factor: n.label, range });
            return { ...n, observed_state: { ...os, value: raw / range, raw_value: raw, cap: range, declared_scale: 'unit_interval' } };
          });
          if (framedHere.length > 0) {
            const reg = await dispatch(`/assist/v1/scenarios/${ctx.scenario_id}/graph/register`, {
              graph: { nodes: patched, edges: before.edges },
            });
            if (reg.status !== 200) {
              failures.push({ path: 'scale_frame', detail: `could not attach a range: http ${reg.status}` });
              framedHere.length = 0;
            }
          }
        }
        const rebased = framedHere.length > 0 ? await readGraph(ctx.scenario_id) : null;
        let baseHash = rebased?.graph_hash ?? before.graph_hash;
        for (let i = 0; i < ops.length; i += 1) {
          const o = ops[i];
          const [optionId, factorId] = o.path.split('::');
          const v = ((o.value ?? {}) as { normalised?: number }).normalised;
          if (typeof v !== 'number') { failures.push({ path: o.path, detail: 'no value stored on the proposal' }); continue; }
          const r = await dispatch('/orchestrate/v2/turn', {
            kind: 'system_event',
            turn_id: authorisationTurnId(`${decision.proposal.proposal_id}#${i}`),
            scenario_id: ctx.scenario_id,
            stage: 'frame',
            event: { kind: 'option_intervention_edit', option_id: optionId, factor_id: factorId, value: v, base_graph_hash: baseHash },
          });
          if (r.status !== 200) failures.push({ path: o.path, detail: `http ${r.status}` });
          const mid = await readGraph(ctx.scenario_id);
          if (mid !== null) baseHash = mid.graph_hash;
        }

        const afterSet = await readGraph(ctx.scenario_id);
        const byId = new Map((afterSet?.nodes ?? []).map((n) => [n.id, n]));
        for (const o of ops) {
          const [optionId, factorId] = o.path.split('::');
          const option = byId.get(optionId);
          const iv = (option?.interventions ?? {})[factorId] as { value?: unknown } | number | undefined;
          const recorded = typeof iv === 'number' ? iv : (iv as { value?: unknown } | undefined)?.value;
          const stored = ((o.value ?? {}) as { raw?: number }).raw;
          applied.push({
            option: option?.label ?? optionId,
            factor: byId.get(factorId)?.label ?? factorId,
            requested: typeof stored === 'number' ? stored : Number.NaN,
            recorded: typeof recorded === 'number' ? recorded : null,
          });
        }
        const landed = applied.filter((a) => a.recorded !== null);
        if (landed.length === 0) {
          return {
            ok: false, mutated: false, applied: false, refusal: 'not_applied',
            detail: 'None of the levels were recorded. The model is unchanged.', failures, interventions: applied,
          };
        }
        if (landed.length === applied.length) proposals.markApplied(decision.proposal.proposal_id);
        return {
          ok: true, mutated: true, applied: true,
          proposal_id: decision.proposal.proposal_id,
          recorded_count: landed.length,
          requested_count: applied.length,
          interventions: applied,
          revision_before: before.graph_hash,
          revision_after: afterSet?.graph_hash ?? before.graph_hash,
          ...(failures.length > 0 ? { failures } : {}),
          ...(framedHere.length > 0 ? { ranges_added_for_analysis: framedHere } : {}),
          not_represented:
            'What each option does is now recorded from what the user said, not measured. The model ' +
            'stores each level against the factor\u2019s stated range, so quote the user\u2019s own number back ' +
            'to them, not the normalised one.' +
            (framedHere.length > 0
              ? ' Some factors had no range at all, which would have stopped the analysis running, so one was ' +
                'taken from the figure itself: ' + framedHere.map((f) => `${f.factor} 0 to ${f.range}`).join(', ') +
                '. Say so, and invite a correction \u2014 a range is a unit of measurement, not a forecast.'
              : ''),
        };
      }

      if (ops[0]?.op === 'set_factor_value') {
        /**
         * ⭐ APPLY EACH ADOPTED ASSUMPTION AS ITS OWN `factor_value_edit`, WITH
         * ITS OWN DERIVED IDENTITY. The wire has no batch form, and each event
         * needs a distinct `turn_id` because `(scenario_id, turn_id)` is unique
         * — so the key is derived from the proposal id AND the operation index,
         * which keeps a retry of the same authorisation idempotent per value
         * instead of minting a fresh id every attempt.
         *
         * ⚠ REPRESENTATION LOSS, RECORDED. `FactorValueEditEvent` is `.strict()`
         * and carries `{kind, target_id, value, raw_value?, unit?, field?,
         * applied_from?}` — there is NO provenance field on it, and the handler
         * stamps `source: 'user_explicit'` because it was built for the
         * inspector. That stamp is right about WHO set the value (the user
         * authorised this exact set) and silent about WHAT IT RESTS ON. The
         * basis therefore survives only in the proposal and in what the Agent
         * says, so the result below tells it to say it.
         */
        const applied: { factor: string; requested: number; recorded: number | null }[] = [];
        const failures: { factor: string; detail: string }[] = [];
        for (let i = 0; i < ops.length; i += 1) {
          const o = ops[i];
          const v = (o.value ?? {}) as { value?: number; unit?: string };
          if (typeof v.value !== 'number') { failures.push({ factor: o.path, detail: 'no value stored on the proposal' }); continue; }
          const r = await dispatch('/orchestrate/v2/turn', {
            kind: 'system_event',
            turn_id: authorisationTurnId(`${decision.proposal.proposal_id}#${i}`),
            scenario_id: ctx.scenario_id,
            stage: 'frame',
            event: {
              kind: 'factor_value_edit',
              target_id: o.path,
              value: v.value,
              ...(v.unit !== undefined && v.unit !== '' ? { unit: v.unit } : {}),
            },
          });
          if (r.status !== 200) failures.push({ factor: o.path, detail: `http ${r.status}` });
        }

        // ⛔ CONFIRMED FROM STATE. The handler may rescale what it was sent
        // (unit caps, percent-vs-fraction), so the recorded number is read back
        // and reported EVEN WHEN it differs from the one the user approved —
        // that difference is exactly the thing a user must not discover later.
        const afterSet = await readGraph(ctx.scenario_id);
        const byId = new Map((afterSet?.nodes ?? []).map((n) => [n.id, n]));
        for (const o of ops) {
          const node = byId.get(o.path);
          const stored = node?.observed_state?.value;
          const req = ((o.value ?? {}) as { value?: number }).value;
          applied.push({
            factor: node?.label ?? o.path,
            requested: typeof req === 'number' ? req : Number.NaN,
            recorded: typeof stored === 'number' ? stored : null,
          });
        }
        const landed = applied.filter((a) => a.recorded !== null);
        if (landed.length === 0) {
          return {
            ok: false, mutated: false, applied: false, refusal: 'not_applied',
            detail: 'None of the values were recorded. The model is unchanged.',
            failures, values: applied,
          };
        }

        /**
         * ⭐ ATTACH A SCALE FRAME TO ANYTHING THAT LANDED AS A BARE AMOUNT.
         *
         * ⛔ WHY THIS SECOND WRITE EXISTS, measured end to end. A factor above
         * 1 with no `cap` is refused by `run_analysis`
         * (`baseline_scale_unresolved`) and the refusal is permanent:
         * `factor_value_edit` is `.strict()` with no cap field, and posting a
         * `{value, raw_value}` pair is accepted with HTTP 200 then normalised
         * back to `raw === value`. Construction publishes the frame inside
         * `observed_state`, which survives because `ObservedStateSchema` is
         * `.passthrough()` — but a factor with NO baseline at construction has
         * no `observed_state` to carry one (`value` is required), and a
         * node-level `cap` is stripped by `NodeV3Schema`. So a factor that
         * gets its first value HERE, by adoption, would be unanalysable for
         * the life of the model.
         *
         * Measured on the deployed build: with the frame attached this way,
         * `analysis_ready` went `blocked` -> `ready`, blockers 0, and the run
         * produced win probabilities over 10,000 samples per option. Without
         * it, the same model refused.
         *
         * ⚠ The frame is DERIVED from the user's own number, `raw_value` keeps
         * that number untouched, and it is reported so the Agent says it.
         */
        const needsFrame = (afterSet?.nodes ?? []).filter((n) => {
          if (!ops.some((o) => o.path === n.id)) return false;
          const os = (n.observed_state ?? {}) as { value?: unknown; cap?: unknown };
          return typeof os.value === 'number' && Math.abs(os.value) > 1 && typeof os.cap !== 'number';
        });
        const framed: { factor: string; value: number; range: number }[] = [];
        if (needsFrame.length > 0 && afterSet !== null) {
          const frameById = new Map<string, number>();
          for (const n of needsFrame) {
            const os = n.observed_state as { value: number; raw_value?: number };
            const raw = typeof os.raw_value === 'number' ? os.raw_value : os.value;
            const range = defaultFrameFor(raw);
            if (range <= 1) continue;
            frameById.set(n.id, range);
            framed.push({ factor: n.label, value: raw, range });
          }
          if (frameById.size > 0) {
            const patched = afterSet.nodes.map((n) => {
              const range = frameById.get(n.id);
              if (range === undefined) return n;
              const os = (n.observed_state ?? {}) as { value: number; raw_value?: number };
              const raw = typeof os.raw_value === 'number' ? os.raw_value : os.value;
              return { ...n, observed_state: { ...os, value: raw / range, raw_value: raw, cap: range, declared_scale: 'unit_interval' } };
            });
            const reg = await dispatch(`/assist/v1/scenarios/${ctx.scenario_id}/graph/register`, {
              graph: { nodes: patched, edges: afterSet.edges },
            });
            if (reg.status !== 200) {
              failures.push({ factor: 'scale_frame', detail: `could not attach a range: http ${reg.status}` });
              framed.length = 0;
            }
          }
        }
        if (landed.length === applied.length) proposals.markApplied(decision.proposal.proposal_id);
        const rescaled = landed.filter((a) => a.recorded !== a.requested);
        return {
          ok: true, mutated: true, applied: true,
          proposal_id: decision.proposal.proposal_id,
          adopted_count: landed.length,
          requested_count: applied.length,
          values: applied,
          revision_before: before.graph_hash,
          revision_after: afterSet?.graph_hash ?? before.graph_hash,
          ...(failures.length > 0 ? { failures } : {}),
          ...(rescaled.length > 0
            ? { rescaled_by_the_model: rescaled, must_disclose_rescaling: true }
            : {}),
          ...(framed.length > 0 ? { ranges_added_for_analysis: framed } : {}),
          not_represented:
            'These values are the user\u2019s adopted assumptions, not measurements, and the model records ' +
            'no mark distinguishing the two \u2014 so say so when you describe what changed' +
            (rescaled.length > 0 ? ', and state every value the model stored differently from the one approved.' : '.') +
            (framed.length > 0
              ? ' Some of them had no range to be read against, which would have stopped the analysis running ' +
                'at all, so a range was taken from the figure itself: ' +
                framed.map((f) => `${f.factor} 0 to ${f.range}`).join(', ') +
                '. That is a unit of measurement rather than a forecast or a limit, the approved figures are ' +
                'stored unchanged, and the user should be told and invited to correct any range that is wrong.'
              : ''),
        };
      }

      const op = ops[0];
      const [fromId, toId] = op.path.split('::');
      const direction = (op.value as { effect_direction: 'positive' | 'negative' }).effect_direction;
      /**
       * ⭐ THE OPERATION IDENTITY IS DERIVED, NOT MINTED.
       *
       * This was `randomUUID()`. A fresh id per authorisation means a retry of
       * the SAME authorisation is a different operation to every layer beneath
       * it, so `(scenario_id, turn_id)` can never match and the deployed
       * `append_turn_atomic_v5` replay arm is unreachable by construction.
       *
       * The proposal id is already the stable client/operation identity: it is
       * hashed over the scenario, the user, the base revision and the exact
       * operations, so the same authorisation of the same proposal yields the
       * same key, and a different mutation yields a different one.
       *
       * ⚠ This does NOT by itself deliver durable replay. At the served SHA,
       * `structural-add-edge.ts` computes the current hash and refuses
       * `BASE_HASH_DIVERGED` BEFORE `payload.turn_id` is read, so the app-level
       * gate answers first and the DB's replay-before-CAS arm is still not
       * reached. What this change does is make that boundary MEASURABLE rather
       * than masked by an identity that never repeats.
       */
      const operationId = authorisationTurnId(decision.proposal.proposal_id);
      const res = await dispatch('/orchestrate/v2/turn', {
        kind: 'system_event',
        turn_id: operationId,
        scenario_id: ctx.scenario_id,
        stage: 'frame',
        event: {
          kind: 'structural_add_edge',
          from: fromId,
          to: toId,
          // ⚠ REPRESENTATION LOSS, RECORDED IN THE RESULT. The wire REQUIRES a
          // magnitude and forbids `unknown`, so a direction-only authorisation
          // cannot be expressed. This number is the projection default, not the
          // user's claim, and the Agent is told so explicitly below.
          magnitude: 0.5,
          effect_direction: direction,
          base_graph_hash: decision.proposal.base_graph_identity_hash,
        },
      });

      const after = await readGraph(ctx.scenario_id);
      const confirmation = confirmEdgeWrite({
        revision_before: before.graph_hash,
        revision_after: after?.graph_hash ?? before.graph_hash,
        edgeExistsAfter: (after?.edges ?? []).some((e) => e.from === fromId && e.to === toId),
        system_message: String(res.json.assistant_text ?? ''),
      });
      if (!confirmation.applied) {
        return {
          ok: false, mutated: false, applied: false, refusal: 'not_applied',
          detail: describeOutcome(confirmation), http: res.status, operation_id: operationId,
        };
      }
      proposals.markApplied(decision.proposal.proposal_id);
      return {
        ok: true, mutated: true, applied: true,
        // Olumi discloses this to the user deterministically; see disclosure.ts.
        placeholder_strength: true,
        proposal_id: decision.proposal.proposal_id,
        operation_id: operationId,
        revision_before: confirmation.revision_before,
        revision_after: confirmation.revision_after,
        not_represented:
          'The direction was recorded. No strength was stated by the user, so the model carries a ' +
          'placeholder strength that is not a measurement — say so if you describe the change.',
      };
    },

    async buildModelFromBrief(ctx, args): Promise<ToolResult> {
      if (callStructured === undefined) {
        return { ok: false, mutated: false, refusal: 'construction_unavailable' };
      }
      const brief = typeof args?.brief === 'string' ? args.brief.trim() : '';
      if (brief.length === 0) return { ok: false, mutated: false, refusal: 'empty_brief' };

      // ⛔ NEVER BUILD OVER A MODEL THAT ALREADY EXISTS. Registration replaces
      // the whole graph, so running this on a populated scenario would discard
      // work the user has already authorised.
      const before = await readGraph(ctx.scenario_id);
      if (before === null) return { ok: false, mutated: false, refusal: 'not_found' };
      if (before.nodes.length > 0) {
        return {
          ok: false, mutated: false, refusal: 'model_already_exists',
          detail: 'The model already has entities. Propose a change instead of rebuilding it.',
        };
      }

      const built = await buildModelFromBrief(ctx.scenario_id, brief, dispatch, callStructured);
      if (built.ok !== true) return built;

      // Confirmed from state, never from the write's own return value.
      const after = await readGraph(ctx.scenario_id);
      if (after === null || after.nodes.length === 0) {
        return { ok: false, mutated: false, refusal: 'model_not_readable_after_write' };
      }
      /**
       * ⭐ RETURN THE POST-BUILD STATE, so the Agent does not have to go and
       * fetch it. Measured on the preview path: the first turn called
       * `get_canonical_state`, then `build_model_from_brief`, then
       * `get_canonical_state` AGAIN, then `run_analysis` — four tool calls and
       * four model round trips, 85 s on the slowest sample against a 125 s
       * browser-proxy budget. The second read asks for something this call
       * already has in hand.
       */
      return {
        ...built,
        confirmed_entities: after.nodes.length,
        graph_revision: after.graph_hash,
        entities: after.nodes.map((n) => ({
          label: n.label,
          kind: n.kind,
          value: typeof n.observed_state?.value === 'number' ? n.observed_state.value : null,
        })),
        structure: structuralFacts(after.nodes, after.edges),
      };
    },

    async runAnalysis(ctx, args): Promise<ToolResult> {
      const r = await dispatch('/orchestrate/v2/turn', {
        kind: 'message',
        // Deliberately NOT derived, unlike the authorised write above: asking
        // for the analysis twice is two operations the user actually made, and
        // collapsing them onto one identity would suppress the second.
        turn_id: randomUUID(),
        scenario_id: ctx.scenario_id,
        stage: 'analyse',
        turn_class: 'decide',
        source: 'chip_click',
        message: args.reason,
        chip: { id: 'agent-run-analysis', action_type: 'run_analysis' },
      });
      const ready = (r.json.analysis_ready ?? {}) as Record<string, unknown>;
      const blocks = (r.json.blocks as { type: string }[] | undefined) ?? [];
      const result = blocks.find((b) => b.type === 'analysis_result');
      onAnalysis?.({ analysis_ready: r.json.analysis_ready, blocks });
      return {
        ok: r.status === 200,
        mutated: false,
        ran: result !== undefined,
        status: ready.status ?? 'unknown',
        // Olumi's own words about what is missing. Not re-worded here.
        what_is_missing: String(r.json.assistant_text ?? ''),
        blockers: ready.blockers ?? [],
        options: ready.options ?? [],
        ...(result !== undefined ? { result } : {}),
      };
    },
  };
}
