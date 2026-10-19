/**
 * ⭐ PATH-B: PROPOSE AND APPLY A CHANGE (C5, 19 Oct 2026; DL-3 rulings 1–3 and 7, PL 3b; outbox/C5-PATHB-PROPOSE-APPLY-DESIGN.md).
 *
 * `propose_change` writes nothing. The AI declares each figure and its SOURCE (origin, the user's words, a named third party);
 * the host checks only literal facts on one fresh read: the ids exist, the quote is literally in the user's typed messages,
 * and the carrier can hold the declared origin. It records the declaration in ONE content-hashed proposal (`createProposal`).
 *
 * `apply_change` runs only after the user's press (the SDK's approval interruption, owned by PATH-B):
 *  1. EXACTLY ONCE: this proposal's own committed receipt is looked up first (`/versions` by `authorisationTurnId`), so a
 *     commit whose response was lost, or a restart, reconciles to "already saved", never to `superseded`;
 *  2. the existing approval seam: `proposals.authorise` on the fresh identity, then `executeApproved` (single flight; an
 *     unknown outcome stays blocked);
 *  3. ONE commit through the product's batch door (`commitOptionLevels`: CAS on the base, idempotent on the turn id), with
 *     the declared origins stamped by the writers' own contexts;
 *  4. a save is claimed only on THIS commit's receipt AND the complete approved postimage read back afresh.
 *
 * HOW EACH CARRIER HOLDS A DECLARED SOURCE: ONE table (`holdingOf`), read back by the ONE authority (`provenanceOf`). What a
 * carrier cannot hold is returned in the receipt as `not_kept`, with the original material; a save that lost anything is
 * never called faithful (PL AMEND 15:35). A source a carrier could hold only by changing its origin is BLOCKED-SCHEMA.
 *  · factor value — Olumi's: adopted by the press (`user_assumption` + review → ai, accepted). The user's or a third party's,
 *    with the words literally the user's: an unverified binding (`user_material_unverified` → human, role unverified). A
 *    literal match proves the bytes, never the speaker (PL 3b), so it is never "the user's, verified". Not kept: the words,
 *    and for a third party that it was someone else, and their name. An unknown speaker: BLOCKED-SCHEMA (it would read human).
 *  · option setting — Olumi's: `cee_hypothesis` (ai). Not kept: the user's approval (a cell holds no acceptance marker). Any
 *    other source, with the words literally the user's: ORIGIN UNKNOWN (R3: `cee_hypothesis` beside `user_material_unverified`,
 *    the add-option pairing), never Olumi's and never the user's verified figure. Not kept: the declared origin, a third
 *    party's name, the words.
 *  · stance (AIE 15:24/15:54, separate from source): a value holds a current level, a setting a what-if. A target or a
 *    supposition is never saved as a value; a stance the carrier does not mean is saved with the stance named as not kept.
 *  · link strength (candidate 2, outbox/C5-PATHB-LINK-STRENGTH-DESIGN.md v2) — Olumi's band only, through the existing
 *    capability's ONE rule set (`proposeLinkStrengths`: midpoint or review, placeholders, definitional links and the user's own
 *    figures left out, "already") and the SAME door. A person's band: BLOCKED-SCHEMA — no link carrier holds "human,
 *    unverified" or "unknown" (`linkSizing`, provenance-of.ts:721–723).
 *  · a COMPOUND change (GAP 2, DL ruling B): figures, Olumi's link bands, renames and removals as ONE proposal and ONE door
 *    commit (`compound`). Each member is prepared as it would be alone — renames and removals by the existing proposers
 *    (`prepareStructuralOp`), carried literally — and the whole change is refused before any card when one member is refused,
 *    left out, or acts on a part another member removes. Never a first half.
 * Adding a factor or an option is not made on this path yet: it comes back `unavailable`, naming what is not available.
 */
import { z } from 'zod-v4';
import type { AgentToolContext, ToolResult } from '../../agent-lane/runtime/agent-tools.js';
import { authorisationTurnId, prepareStructuralOp, type InternalDispatch } from '../../agent-lane/runtime/agent-capabilities.js';
import { createProposal, type ProposalOperation, type ProposalStore, type ReceiptSummary, type StructuredProposal } from '../../agent-lane/proposal.js';
import { runWithApprovedBindings, type ApprovedAdoption } from '../../agent-lane/approved-adoption-context.js';
import { defaultFrameFor } from '../../agent-lane/admit-model.js';
import { GraphStaleWriteError } from '../../build-turn-context.js';
import { compoundMembersConflict, type CommitOptionLevelsInput, type CommitOptionLevelsResult, type CompoundStructuralMember } from '../../system-events/dispatch.js';
import { linkProvenanceOf, linkSizing, provenanceOf, type Provenance } from '../../../cee/provenance/provenance-of.js';
import { registrationTurnId } from '../../graph-registration/registration-identity.js';
import { EDGE_STRENGTH_MIDPOINTS } from '../../format/edge-strength-bands.js';
import type { InfluenceBand } from '../../format/influence-bands.js';
import { verbatimSourceLine } from '../../agent-lane/quote-confirmation.js';
import { approvedGraphHeld } from '../../agent-lane/runtime/draft-replacement.js';
import { isSavedRead, readSaved, type SavedRead } from './context-tool.js';
import { targetCandidate, targetReadback, type TargetDeclaration } from './goal-target.js';
import { ok, refused, unavailable, type ToolOutcome } from './outcome.js';
import { inTheUsersWords, type TypedWords } from './user-words.js';

export const PROPOSE_CHANGE = 'propose_change';
export const APPLY_CHANGE = 'apply_change';

const Source = z.object({
  /** Who the figure comes from, as the AI read it: the user, a third party they named, Olumi, or not known. */
  origin: z.enum(['user', 'third_party', 'olumi', 'unknown']),
  /** The words it comes from, copied verbatim from the user's own messages; null for Olumi's estimate. */
  quote: z.string().nullable(),
  /** The third party the user named as its source; otherwise null. */
  named_source: z.string().nullable(),
}).strict();
const id = z.string();
const unit = z.string().nullable();
/** The AIE's per-figure stance, verbatim (prompt/AIE-MULTIMODEL-SCOPE-AND-STANCE-REPLY-20261019-v1.json, 15:24). */
export const STANCE_DESCRIPTION =
  'How this particular figure is put forward in its full source context, not whether it is true and not who authored it. hypothetical: a supposition, conditional scenario or what-if, including numbers embedded inside that assumed situation. target: a desired or required outcome or threshold, rather than an observed level. estimate: a tentative assessment, approximation or prediction offered as such, rather than an asserted current fact. stated_current: the speaker asserts an actual current or already observed level for this subject at the relevant time, outside a supposition, target or estimate. Read the whole proposition and its conditions: indicative wording inside a supposition does not make its embedded figure stated_current. Classify each figure by its own proposition; one statement\'s status must not transfer to a different quantity or subject. Preserve the original source, wording, sign, units, period and conditions. stated_current describes the assertion; it does not mean verified, accurate or adopted.';
const Stance = z.enum(['stated_current', 'hypothetical', 'target', 'estimate']).describe(STANCE_DESCRIPTION);
const Declared = z.object({ value: z.number(), unit, stance: Stance, source: Source }).strict();
/**
 * Changes this path cannot make yet (DL-3 ruling, 19 Oct: one dispatch path, no interim wrapper). The AI can still name one,
 * and is told truthfully that it is not available here, never refused as if a rule forbade it.
 */
const NOT_YET = {
  add_to_model: 'Adding a factor or an option isn\'t available on this path yet.',
} as const;
type NotYet = keyof typeof NOT_YET;
const notYet = (op: NotYet) => z.object({ op: z.literal(op), target_id: id }).strict();
export const ChangeOp = z.discriminatedUnion('op', [
  z.object({ op: z.literal('set_factor_value'), factor_id: id, value: z.number(), unit, stance: Stance, source: Source }).strict(),
  z.object({ op: z.literal('set_option_setting'), option_id: id, factor_id: id, value: z.number(), unit, stance: Stance, source: Source }).strict(),
  /** An existing link's strength band. Its direction is kept; a reversal or a new link is not this change. */
  z.object({ op: z.literal('set_link_strength'), from: id, to: id, band: z.enum(['weak', 'moderate', 'strong', 'very strong']), stance: Stance, source: Source }).strict(),
  /** The goal's success target. The comparator, figure, unit, what it measures and its frame are the AI's, carried literally. */
  z.object({ op: z.literal('set_goal_target'), goal_id: id, comparator: z.enum(['<', '<=', '>', '>=']), value: z.number(), unit: z.string(),
    quantity: z.string(), frame: z.enum(['level', 'change']), stance: Stance, source: Source }).strict(),
  /** Rename an option, a factor or a risk: the user's own request in this message, quoted exactly, holding the new name. */
  z.object({ op: z.literal('rename'), kind: z.enum(['option', 'factor', 'risk']), target_id: id, new_label: z.string(), quote: z.string() }).strict(),
  /** Remove a factor or a risk (`to_id` null), or the direct link from `target_id` to `to_id`: the user's own request, quoted exactly. */
  z.object({ op: z.literal('remove_from_model'), kind: z.enum(['factor', 'risk', 'link']), target_id: id, to_id: id.nullable(), quote: z.string() }).strict(),
  notYet('add_to_model'),
]);
type FigureOp = Extract<z.infer<typeof ChangeOp>, { op: 'set_factor_value' | 'set_option_setting' }>;
type TargetArgs = Extract<z.infer<typeof ChangeOp>, { op: 'set_goal_target' }>;
type LinkArgs = Extract<z.infer<typeof ChangeOp>, { op: 'set_link_strength' }>;
type StructuralArgs = Extract<z.infer<typeof ChangeOp>, { op: 'rename' | 'remove_from_model' }>;
/** A target as stored on the proposal: the declaration plus the literal source line and when it was proposed (hashed). */
const TargetStored = z.object({ value: z.number(), unit: z.string(), comparator: z.enum(['<', '<=', '>', '>=']), quantity: z.string(),
  frame: z.literal('level'), stance: Stance, source: Source, said_in: z.string().nullable(), recorded_at: z.string() }).strict();
const isNotYet = (o: z.infer<typeof ChangeOp>): o is Extract<z.infer<typeof ChangeOp>, { op: NotYet }> => Object.hasOwn(NOT_YET, o.op);
export const ProposeChangeParams = z.object({
  /** What the approval card says, in a few plain words. */
  public_label: z.string(),
  /** Why, in Olumi's words. */
  basis: z.string(),
  ops: z.array(ChangeOp).min(1).max(12),
}).strict();
/** No pattern: the SDK's strict schema drops it, so a malformed id would fail the parse and end the turn. An id the store
 * does not hold is refused as `unknown_proposal` instead. */
export const ApplyChangeParams = z.object({ proposal_id: z.string() }).strict();
export type ProposeChangeArgs = z.infer<typeof ProposeChangeParams>;
export type ApplyChangeArgs = z.infer<typeof ApplyChangeParams>;

export interface ChangeDeps {
  readonly dispatch: InternalDispatch;
  readonly proposals: ProposalStore;
  /** The product's batch door (`commitOptionLevelsInProcess`), as the route already gives the capabilities. */
  readonly commitOptionLevels?: (input: CommitOptionLevelsInput) => Promise<CommitOptionLevelsResult>;
  /** The existing link-set capability (`capabilities.proposeLinkStrengths`), on the SAME proposal store; absent → not available. */
  readonly proposeLinkStrengths?: (ctx: ChangeCtx, args: { readonly links: readonly Rec[]; readonly rationale: string }) => Promise<ToolResult>;
}
type ChangeCtx = Pick<AgentToolContext, 'scenario_id' | 'authenticated_user_id' | 'turn_id'> & TypedWords;

type Rec = Record<string, unknown>;
type Op = { kind: 'value' | 'setting'; option_id?: string; factor_id: string } & z.infer<typeof Declared>;
type DeclaredSource = z.infer<typeof Source>;
/** What a carrier cannot hold of the declared source, with the declared material itself. */
type NotKept = { readonly what: 'origin' | 'speaker' | 'name' | 'words' | 'approval' | 'stance'; readonly declared: string };
type DeclaredStance = z.infer<typeof Stance>;
type Holding = { readonly stored: Pick<Provenance, 'origin'> & { readonly accepted?: true; readonly role?: 'unverified' }; readonly not_kept: readonly NotKept[] }
  | { readonly blocked: string };
/**
 * THE ONE TABLE: how each carrier holds a declared source and stance, what the authority must read back, and what is not kept.
 * A factor value IS the factor's current level; an option's setting IS the level under that option (a what-if). A figure whose
 * stance that carrier would change into an operative current level (a supposition or a target as a value) is BLOCKED (AIE
 * 15:54: a hypothetical never becomes an operative current level).
 */
function holdingOf(kind: Op['kind'] | 'target' | 'link', s: DeclaredSource, stance: DeclaredStance): Holding {
  // A link's band is held only as Olumi's estimate, reviewed by the press. The capability's proposal carries no stance, so any
  // other stance is blocked rather than lost unsaid.
  if (kind === 'link') {
    if (s.origin !== 'olumi') return { blocked: 'a link\'s strength from a person\'s words would read as their own verified size; it can be saved only as Olumi\'s estimate on this path yet' };
    if (stance !== 'estimate') return { blocked: 'Olumi\'s band for a link is an estimate; put forward as anything else it cannot be saved on this path yet' };
    return { stored: { origin: 'ai', accepted: true }, not_kept: [] };
  }
  // A goal's target figure is held as Olumi's reading of the binding (the existing target carrier has no unverified-human
  // stamp); a person's words are kept as theirs beside it, and the declared origin of the figure is named as not kept.
  if (kind === 'target') {
    if (stance !== 'target') return { blocked: `a figure put forward as ${stance === 'hypothetical' ? 'a supposition' : stance === 'estimate' ? 'an estimate' : 'a current level'} is not a target` };
    return { stored: { origin: 'ai' }, not_kept: s.origin === 'olumi' ? [{ what: 'approval', declared: 'adopted_by_the_press' }]
      : [{ what: 'origin', declared: s.origin }, ...(s.origin === 'third_party' && s.named_source !== null ? [{ what: 'name' as const, declared: s.named_source }] : [])] };
  }
  if (kind === 'value' && s.origin === 'unknown') return { blocked: 'a figure whose speaker is not known cannot be saved as unknown on this path yet; it would read as a person\'s figure' };
  if (stance === 'target') return { blocked: kind === 'value' ? 'a target would become this factor\'s current level; setting a target isn\'t available on this path yet' : 'a target is not an option\'s setting' };
  if (kind === 'value' && stance === 'hypothetical') return { blocked: 'a supposed figure would become this factor\'s current level; it cannot be kept as a supposition on this path yet' };
  // What the carrier means for this source: Olumi's figure is held as Olumi's estimate; a person's value as a stated level;
  // an option's setting as a what-if. Any other declared stance is saved with its stance named as not kept.
  const held: readonly DeclaredStance[] = s.origin === 'olumi' ? (kind === 'value' ? ['estimate'] : ['estimate', 'hypothetical'])
    : kind === 'value' ? ['stated_current'] : ['stated_current', 'hypothetical'];
  const stanceLost: NotKept[] = held.includes(stance) ? [] : [{ what: 'stance', declared: stance }];
  const words: NotKept = { what: 'words', declared: s.quote ?? '' };
  const name: NotKept[] = s.origin === 'third_party' && s.named_source !== null ? [{ what: 'name', declared: s.named_source }] : [];
  // R3: a person's setting is held as origin unknown — the cell keeps the figure, never whose words they were.
  if (kind === 'setting' && s.origin !== 'olumi') {
    return { stored: { origin: 'unknown' }, not_kept: [...stanceLost, ...(s.origin === 'unknown' ? [] : [{ what: 'origin' as const, declared: s.origin }]), ...name, words] };
  }
  if (s.origin === 'olumi') {
    return kind === 'value' ? { stored: { origin: 'ai', accepted: true }, not_kept: stanceLost }
      : { stored: { origin: 'ai' }, not_kept: [...stanceLost, { what: 'approval', declared: 'adopted_by_the_press' }] };
  }
  return { stored: { origin: 'human', role: 'unverified' }, not_kept: [...stanceLost, ...(s.origin === 'user' ? [words]
    : [{ what: 'speaker' as const, declared: 'third_party' }, ...name, words])] };
}
const isBlocked = (h: Holding): h is Extract<Holding, { blocked: string }> => 'blocked' in h;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const nodesOf = (g: Rec): Rec[] => (Array.isArray(g.nodes) ? g.nodes.filter(isRec) : []);
const frameOf = (n: Rec): number | null => {
  const os = isRec(n.observed_state) ? n.observed_state : {};
  return typeof os.cap === 'number' && os.cap > 0 ? os.cap : typeof n.scale_frame === 'number' && n.scale_frame > 0 ? n.scale_frame : null;
};
const close = (a: unknown, b: number): boolean => typeof a === 'number' && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));
const cellOf = (option: Rec | undefined, factorId: string): unknown => (isRec(option?.interventions) ? option.interventions[factorId] : undefined);

/** The operations as stored on the proposal: the declaration, hashed into its id. */
const operationOf = (o: FigureOp): ProposalOperation => ({
  op: o.op === 'set_factor_value' ? 'set_factor_value' : 'set_option_intervention',
  path: o.op === 'set_factor_value' ? o.factor_id : `${o.option_id}::${o.factor_id}`,
  value: { value: o.value, unit: o.unit, stance: o.stance, source: o.source },
});
function declaredOf(operations: readonly ProposalOperation[]): Op[] | null {
  const out: Op[] = [];
  for (const o of operations) {
    const d = Declared.safeParse(o.value);
    if (!d.success || (o.op !== 'set_factor_value' && o.op !== 'set_option_intervention')) return null;
    const [optionId, factorId] = o.op === 'set_option_intervention' ? o.path.split('::') : [undefined, o.path];
    out.push({ kind: o.op === 'set_factor_value' ? 'value' : 'setting', factor_id: factorId ?? '', ...(optionId === undefined ? {} : { option_id: optionId }), ...d.data });
  }
  return out;
}

type Plan = Pick<CommitOptionLevelsInput, 'links' | 'levels' | 'values' | 'frames'> & { bindings: ApprovedAdoption[] };
type Stop = { refusal: string; op: number };
/** The declared ops as the door's one input, on the read graph. Conversion (ranges, units) stays the writers'. */
function planOf(scenarioId: string, proposalId: string, ops: readonly Op[], graph: Rec): Plan | Stop {
  const byId = new Map(nodesOf(graph).map((n) => [n.id, n]));
  const edges = Array.isArray(graph.edges) ? graph.edges.filter(isRec) : [];
  const plan: Plan & { values: NonNullable<Plan['values']>[number][]; frames: NonNullable<Plan['frames']>[number][];
    levels: Plan['levels'][number][]; links: Plan['links'][number][] } = { links: [], levels: [], values: [], frames: [], bindings: [] };
  for (const [i, o] of ops.entries()) {
    const factor = byId.get(o.factor_id);
    if (factor?.kind !== 'factor') return { refusal: 'not_a_factor', op: i };
    if (isBlocked(holdingOf(o.kind, o.source, o.stance))) return { refusal: 'blocked_schema', op: i };
    const olumi = o.source.origin === 'olumi';
    if (o.kind === 'value') {
      plan.values.push({ factor_id: o.factor_id, value: o.value, ...(o.unit === null ? {} : { unit: o.unit }), author: olumi ? 'model_proposed' : 'user_specified' });
      if (!olumi) plan.bindings.push({ scenarioId, proposalId, targetId: o.factor_id, rawValue: o.value, unverifiedBinding: { source: o.source.quote ?? '', quote: o.source.quote ?? '' } });
      if (frameOf(factor) === null && Math.abs(o.value) > 1) plan.frames.push({ factor_id: o.factor_id, cap: defaultFrameFor(o.value) });
      continue;
    }
    if (byId.get(o.option_id)?.kind !== 'option') return { refusal: 'not_an_option', op: i };
    const frame = frameOf(factor) ?? plan.frames.find((f) => f.factor_id === o.factor_id)?.cap ?? null;
    // #3461 R1: only a unitless share may take the model's 0–1 scale on a factor with no range. A figure with a unit (or above 1)
    // would lose its figure and unit there, so it is not proposed at all (`needs_range`), never written and found short after.
    if (frame === null && (o.unit !== null || Math.abs(o.value) > 1)) return { refusal: 'needs_range', op: i };
    const author = olumi ? 'model_proposed' as const : 'unverified' as const;
    plan.levels.push(frame === null ? { option_id: o.option_id!, factor_id: o.factor_id, value: o.value, author }
      : { option_id: o.option_id!, factor_id: o.factor_id, value: o.value / frame, raw_value: o.value, cap: frame, ...(o.unit === null ? {} : { unit: o.unit }), author });
    if (!edges.some((e) => e.from === o.option_id && e.to === o.factor_id)) plan.links.push({ option_id: o.option_id!, factor_id: o.factor_id });
  }
  return plan;
}

/**
 * Each op as the model now holds it: the declared source, the source the ONE authority reads, and what was not kept.
 * `holds` only when every figure is there as approved AND the authority reads exactly the holding's source.
 */
function readbackOf(read: SavedRead, ops: readonly Op[]): { holds: boolean; faithful: boolean; written: Rec[] } {
  const byId = new Map(nodesOf(read.graph).map((n) => [n.id, n]));
  const written = ops.map((o) => {
    const holding = holdingOf(o.kind, o.source, o.stance);
    const factor = byId.get(o.factor_id);
    const carrier = o.kind === 'value' ? factor?.observed_state : cellOf(byId.get(o.option_id), o.factor_id);
    const figure = typeof carrier === 'number' ? carrier : isRec(carrier) ? (typeof carrier.raw_value === 'number' ? carrier.raw_value : carrier.value) : undefined;
    const source: Provenance = o.kind === 'value' ? provenanceOf({ value: carrier }) : provenanceOf({ setting: carrier, target: factor });
    const storedUnit = isRec(carrier) && typeof carrier.unit === 'string' ? carrier.unit : null;
    const asHeld = !isBlocked(holding) && source.origin === holding.stored.origin
      && (holding.stored.role === undefined || source.role === holding.stored.role)
      && (holding.stored.accepted !== true || source.accepted);
    const holds = close(figure, o.value) && asHeld && (o.unit === null || storedUnit?.trim().toLowerCase() === o.unit.trim().toLowerCase());
    const notKept = isBlocked(holding) ? [] : holding.not_kept;
    return { holds, notKept, row: { op: o.kind === 'value' ? 'set_factor_value' : 'set_option_setting', ...(o.option_id === undefined ? {} : { option_id: o.option_id }),
      factor_id: o.factor_id, figure: figure ?? null, unit: storedUnit, declared: { ...o.source, stance: o.stance }, stored_as: source, not_kept: notKept } };
  });
  return { holds: written.every((w) => w.holds), faithful: written.every((w) => w.notKept.length === 0), written: written.map((w) => w.row) };
}

/** THIS proposal's own committed version, by the turn id its write carries; 'unreadable' when the history cannot be read. */
async function ownReceipt(dispatch: InternalDispatch, scenarioId: string, turnId: string): Promise<ReceiptSummary | null | 'unreadable'> {
  let cursor: string | undefined;
  for (let page = 0; page < 5; page += 1) {
    let r: Awaited<ReturnType<InternalDispatch>>;
    try { r = await dispatch(`/assist/v1/scenarios/${scenarioId}/versions`, { limit: 200, ...(cursor === undefined ? {} : { cursor }) }); } catch { return 'unreadable'; }
    if (r.status !== 200) return 'unreadable';
    const hit = (Array.isArray(r.json.versions) ? r.json.versions.filter(isRec) : [])
      .find((v) => isRec(v.creation) && v.creation.source_turn_id === turnId);
    if (hit !== undefined && isRec(hit.creation)) {
      return { version: Number(hit.sequence), version_id: String(hit.version_id), mutation_id: String(hit.creation.mutation_id), source_turn_id: turnId };
    }
    cursor = typeof r.json.next_cursor === 'string' ? r.json.next_cursor : undefined;
    if (cursor === undefined) return null;
  }
  return null;
}

/** A plan that stopped: a figure no carrier can take as given is unavailable with the figure kept; anything else is refused. */
function stopped(plan: Stop, ops: readonly Op[], at: (i: number) => number = (i) => i): ToolOutcome {
  if (plan.refusal !== 'needs_range') return refused(plan.refusal, undefined, { op: at(plan.op) });
  const o = ops[plan.op]!;
  return unavailable('needs_range', 'none', `Change ${at(plan.op) + 1}: this factor has no range yet, so this figure cannot be saved with its unit; nothing was proposed or saved.`,
    { op: at(plan.op), not_kept: [{ what: 'figure', declared: o.unit === null ? String(o.value) : `${o.value} ${o.unit}` }] });
}

/** BLOCKED-SCHEMA, said with the change it stopped: nothing is proposed or saved. */
const blockedSaid = (i: number, why: string): string => `Change ${i + 1}: ${why}, so nothing was proposed or saved.`;

const codeOf = (reason: string): string => {
  const c = reason.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  return /^[a-z]/.test(c) ? c : 'change_refused';
};

const LINKS_NOT_HERE = 'Changing how strongly one factor affects another isn\'t available on this path yet. Nothing was proposed or saved.';
const MIXED_TARGET = 'Changing the goal\'s target together with other changes isn\'t available on this path yet; propose the target on its own. Nothing was proposed or saved.';
const CHANGE_TARGET = 'A target stated as a change from today isn\'t available on this path yet. Nothing was proposed or saved.';

/** The one goal-target declaration a proposal holds, as stored (hashed); `null` when the proposal is not a target change. */
function targetOf(p: StructuredProposal): (TargetDeclaration & { readonly stored: z.infer<typeof TargetStored> }) | null {
  const op = p.operations.length === 1 && p.operations[0]!.op === 'set_goal_target' ? p.operations[0]! : undefined;
  const v = op === undefined ? undefined : TargetStored.safeParse(op.value);
  if (op === undefined || v === undefined || !v.success) return null;
  return { goal_id: op.path, comparator: v.data.comparator, value: v.data.value, unit: v.data.unit, origin: v.data.source.origin,
    quote: v.data.source.quote, said_in: v.data.said_in, recorded_at: v.data.recorded_at, stored: v.data };
}

/** A target's receipt row: the figure as held, the declaration (source, stance, what it measures) and what was not kept. */
function targetRead(read: SavedRead, t: NonNullable<ReturnType<typeof targetOf>>): { holds: boolean; faithful: boolean; written: Rec[] } {
  const holding = holdingOf('target', t.stored.source, t.stored.stance);
  const notKept = isBlocked(holding) ? [] : holding.not_kept;
  const back = targetReadback(read.graph, t);
  return { holds: back.holds && !isBlocked(holding), faithful: notKept.length === 0,
    written: [{ ...back.row, declared: { ...t.stored.source, stance: t.stored.stance, quantity: t.stored.quantity }, not_kept: notKept }] };
}

async function proposeTarget(deps: Pick<ChangeDeps, 'dispatch' | 'proposals'>, ctx: ChangeCtx, args: ProposeChangeArgs, t: TargetArgs): Promise<ToolOutcome> {
  if (t.frame === 'change') return unavailable('change_target_not_available', 'none', CHANGE_TARGET);
  const holding = holdingOf('target', t.source, t.stance);
  if (isBlocked(holding)) return unavailable('blocked_schema', 'none', blockedSaid(0, holding.blocked));
  if (t.source.origin !== 'olumi' && (t.source.quote === null || !inTheUsersWords(t.source.quote, ctx))) return refused('quote_not_in_users_words', undefined, { op: 0 });
  const read = await readSaved(deps, ctx.scenario_id);
  if (!isSavedRead(read)) return read;
  if (read.identity === null) return unavailable('read_malformed');
  if (nodesOf(read.graph).find((n) => n.id === t.goal_id)?.kind !== 'goal') return refused('not_a_goal', undefined, { op: 0 });
  const saidIn = t.source.quote === null ? null : verbatimSourceLine({ now: ctx.user_turn_text ?? null,
    conversation: (ctx.verified_user_messages ?? []).join('\n') }, t.source.quote) ?? null;
  const stored: z.infer<typeof TargetStored> = { value: t.value, unit: t.unit, comparator: t.comparator, quantity: t.quantity, frame: 'level',
    stance: t.stance, source: t.source, said_in: saidIn, recorded_at: new Date().toISOString() };
  const p = createProposal({ scenario_id: ctx.scenario_id, user_id: ctx.authenticated_user_id, base_graph_identity_hash: read.identity,
    operations: [{ op: 'set_goal_target', path: t.goal_id, value: stored }], provenance: { authored_by: 'model_proposed', basis: args.basis },
    validation: { admitted: true, loss_count: 0, refusals: [] }, public_label: args.public_label });
  // The writer's own gates, run once on this read before any card exists (nothing is written).
  const dry = await targetCandidate(ctx.scenario_id, authorisationTurnId(p.proposal_id), authorisationTurnId(p.proposal_id), targetOf(p)!, read.graph, read.graphHash);
  if ('refusal' in dry) {
    return dry.refusal === 'goal_is_a_change' ? unavailable('change_target_not_available', 'none', CHANGE_TARGET) : refused(codeOf(dry.refusal), undefined, { op: 0 });
  }
  deps.proposals.put(p);
  return ok({ proposal_id: p.proposal_id, public_label: p.public_label, base_revision: read.identity });
}

/**
 * Olumi's bands for existing links: the table first (a person's band, or a band not put forward as an estimate, is BLOCKED),
 * then the existing capability on the same read — the ids' own labels, Olumi's basis — and its result as this path's outcome.
 */
async function proposeLinks(deps: Pick<ChangeDeps, 'dispatch' | 'proposals' | 'proposeLinkStrengths'>, ctx: ChangeCtx, args: ProposeChangeArgs,
  links: readonly LinkArgs[]): Promise<ToolOutcome> {
  if (deps.proposeLinkStrengths === undefined) return unavailable('set_link_strength_not_available', 'none', LINKS_NOT_HERE);
  for (const [i, l] of links.entries()) {
    const holding = holdingOf('link', l.source, l.stance);
    if (isBlocked(holding)) return unavailable('blocked_schema', 'none', blockedSaid(i, holding.blocked));
  }
  const read = await readSaved(deps, ctx.scenario_id);
  if (!isSavedRead(read)) return read;
  const labelOf = new Map(nodesOf(read.graph).map((n) => [n.id, n.label]));
  const asked: Rec[] = [];
  for (const [i, l] of links.entries()) {
    const from = labelOf.get(l.from);
    const to = labelOf.get(l.to);
    if (typeof from !== 'string' || typeof to !== 'string') return refused('not_in_model', undefined, { op: i });
    asked.push({ from_label: from, to_label: to, strength: l.band, origin: 'olumi', basis: args.basis });
  }
  const r = await deps.proposeLinkStrengths(ctx, { links: asked, rationale: args.basis });
  const { ok: done, mutated: _mutated, refusal, detail, ...data } = r;
  if (!done) return refused(codeOf(typeof refusal === 'string' ? refusal : 'link_set_refused'), typeof detail === 'string' ? detail : undefined, data);
  return ok(data);
}

/** The capability's stored link set, as its own apply reads it (agent-capabilities.ts `applyLinkStrengthSet`); else `null`. */
/** The band vocabulary, by the ONE band table (as the capability reads it). */
const isInfluenceBand = (v: unknown): v is InfluenceBand => typeof v === 'string' && Object.hasOwn(EDGE_STRENGTH_MIDPOINTS, v);
type StoredLink = { from: string; to: string; magnitude: number; intent: 'set' | 'confirm_current'; band: InfluenceBand;
  expected: { mean: number; effect_direction: 'positive' | 'negative'; reviewed_at: string | null }; sizing_after_approval: string; std?: number };
function linksOf(operations: readonly ProposalOperation[]): StoredLink[] | null {
  if (operations.length === 0 || operations.some((o) => o.op !== 'set_link_strength')) return null;
  const out: StoredLink[] = [];
  for (const o of operations) {
    const [from, to] = o.path.split('::');
    const v = isRec(o.value) ? o.value : {};
    const e = isRec(v.expected) ? v.expected : {};
    // Olumi's estimate only: this path never proposes a person's band, so it never applies one.
    if (!from || !to || typeof v.magnitude !== 'number' || (v.intent !== 'set' && v.intent !== 'confirm_current') || !isInfluenceBand(v.band)
      || v.author !== 'model_proposed' || typeof v.sizing_after_approval !== 'string' || typeof e.mean !== 'number'
      || (e.effect_direction !== 'positive' && e.effect_direction !== 'negative') || (v.std !== undefined && typeof v.std !== 'number')) return null;
    out.push({ from, to, magnitude: v.magnitude, intent: v.intent, band: v.band, sizing_after_approval: v.sizing_after_approval,
      expected: { mean: e.mean, effect_direction: e.effect_direction, reviewed_at: typeof e.reviewed_at === 'string' ? e.reviewed_at : null },
      ...(typeof v.std === 'number' ? { std: v.std } : {}) });
  }
  return out;
}

/** Each link as the model now holds it: the approved |mean| and sign, and the sizing the approval was shown, by the authority. */
function linksRead(read: SavedRead, links: readonly StoredLink[]): { holds: boolean; faithful: boolean; written: Rec[] } {
  const kindOf = new Map(nodesOf(read.graph).map((n) => [n.id, n.kind]));
  const edges = Array.isArray(read.graph.edges) ? read.graph.edges.filter(isRec) : [];
  const written = links.map((l) => {
    const edge = edges.find((e) => e.from === l.from && e.to === l.to);
    const mean = isRec(edge?.strength) && typeof edge.strength.mean === 'number' ? edge.strength.mean : undefined;
    const sign = edge?.effect_direction === 'negative' || edge?.effect_direction === 'positive' ? edge.effect_direction
      : mean === undefined ? undefined : mean < 0 ? 'negative' : 'positive';
    const sizing = edge === undefined ? null : linkSizing(edge);
    const holds = mean !== undefined && close(Math.abs(mean), l.magnitude) && sign === l.expected.effect_direction && sizing === l.sizing_after_approval;
    const fromKind = kindOf.get(l.from);
    return { holds, row: { op: 'set_link_strength', from: l.from, to: l.to, band: l.band, figure: mean ?? null, sizing,
      stored_as: edge === undefined ? null : linkProvenanceOf(edge, typeof fromKind === 'string' ? { fromKind } : {}), not_kept: [] } };
  });
  return { holds: written.every((w) => w.holds), faithful: true, written: written.map((w) => w.row) };
}

/** A link set as the door takes it: Olumi's bands only (this path never applies a person's band). */
const linkStrengthsIn = (links: readonly StoredLink[]): NonNullable<CommitOptionLevelsInput['link_strengths']> => links.map((l) => ({ from: l.from,
  to: l.to, magnitude: l.magnitude, intent: l.intent, expected: l.expected, band: l.band, author: 'model_proposed' as const, ...(l.std === undefined ? {} : { std: l.std }) }));

/** The capability's own link set: ONE door call holding only `link_strengths`, idempotent on its own turn (`#links`), so either lane is once. */
function linksApplier(deps: ChangeDeps, ctx: ChangeCtx, p: StructuredProposal, links: readonly StoredLink[]): Applier | ToolOutcome {
  if (deps.commitOptionLevels === undefined) return unavailable('writer_unavailable');
  const commitOptionLevels = deps.commitOptionLevels;
  const turnId = authorisationTurnId(`${p.proposal_id}#links`);
  const readNow = (read: SavedRead) => linksRead(read, links);
  return {
    receiptTurn: turnId,
    baseOf: (read) => read.graphHash,
    readNow,
    commit: (before) => viaDoor(deps, ctx, p, turnId, readNow, () => commitOptionLevels({ scenario_id: ctx.scenario_id,
      base_graph_hash: before.graphHash, turn_id: turnId, links: [], levels: [], link_strengths: linkStrengthsIn(links) })),
  };
}

/** Each rename and removal as the model now holds it: the new name on that one part; the part, or the direct link, gone. */
function structuralRead(read: SavedRead, members: readonly CompoundStructuralMember[]): { holds: boolean; faithful: boolean; written: Rec[] } {
  const nodes = nodesOf(read.graph);
  const edges = Array.isArray(read.graph.edges) ? read.graph.edges.filter(isRec) : [];
  const written = members.map((m) => {
    if (m.kind === 'rename') {
      const at = nodes.filter((n) => n.id === m.node_id);
      return { holds: at.length === 1 && at[0]!.label === m.label, row: { op: 'rename', id: m.node_id, was: m.expected_label, label: at[0]?.label ?? null } };
    }
    const gone = m.node_ids.every((id) => !nodes.some((n) => n.id === id)) && m.edges.every((e) => !edges.some((x) => x.from === e.from && x.to === e.to));
    return { holds: gone, row: { op: 'remove', ids: m.node_ids, links: m.edges, removed: gone } };
  });
  return { holds: written.every((w) => w.holds), faithful: true, written: written.map((w) => w.row) };
}

/** A rename or removal as the existing proposers prepared it (`rename_option`, `remove_node`, `remove_edge`), as the door takes it. */
function membersOf(operations: readonly ProposalOperation[]): CompoundStructuralMember[] | null {
  const out: CompoundStructuralMember[] = [];
  for (const o of operations) {
    const v = isRec(o.value) ? o.value : {};
    const ends = o.path.split('::');
    if (o.op === 'rename_option' && typeof v.expected_label === 'string' && typeof v.label === 'string') {
      out.push({ kind: 'rename', node_id: o.path, expected_label: v.expected_label, label: v.label });
    } else if (o.op === 'remove_node') out.push({ kind: 'remove', node_ids: [o.path], edges: [] });
    else if (o.op === 'remove_edge' && ends.length === 2) out.push({ kind: 'remove', node_ids: [], edges: [{ from: ends[0]!, to: ends[1]! }] });
    else return null;
  }
  return out;
}

/** This path's change: figures, Olumi's link bands, renames and removals, as stored on its ONE proposal. */
type Compound = { readonly figures: Op[]; readonly links: StoredLink[]; readonly structural: CompoundStructuralMember[] };
function compoundOf(p: StructuredProposal): Compound | null {
  const of = (ops: readonly string[]) => p.operations.filter((o) => ops.includes(o.op));
  const figureOps = of(['set_factor_value', 'set_option_intervention']);
  const linkOps = of(['set_link_strength']);
  const structuralOps = of(['rename_option', 'remove_node', 'remove_edge']);
  if (p.operations.length === 0 || figureOps.length + linkOps.length + structuralOps.length !== p.operations.length) return null;
  const figures = declaredOf(figureOps);
  const links = linkOps.length === 0 ? [] : linksOf(linkOps);
  const structural = membersOf(structuralOps);
  return figures === null || links === null || structural === null ? null : { figures, links, structural };
}

/** The whole change as read back: every figure, link, rename and removal holding as approved. */
function compoundRead(read: SavedRead, c: Compound): { holds: boolean; faithful: boolean; written: Rec[] } {
  const parts = [readbackOf(read, c.figures), linksRead(read, c.links), structuralRead(read, c.structural)];
  return { holds: parts.every((x) => x.holds), faithful: parts.every((x) => x.faithful), written: parts.flatMap((x) => x.written) };
}

/** The figures' table and literal-quote check, before any read. */
function figuresAllowed(ops: readonly FigureOp[], ctx: ChangeCtx, at: (i: number) => number = (i) => i): ToolOutcome | null {
  for (const [i, o] of ops.entries()) {
    const holding = holdingOf(o.op === 'set_factor_value' ? 'value' : 'setting', o.source, o.stance);
    if (isBlocked(holding)) return unavailable('blocked_schema', 'none', blockedSaid(at(i), holding.blocked));
    if (o.source.origin !== 'olumi' && (o.source.quote === null || !inTheUsersWords(o.source.quote, ctx))) return refused('quote_not_in_users_words', undefined, { op: at(i) });
  }
  return null;
}

const LINK_LEFT_OUT = 'Not every link in this change could be prepared as asked, so nothing was proposed or saved. Propose those links on their own to see which are left out and why.';

/**
 * GAP 2 (DL ruling B): a compound change as ONE proposal for ONE door commit. Each member is prepared as it would be alone,
 * on this read, and carried literally: the figures by the table, the quote check and the door's plan; each rename and removal
 * by the existing proposer (`prepareStructuralOp`); Olumi's bands by the link capability's ONE rule set (every link asked for
 * must be in its set). One refused or left-out member, or members acting on a part another removes, and nothing is proposed.
 */
async function proposeCompound(deps: Pick<ChangeDeps, 'dispatch' | 'proposals' | 'proposeLinkStrengths'>, ctx: ChangeCtx, args: ProposeChangeArgs,
  figures: readonly FigureOp[], links: readonly LinkArgs[], structural: readonly StructuralArgs[]): Promise<ToolOutcome> {
  const at = (members: readonly unknown[]) => (i: number): number => args.ops.indexOf(members[i] as z.infer<typeof ChangeOp>);
  const stop = figuresAllowed(figures, ctx, at(figures));
  if (stop !== null) return stop;
  const read = await readSaved(deps, ctx.scenario_id);
  if (!isSavedRead(read)) return read;
  if (read.identity === null) return unavailable('read_malformed');
  const figureOps = figures.map(operationOf);
  const declared = declaredOf(figureOps) ?? [];
  const plan = planOf(ctx.scenario_id, '', declared, read.graph);
  if ('refusal' in plan) return stopped(plan, declared, at(figures));
  const prepared: ProposalOperation[] = [];
  const cards: string[] = figures.length > 0 ? [args.public_label] : [];
  for (const [i, m] of structural.entries()) {
    const raw = m.op === 'rename' ? { op: 'rename', kind: m.kind, id: m.target_id, new_label: m.new_label, quote: m.quote }
      : { op: 'remove', kind: m.kind, id: m.target_id, ...(m.to_id === null ? {} : { to_id: m.to_id }), quote: m.quote };
    const one = await prepareStructuralOp({ ...ctx, request_id: ctx.turn_id ?? ctx.scenario_id }, raw, { graph: read.graph, brief_text: read.json.brief_text ?? null });
    if (!one.ok) {
      return refused(codeOf(typeof one.refusal === 'string' ? one.refusal : 'change_refused'), typeof one.detail === 'string' ? one.detail : undefined, { op: at(structural)(i) });
    }
    prepared.push(one.operation);
    cards.push(one.public_label);
  }
  const linkOps: ProposalOperation[] = [];
  if (links.length > 0) {
    const offered = await proposeLinks(deps, ctx, args, links);
    if (offered.status !== 'ok') return offered;
    // The capability's set is a member of this change, never a card of its own.
    const set = deps.proposals.get(String(offered.data.proposal_id));
    if (set !== undefined) deps.proposals.discard(set.proposal_id);
    const got = set === undefined ? null : linksOf(set.operations);
    const left = links.filter((l) => got?.some((g) => g.from === l.from && g.to === l.to) !== true);
    if (set === undefined || got === null || left.length > 0) {
      return refused('link_left_out', LINK_LEFT_OUT, { op: at(links)(links.indexOf(left[0] ?? links[0]!)), left_out: left.map((l) => ({ from: l.from, to: l.to })) });
    }
    linkOps.push(...set.operations);
    cards.push(set.public_label);
  }
  const members = membersOf(prepared);
  if (members === null) return refused('unsupported_change');
  const written = { nodes: [...plan.levels.flatMap((l) => [l.option_id, l.factor_id]), ...(plan.values ?? []).map((v) => v.factor_id), ...(plan.frames ?? []).map((f) => f.factor_id)],
    links: [...plan.links.map((l) => ({ from: l.option_id, to: l.factor_id })), ...links.map((l) => ({ from: l.from, to: l.to }))] };
  if (compoundMembersConflict(written, members)) return refused('compound_members_conflict');
  const p = createProposal({ scenario_id: ctx.scenario_id, user_id: ctx.authenticated_user_id, base_graph_identity_hash: read.identity,
    operations: [...figureOps, ...linkOps, ...prepared], provenance: { authored_by: 'model_proposed', basis: args.basis },
    validation: { admitted: true, loss_count: 0, refusals: [] },
    public_label: cards.length === 1 ? cards[0]! : `Save these changes together:\n${cards.join('\n')}` });
  deps.proposals.put(p);
  return ok({ proposal_id: p.proposal_id, public_label: p.public_label, base_revision: read.identity });
}

export async function proposeChange(deps: Pick<ChangeDeps, 'dispatch' | 'proposals' | 'proposeLinkStrengths'>, ctx: ChangeCtx, args: ProposeChangeArgs): Promise<ToolOutcome> {
  const later = args.ops.find(isNotYet);
  if (later !== undefined) return unavailable(`${later.op}_not_available`, 'none', `${NOT_YET[later.op]} Nothing was proposed or saved.`);
  if (args.public_label.trim() === '') return refused('label_empty');
  const target = args.ops.find((o): o is TargetArgs => o.op === 'set_goal_target');
  if (target !== undefined) return args.ops.length > 1 ? unavailable('mixed_change_not_available', 'none', MIXED_TARGET) : proposeTarget(deps, ctx, args, target);
  const links = args.ops.filter((o): o is LinkArgs => o.op === 'set_link_strength');
  const structural = args.ops.filter((o): o is StructuralArgs => o.op === 'rename' || o.op === 'remove_from_model');
  const ops = args.ops.filter((o): o is FigureOp => o.op === 'set_factor_value' || o.op === 'set_option_setting');
  if (structural.length > 0 || (links.length > 0 && ops.length > 0)) return proposeCompound(deps, ctx, args, ops, links, structural);
  if (links.length > 0) return proposeLinks(deps, ctx, args, links);
  const stop = figuresAllowed(ops, ctx);
  if (stop !== null) return stop;
  const read = await readSaved(deps, ctx.scenario_id);
  if (!isSavedRead(read)) return read;
  if (read.identity === null) return unavailable('read_malformed');
  const content = { scenario_id: ctx.scenario_id, user_id: ctx.authenticated_user_id, base_graph_identity_hash: read.identity,
    operations: ops.map(operationOf), provenance: { authored_by: 'model_proposed' as const, basis: args.basis },
    validation: { admitted: true, loss_count: 0, refusals: [] }, public_label: args.public_label };
  const p = createProposal(content);
  const declared = declaredOf(p.operations) ?? [];
  const plan = planOf(ctx.scenario_id, p.proposal_id, declared, read.graph);
  if ('refusal' in plan) return stopped(plan, declared);
  deps.proposals.put(p);
  return ok({ proposal_id: p.proposal_id, public_label: p.public_label, base_revision: read.identity });
}

/** One kind of approved change: where its own receipt is recorded, how it reads back, and its ONE write. */
interface Applier {
  readonly receiptTurn: string;
  /** The revision the proposal was prepared on, as this kind records it (the capability's link set: the analysis hash). */
  readonly baseOf?: (read: SavedRead) => string | null;
  readonly readNow: (read: SavedRead) => { holds: boolean; faithful: boolean; written: Rec[] };
  readonly commit: (before: SavedRead, reconcile: () => Promise<ToolOutcome>) => Promise<ToolOutcome>;
}

/**
 * ONE door call, then the ONE success predicate for every arm (buddy 16:0x): the complete approved postimage, read back afresh,
 * and THIS commit's own receipt. A verified no-op ("the model already held it") is said as unchanged, with no receipt, and only
 * when the readback holds as approved.
 */
async function viaDoor(deps: ChangeDeps, ctx: ChangeCtx, p: StructuredProposal, turnId: string, readNow: Applier['readNow'],
  commit: () => Promise<CommitOptionLevelsResult>): Promise<ToolOutcome> {
  let res: CommitOptionLevelsResult;
  try {
    res = await commit();
  } catch (err) {
    return err instanceof GraphStaleWriteError ? refused('superseded') : unavailable('not_confirmed', 'unknown');
  }
  if (res.status === 'stale') return refused('superseded');
  if (res.status === 'unconfirmed') return unavailable('not_confirmed', 'unknown');
  if (res.status === 'refused') return refused(codeOf(res.reason), undefined, { ...(res.value ?? res.frame ?? res.pair ?? res.link ?? {}) });
  const after = await readSaved(deps, ctx.scenario_id);
  const back = isSavedRead(after) ? readNow(after) : null;
  if (back === null || !back.holds || !isSavedRead(after)) return unavailable('not_verified', 'unknown');
  if (res.already_applied) {
    deps.proposals.markApplied(p.proposal_id, []);
    return ok({ unchanged: true, faithful: back.faithful, written: back.written });
  }
  if (res.receipt === null || res.receipt.source_turn_id !== turnId) return unavailable('not_verified', 'unknown');
  const receipt: ReceiptSummary = { ...res.receipt, source_turn_id: turnId };
  deps.proposals.markApplied(p.proposal_id, [receipt]);
  return ok({ saved: true, faithful: back.faithful, receipt, revision: { graph_hash: after.graphHash, graph_identity_hash: after.identity },
    written: back.written }, { mutated: true });
}

/**
 * Figures (values and option settings), and a compound (GAP 2): ONE batch-door commit, idempotent on the proposal's
 * authorisation turn. Only a compound carries `compound`: its links ride with its figures, its renames and removals too.
 */
function doorApplier(deps: ChangeDeps, ctx: ChangeCtx, p: StructuredProposal, c: Compound, turnId: string): Applier | ToolOutcome {
  if (deps.commitOptionLevels === undefined) return unavailable('writer_unavailable');
  const commitOptionLevels = deps.commitOptionLevels;
  const readNow = (read: SavedRead) => compoundRead(read, c);
  return {
    receiptTurn: turnId,
    readNow,
    commit: async (before) => {
      const plan = planOf(ctx.scenario_id, p.proposal_id, c.figures, before.graph);
      if ('refusal' in plan) return stopped(plan, c.figures);
      const input: CommitOptionLevelsInput = { scenario_id: ctx.scenario_id, base_graph_hash: before.graphHash, turn_id: turnId,
        links: plan.links, levels: plan.levels, ...(plan.values!.length > 0 ? { values: plan.values } : {}), ...(plan.frames!.length > 0 ? { frames: plan.frames } : {}),
        ...(c.links.length > 0 ? { link_strengths: linkStrengthsIn(c.links) } : {}),
        ...(c.links.length + c.structural.length > 0 ? { compound: { structural: c.structural } } : {}) };
      return viaDoor(deps, ctx, p, turnId, readNow, () => runWithApprovedBindings(plan.bindings, () => commitOptionLevels(input)));
    },
  };
}

/** A goal target: ONE complete candidate, ONE registration (CAS on both base hashes, `operation_id` = the authorisation turn). */
function targetApplier(deps: ChangeDeps, ctx: ChangeCtx, p: StructuredProposal, t: NonNullable<ReturnType<typeof targetOf>>, operationId: string): Applier {
  const receiptTurn = registrationTurnId(ctx.scenario_id, operationId);
  return {
    receiptTurn,
    readNow: (read) => targetRead(read, t),
    commit: async (before, reconcile) => {
      const built = await targetCandidate(ctx.scenario_id, operationId, operationId, t, before.graph, before.graphHash);
      if ('refusal' in built) return built.refusal === 'superseded' ? refused('superseded') : refused(codeOf(built.refusal));
      const candidate = built.candidate;
      let reg: Awaited<ReturnType<InternalDispatch>>;
      try {
        reg = await deps.dispatch(`/assist/v1/scenarios/${ctx.scenario_id}/graph/register`, { graph: candidate,
          expected_graph_hash: before.graphHash, expected_graph_identity_hash: before.identity, operation_id: operationId });
      } catch {
        return unavailable('not_confirmed', 'unknown');
      }
      if (reg.status >= 400 && reg.status < 500) {
        const code = String((isRec(reg.json.details) ? reg.json.details.code : undefined) ?? reg.json.code ?? '');
        // This very operation registered before (a lost response): its own receipt answers, never a second write.
        if (/OPERATION_ID_REUSED/.test(code)) return reconcile();
        return /STALE/.test(code) ? refused('superseded') : refused('register_refused');
      }
      if (reg.status !== 200) return unavailable('not_confirmed', 'unknown');
      const ack = isRec(reg.json.graph_identity_hash) ? reg.json.graph_identity_hash.value : reg.json.graph_identity_hash;
      const after = await readSaved(deps, ctx.scenario_id);
      const mv = isRec(reg.json.model_version) ? reg.json.model_version : undefined;
      if (!isSavedRead(after) || typeof ack !== 'string' || after.identity !== ack || !approvedGraphHeld(candidate, after.graph)
        || !targetRead(after, t).holds || mv === undefined || typeof mv.version_id !== 'string') return unavailable('not_verified', 'unknown');
      const receipt: ReceiptSummary = { version: Number(mv.version_number), version_id: mv.version_id,
        mutation_id: typeof mv.mutation_id === 'string' ? mv.mutation_id : '', source_turn_id: receiptTurn };
      deps.proposals.markApplied(p.proposal_id, [receipt]);
      const back = targetRead(after, t);
      return ok({ saved: true, faithful: back.faithful, receipt, revision: { graph_hash: after.graphHash, graph_identity_hash: after.identity },
        written: back.written }, { mutated: true });
    },
  };
}

export async function applyChange(deps: ChangeDeps, ctx: ChangeCtx, args: ApplyChangeArgs): Promise<ToolOutcome> {
  const p = deps.proposals.get(args.proposal_id);
  if (p === undefined) return refused('unknown_proposal');
  if (p.scenario_id !== ctx.scenario_id || p.user_id !== ctx.authenticated_user_id) return refused('not_authorised');
  const turnId = authorisationTurnId(p.proposal_id);
  const target = targetOf(p);
  const c = target === null ? compoundOf(p) : null;
  if (target === null && c === null) return refused('not_a_change_proposal');
  // The capability's own link set keeps its `#links` turn; every other change is this path's ONE door commit.
  const applier = target !== null ? targetApplier(deps, ctx, p, target, turnId)
    : c!.figures.length + c!.structural.length === 0 ? linksApplier(deps, ctx, p, c!.links) : doorApplier(deps, ctx, p, c!, turnId);
  if (!('commit' in applier)) return applier;
  const prior = await ownReceipt(deps.dispatch, ctx.scenario_id, applier.receiptTurn);
  if (prior === 'unreadable') return unavailable('read_failed');
  const before = await readSaved(deps, ctx.scenario_id);
  if (!isSavedRead(before)) return before;
  // SAVED EARLIER (PL 16:05): this operation's own receipt proves an earlier completed save; what the model holds NOW is said
  // beside it (`holds_now`), never as a new write, and the change is never repeated.
  const alreadySaved = (receipt: ReceiptSummary | null): ToolOutcome => {
    if (receipt !== null) deps.proposals.markApplied(p.proposal_id, [receipt]);
    const now = applier.readNow(before);
    return ok({ already_saved: true, receipt, holds_now: now.holds, faithful: now.faithful, written: now.written });
  };
  if (prior !== null) return alreadySaved(prior);
  const base = applier.baseOf === undefined ? before.identity : applier.baseOf(before);
  if (base === null) return unavailable('read_malformed');
  const decision = deps.proposals.authorise({ proposal_id: p.proposal_id, scenario_id: ctx.scenario_id,
    authenticated_user_id: ctx.authenticated_user_id, current_graph_identity_hash: base, typed_approval_of: p.proposal_id });
  if (decision.status === 'already_applied') return alreadySaved(decision.receipts[0] ?? null);
  if (decision.status !== 'execute') return refused(decision.status);
  const reconcile = async (): Promise<ToolOutcome> => {
    const own = await ownReceipt(deps.dispatch, ctx.scenario_id, applier.receiptTurn);
    return own !== null && own !== 'unreadable' ? alreadySaved(own) : unavailable('not_confirmed', 'unknown');
  };
  return deps.proposals.executeApproved(p, ctx.turn_id ?? turnId, () => applier.commit(before, reconcile),
    (o) => (o.status === 'ok' ? 'applied' : o.status === 'unavailable' && o.write === 'unknown' ? 'unknown' : 'none'), reconcile);
}
