/**
 * ⭐ WHAT THE USER SAYS ONE FACTOR OF A PRODUCT DOES AT A PRICE — recorded as ONE typed fact, through ONE proposal
 * and ONE approval (rulings: AIQ #70 5854577702 + 5854580520, DL 5854587915, MG interface 5854594598; shape AIQ
 * 5854607789 + Runtime 5854612859).
 *
 * Paul's brief ("reach £20k MRR … increase the Pro plan price from £49 to £59") makes MRR a PRODUCT (the goal carries
 * `nonlinear_identity {operation:'product', factor_ids:[price, subscribers]}`). The user then states today's count and
 * the response at a price: "we have 250 Pro subscribers; at £59 about 30 would leave." That is recorded beside the
 * identity, on the node that carries it, exactly in the interface shape:
 *
 *   stated_response: { operand_node_id, today: { value, unit, by: 'user' }, at: [{ price_node_id, price, level, by: 'user' }] }
 *
 * `level` is the count REMAINING at that price (250 − 30 = 220). No graph hash: the fact lives inside the graph.
 *
 * ⛔ BINDING IS BY CONTENT, DONE BY THE READER (Runtime's AX1, `break-even.ts`): current only while `today.value` is the
 * operand's stored count and that count is the user's, and each `at[].price` is a current option's price on
 * `price_node_id`. So this writer stores exactly those inputs and NOTHING ELSE rewrites the fact: a later edit of
 * today's count or of an option's price leaves it as it was, and it reads stale.
 *
 * ⛔ HELD, NEVER DIRECT (the `goal-current-level.ts` pattern). The proposer writes nothing: ONE content-hashed proposal in
 * the lane's `ProposalStore`, bound to scenario, user and the base revision, applied only by `authorise_change` — ONE
 * `/graph/register`, CAS-gated on the revision the approval read, and re-checked against what the proposal was made on.
 *
 * ⛔ EVERY FIGURE IS ONE THE USER TYPED (`ctx.user_text`, composer messages only — `stated-by-user.ts`): today's count and
 * each response as a plain number (never "£250" or "30%"), each price in the price's own currency. A figure the user
 * did not write refuses the whole proposal and the Agent asks. Typed fields only: nothing here reads free text for
 * meaning.
 *
 * ⛔ TODAY'S COUNT IS THE USER'S (AIQ (b)). When the model holds Olumi's estimate (or an approved assumption) for it, the
 * SAME approval writes the user's stated count onto the operand the way the value path does (`set-factor-value.ts`:
 * `observed_state.source` = `USER_EDIT_SOURCE`, the producer's `extractionType` withdrawn, `provenance: 'user_set'`; on a
 * moved level its own normaliser, display string and link sizing), so AX1 and admission read one authority. With no
 * count the user stated, nothing is prepared and the Agent asks for it.
 *
 * ⛔ NOT THE ENGINE'S: never in `observed_state` (a conditional level is not today), never on the PLoT request
 * (`tools/handlers/stated-response-wire.ts`). Structure, edges, levels and limits are written back byte for byte.
 */
import { isDeepStrictEqual } from 'node:util';
import { USER_EDIT_PROVENANCE, USER_EDIT_SOURCE } from '../../orchestrator/canonicalise-value-ops.js';
import { classifyValueSource } from '../../cee/graph-readiness/obligation-provenance.js';
import { findStatedAmounts, isAmountStatedInBrief } from '../../cee/provenance/stated-amounts.js';
import { classifyUnitScaleClass } from '../../cee/draft/records/unit-scale-class.js';
import { synthesiseDisplayValue } from '../../cee/factor-extraction/display-value.js';
import { frameDefaultedLinks } from '../../cee/magnitude/frame-defaulted-links.js';
import { normaliseFactorValue } from '../tools/handlers/d1-shared/normalise-factor-value.js';
import { STATED_RESPONSE_FIELD } from '../tools/handlers/stated-response-wire.js';
import { figureTheUserWrote } from './stated-by-user.js';
import { unitPhraseFamily, unitPhraseHead } from './unit-conflict.js';
import { figureInUserUnits } from './approval-chips.js';
import { createProposal, type ProposalOperation, type ProposalStore, type ReceiptSummary, type StructuredProposal } from './proposal.js';
import { registrationTurnId } from '../graph-registration/registration-identity.js';
import type { AgentToolContext, ToolResult } from './runtime/agent-tools.js';

/** The proposal op: the estate's node-update op on the node carrying the identity, holding the one fact. */
export const STATED_RESPONSE_OP = 'update_node' as const;
/** At most this many prices in one statement (the add-option cap). */
const MAX_PRICES = 4;

/** The persisted fact — the interface, exactly (`NodeV3.stated_response`). */
export interface StatedResponse {
  readonly operand_node_id: string;
  readonly today: { readonly value: number; readonly unit: string; readonly by: 'user' };
  readonly at: readonly { readonly price_node_id: string; readonly price: number; readonly level: number; readonly by: 'user' }[];
}

/** The Agent's typed arguments. `lost` or `remaining` per price, exactly one — as the user put it. */
export interface StatedResponseArgs {
  readonly operand_label?: unknown;
  readonly today?: unknown;
  readonly at?: unknown;
}

/** The slice of a graph read this module needs — `agent-capabilities.ts`'s `GraphRead` satisfies it. */
export interface StatedResponseRead {
  readonly graph_hash: string;
  readonly graph_identity_hash: string;
  readonly nodes: readonly {
    id: string; kind: string; label: string;
    observed_state?: Record<string, unknown>;
    interventions?: Record<string, unknown>;
  }[];
  readonly raw: Record<string, unknown>;
}

type InternalDispatch = (path: string, body: unknown) => Promise<{ status: number; json: Record<string, unknown> }>;
type Rec = Record<string, unknown>;
type ReadNode = StatedResponseRead['nodes'][number];

/**
 * What the proposal was made on, re-read at apply time and required EQUAL (key order ignored — a durable proposal comes
 * back from JSONB reordered). The analysis hash the store checks does not cover the source of today's count, the
 * identity, or a fact already recorded, so this is the check that an approval lands only on what the user was shown.
 */
interface Against {
  readonly identity: unknown;
  readonly existing: unknown;
  readonly operand: Rec;
  readonly price: Rec;
  readonly cells: Rec;
}

/** Today's count written onto the operand in the SAME registration, when the model does not hold it as the user's. */
interface TodayWrite {
  readonly node_id: string;
  /** Merged over the operand's stored `observed_state`: the source always; value and raw_value when the level moves. */
  readonly observed_state: Rec;
  readonly moved: boolean;
}

interface OpValue {
  readonly stated_response: StatedResponse;
  readonly today_write?: TodayWrite;
  readonly against: Against;
}

const norm = (s: unknown): string => String(s ?? '').toLowerCase().trim();
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const same = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
const field = (n: unknown, key: string): unknown => (isRec(n) ? n[key] : undefined);
const refuse = (refusal: string, detail: string, extra: Rec = {}): ToolResult => ({ ok: false, mutated: false, refusal, detail, ...extra });
/** Only the named keys that are present — so a snapshot never carries an `undefined` a JSON round trip would drop. */
const pick = (o: unknown, keys: readonly string[]): Rec =>
  Object.fromEntries(keys.filter((k) => isRec(o) && o[k] !== undefined).map((k) => [k, (o as Rec)[k]]));

/** A count's unit: stated, and neither money nor a rate/percentage (the MG B3 rule `break-even.ts` applies). */
const isCountUnit = (unit: string): boolean =>
  unit !== '' && unitPhraseFamily(unit) === null && classifyUnitScaleClass(unit) === 'unknown';

/** A stored figure in the user's units, exactly — `break-even.ts`'s own reading (raw_value, or value × cap when exact). */
function exactRaw(stored: unknown, cap: number | undefined): number | null {
  const s = typeof stored === 'number' ? { value: stored } : stored;
  if (!isRec(s)) return null;
  if (num(s.raw_value)) return s.raw_value;
  if (!num(s.value) || cap === undefined) return null;
  const raw = s.value * cap;
  const cents = Math.round(raw * 100) / 100;
  return Math.abs(raw - cents) <= 1e-9 ? cents : null;
}

/** The node's C46 declaration, when it is a two-factor product (the only shape a price × count response fits). */
function productOf(n: ReadNode): readonly [string, string] | null {
  const id = field(n, 'nonlinear_identity');
  if (!isRec(id) || id.operation !== 'product' || !Array.isArray(id.factor_ids) || id.factor_ids.length !== 2) return null;
  const [a, b] = id.factor_ids as unknown[];
  return typeof a === 'string' && typeof b === 'string' && a !== b ? [a, b] : null;
}

/**
 * ⛔ A COUNT THE USER WROTE: `figureTheUserWrote` (the lane's one grounding rule) AND written as a plain number. A unit
 * nobody classifies accepts any written kind there, so "£250" or "30%" would otherwise ground 250 subscribers or 30
 * leaving (30% of 250 is 75). Word numerals ("thirty") refuse: the Agent asks, never under-counts silently.
 */
export function countTheUserWrote(value: number, unit: string, userText: string | null | undefined): boolean {
  return figureTheUserWrote(value, unit, userText)
    && findStatedAmounts(userText).some((a) => a.kind === 'plain' && same(a.magnitude, value));
}

/**
 * ⛔ A PRICE THE USER WROTE, IN THE PRICE'S OWN CURRENCY: `figureTheUserWrote` checks a written amount's kind, never its
 * currency, so "$59" would ground a £59 price; `isAmountStatedInBrief` on the price's unit HEAD ("GBP per month" reads as
 * plain there, and plain refuses every written currency) holds the currency — the `goal-current-level.ts` B1 rule.
 */
export function priceTheUserWrote(value: number, priceUnit: string, userText: string | null | undefined): boolean {
  const unit = unitPhraseFamily(priceUnit) === 'currency' ? (unitPhraseHead(priceUnit) ?? priceUnit) : priceUnit;
  return figureTheUserWrote(value, priceUnit, userText) && isAmountStatedInBrief(value, unit, userText);
}

/** Each option's price on the price factor, in the user's units, where it can be read exactly. */
function optionPrices(nodes: readonly ReadNode[], priceId: string, cap: number | undefined): { option: string; price: number }[] {
  return nodes.flatMap((n) => {
    if (n.kind !== 'option' || !isRec(n.interventions) || !Object.hasOwn(n.interventions, priceId)) return [];
    const p = exactRaw(n.interventions[priceId], cap);
    return p === null ? [] : [{ option: n.label, price: p }];
  });
}

function snapshotOf(g: StatedResponseRead, goalId: string, operandId: string, priceId: string): Against | null {
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const goal = byId.get(goalId);
  const operand = byId.get(operandId);
  const price = byId.get(priceId);
  if (goal === undefined || operand === undefined || price === undefined) return null;
  const cells: Rec = {};
  for (const n of g.nodes) {
    if (n.kind === 'option' && isRec(n.interventions) && Object.hasOwn(n.interventions, priceId)) cells[n.id] = n.interventions[priceId];
  }
  return {
    identity: field(goal, 'nonlinear_identity') ?? null,
    existing: field(goal, STATED_RESPONSE_FIELD) ?? null,
    operand: pick(operand.observed_state, ['value', 'raw_value', 'source', 'unit', 'cap', 'declared_scale']),
    price: pick(price.observed_state, ['value', 'raw_value', 'cap', 'unit']),
    cells,
  };
}

function opValueOf(op: ProposalOperation | undefined): OpValue | undefined {
  if (op?.op !== STATED_RESPONSE_OP || !isRec(op.value) || !isRec(op.value.stated_response) || !isRec(op.value.against)) return undefined;
  return op.value as unknown as OpValue;
}

/** Is this stored proposal a stated response? (`authorise_change` routes it here.) */
export function isStatedResponseProposal(p: StructuredProposal): boolean {
  return p.operations.length === 1 && opValueOf(p.operations[0]) !== undefined;
}

/** The operand's count as stored now is `value`, and it is the user's. */
function holdsUsersCount(node: unknown, value: number): boolean {
  const os = field(node, 'observed_state');
  const raw = exactRaw(os, undefined);
  return raw !== null && same(raw, value) && classifyValueSource(field(os, 'source')) === 'user_stated';
}

/**
 * Prepare the change: every admission question, then ONE held proposal. Writes nothing.
 */
export async function proposeStatedResponse(
  deps: { readonly readGraph: (scenarioId: string) => Promise<StatedResponseRead | null>; readonly proposals: ProposalStore },
  ctx: AgentToolContext,
  args: StatedResponseArgs,
): Promise<ToolResult> {
  const g = await deps.readGraph(ctx.scenario_id);
  if (g === null) return { ok: false, mutated: false, refusal: 'not_found' };
  const text = ctx.user_text;
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const products = g.nodes.flatMap((n) => { const f = productOf(n); return f === null ? [] : [{ carrier: n, factors: f }]; });
  const countLabels = [...new Set(products.flatMap((p) => p.factors.map((id) => `"${byId.get(id)?.label ?? id}"`)))].join(', ') || 'none';

  // ── WHICH FACTOR, OF WHICH PRODUCT? Identity by the label the Agent read from get_canonical_state.
  const requested = String(args?.operand_label ?? '');
  const named = g.nodes.filter((n) => norm(n.label) === norm(requested));
  const operand = named.length === 1 && named[0]!.kind === 'factor' ? named[0]! : undefined;
  const carriers = operand === undefined ? [] : products.filter((p) => p.factors.includes(operand.id));
  if (operand === undefined || carriers.length !== 1) {
    return refuse(
      'not_a_product_factor',
      `${operand === undefined ? `The model has no single factor called "${requested}".` : `"${operand.label}" is not one factor of exactly one goal the model multiplies out.`} ` +
      `A response to a price is recorded only for a factor of a goal that is a product (the factors: ${countLabels}). Nothing was prepared.`,
    );
  }
  const { carrier, factors } = carriers[0]!;
  const priceId = factors[0] === operand.id ? factors[1] : factors[0];
  const price = byId.get(priceId);
  const options = g.nodes.filter((n) => n.kind === 'option');
  const setBy = (id: string): boolean => options.some((o) => isRec(o.interventions) && Object.hasOwn(o.interventions, id));
  if (price === undefined || price.kind !== 'factor' || !setBy(priceId) || setBy(operand.id)) {
    return refuse(
      'no_price_to_respond_to',
      `"${carrier.label}" is ${operand.label} × ${price?.label ?? priceId}, but the options do not set ${price?.label ?? priceId} alone, so there is ` +
      'no price for this response to be at. Nothing was prepared.',
    );
  }

  // ── A COUNT, IN THE OPERAND'S OWN UNIT?
  const os = operand.observed_state;
  const storedUnit = typeof os?.unit === 'string' ? os.unit.trim() : '';
  const todayArg = isRec(args?.today) ? args.today : undefined;
  const statedUnit = typeof todayArg?.unit === 'string' ? todayArg.unit.trim() : '';
  const unit = storedUnit !== '' ? storedUnit : statedUnit;
  if (!isCountUnit(unit) || (statedUnit !== '' && !isCountUnit(statedUnit))) {
    return refuse(
      'not_a_count',
      `"${operand.label}" is ${storedUnit !== '' ? `measured in ${storedUnit}` : 'held with no unit'}${statedUnit !== '' ? ` and the figure came as ${statedUnit}` : ''}: ` +
      'a response to a price is recorded only as a COUNT (for example subscribers), never money or a percentage. Nothing was prepared.',
    );
  }

  // ── TODAY'S COUNT, THE USER'S (AIQ (b)).
  const ask = `Ask the user: "How many ${operand.label} do you have today?"`;
  const storedRaw = exactRaw(os, undefined);
  const storedIsUsers = classifyValueSource(os?.source) === 'user_stated';
  let today: number;
  if (todayArg?.value === undefined) {
    if (storedRaw === null || !storedIsUsers) {
      return refuse(
        'today_unstated',
        `${storedRaw === null ? `The model holds no count of ${operand.label} today` : `${storedRaw} ${unit} today is Olumi's figure, not the user's`}, ` +
        'and a response is recorded only against the count the user gave. Nothing was prepared. ' + ask,
      );
    }
    today = storedRaw;
  } else {
    const v = todayArg.value;
    if (!num(v) || v <= 0) return refuse('unparsable_value', `No usable count of ${operand.label} today was given. Nothing was prepared. ${ask}`);
    if (!countTheUserWrote(v, unit, text)) {
      return refuse(
        'figure_not_in_users_words',
        `${v} is not a count the user wrote in this conversation, so it is never recorded as their ${operand.label} today. ` +
        `Nothing was prepared. ${ask}`,
      );
    }
    today = v;
  }

  // ── THE RESPONSE AT EACH PRICE, IN THE USER'S WORDS, AT A PRICE AN OPTION SETS.
  const pos = price.observed_state;
  const cap = num(pos?.cap) && pos.cap > 0 ? pos.cap : undefined;
  const priceUnit = typeof pos?.unit === 'string' ? pos.unit.trim() : '';
  const priceWords = (p: number): string => figureInUserUnits(p, priceUnit) ?? `${p}${priceUnit !== '' ? ` ${priceUnit}` : ''}`;
  const offered = optionPrices(g.nodes, priceId, cap);
  const atArgs = Array.isArray(args?.at) ? args.at : [];
  if (atArgs.length === 0 || atArgs.length > MAX_PRICES) {
    return refuse('response_unstated', `Give each price the user named (1 to ${MAX_PRICES}) and what they said happens to ${operand.label} at it. Nothing was prepared.`);
  }
  const at: { price_node_id: string; price: number; level: number; by: 'user' }[] = [];
  for (const e of atArgs) {
    const p = field(e, 'price');
    const lost = field(e, 'lost');
    const remaining = field(e, 'remaining');
    const hasLost = lost !== undefined && lost !== null;
    const hasRemaining = remaining !== undefined && remaining !== null;
    if (!num(p) || p <= 0) return refuse('unparsable_value', 'A price with no usable figure was given. Nothing was prepared.');
    if (hasLost === hasRemaining) {
      return refuse(
        'response_unstated',
        `Give ONE of how many ${operand.label} would leave (lost) or how many would stay (remaining) at ${priceWords(p)}, as the user said it. ` +
        'Nothing was prepared.',
      );
    }
    const figure = hasLost ? lost : remaining;
    if (!num(figure) || figure < 0) return refuse('unparsable_value', `No usable count was given for ${priceWords(p)}. Nothing was prepared.`);
    if (!priceTheUserWrote(p, priceUnit, text)) {
      return refuse(
        'figure_not_in_users_words',
        `${priceWords(p)} is not a price the user wrote in this conversation, so nothing is recorded as their response to it. Nothing was prepared. ` +
        'Ask the user which price they mean.',
      );
    }
    if (!countTheUserWrote(figure, unit, text)) {
      return refuse(
        'figure_not_in_users_words',
        `${figure} is not a count the user wrote in this conversation, so it is never recorded as what happens to ${operand.label} at ` +
        `${priceWords(p)}. Nothing was prepared. Ask the user what they expect happens to ${operand.label} at ${priceWords(p)}.`,
      );
    }
    if (hasLost && figure > today) {
      return refuse('not_admitted', `${figure} leaving is more than the ${today} ${unit} there are today. Nothing was prepared. Ask the user to check the figures.`);
    }
    const option = offered.find((o) => same(o.price, p));
    if (option === undefined) {
      return refuse(
        'no_option_at_price',
        `No option sets ${price.label} to ${priceWords(p)} (${offered.map((o) => priceWords(o.price)).join(', ') || 'none can be read'}), and a response is ` +
        'recorded only at a price the model compares. Nothing was prepared.',
      );
    }
    if (at.some((a) => same(a.price, option.price))) return refuse('duplicate_price', `${priceWords(p)} was given twice. Nothing was prepared.`);
    at.push({ price_node_id: priceId, price: option.price, level: hasLost ? today - figure : figure, by: 'user' });
  }
  const fact: StatedResponse = { operand_node_id: operand.id, today: { value: today, unit, by: 'user' }, at };

  // ── TODAY'S COUNT ONTO THE OPERAND, WHEN THE MODEL DOES NOT HOLD IT AS THE USER'S — the value path's shape.
  let todayWrite: TodayWrite | undefined;
  if (!(storedIsUsers && storedRaw !== null && same(storedRaw, today))) {
    if (storedRaw !== null && same(storedRaw, today)) {
      todayWrite = { node_id: operand.id, observed_state: { source: USER_EDIT_SOURCE }, moved: false };
    } else {
      // The level moves. A range or a declared scale is `set-factor-value.ts`'s to re-frame, not this writer's.
      if (os?.cap !== undefined || os?.declared_scale !== undefined) {
        return refuse(
          'today_not_writable_here',
          `The model holds ${storedRaw ?? 'no'} ${unit} for ${operand.label} today on a declared range, so the user's ${today} cannot be recorded in ` +
          'this same change. Nothing was prepared. Ask the user to set today’s count on the model first.',
        );
      }
      try {
        const scaleFrame = field(operand, 'scale_frame');
        const n = normaliseFactorValue({
          rawInput: today,
          unit,
          ...(storedUnit !== '' ? { factorUnit: storedUnit } : {}),
          ...(num(os?.value) ? { factorObservedValue: os.value } : {}),
          ...(num(os?.raw_value) ? { factorObservedRawValue: os.raw_value } : {}),
          ...(num(scaleFrame) ? { factorScaleFrame: scaleFrame } : {}),
          inputHasUnit: true,
        });
        todayWrite = {
          node_id: operand.id,
          observed_state: { value: n.value, raw_value: n.raw_value, ...(storedUnit === '' ? { unit } : {}), source: USER_EDIT_SOURCE },
          moved: true,
        };
      } catch {
        return refuse('today_not_writable_here', `${today} ${unit} cannot be recorded as today's ${operand.label} on the model's own scale. Nothing was prepared.`);
      }
    }
  }
  const existing = field(carrier, STATED_RESPONSE_FIELD);
  if (todayWrite === undefined && isDeepStrictEqual(existing, fact)) {
    return refuse('already_recorded', `That is already recorded as what the user said about ${operand.label}. Nothing to change.`);
  }
  const against = snapshotOf(g, carrier.id, operand.id, priceId)!;

  const todayWords = `${today} ${unit} today` + (todayWrite !== undefined && storedRaw !== null && !same(storedRaw, today)
    ? ` (replacing ${storedRaw}, ${storedIsUsers ? 'your earlier figure' : 'Olumi’s figure'})`
    : todayWrite !== undefined && !storedIsUsers ? ' (as your figure)' : '');
  const atWords = at.map((a) => `at ${priceWords(a.price)}, ${a.level} stay (${today - a.level} leave)`).join('; ');
  const proposal = createProposal({
    scenario_id: ctx.scenario_id,
    user_id: ctx.authenticated_user_id,
    base_graph_identity_hash: g.graph_hash,
    operations: [{
      op: STATED_RESPONSE_OP,
      path: carrier.id,
      value: { stated_response: fact, ...(todayWrite !== undefined ? { today_write: todayWrite } : {}), against },
    }],
    provenance: { authored_by: 'user_stated', basis: 'what the user said happens to a factor of the goal at a price' },
    validation: { admitted: true, loss_count: 0, refusals: [] },
    public_label: `Record what you said about ${operand.label}: ${todayWords}; ${atWords}`,
  });
  deps.proposals.put(proposal);
  return {
    ok: true, mutated: false,
    proposal_id: proposal.proposal_id,
    public_label: proposal.public_label,
    base_revision: g.graph_hash,
    goal: carrier.label,
    operand: operand.label,
    today: { value: today, unit, ...(todayWrite !== undefined && storedRaw !== null && !same(storedRaw, today) ? { replaces: storedRaw } : {}) },
    at: at.map((a) => ({ price: a.price, stay: a.level, leave: today - a.level })),
    note:
      'Nothing has changed. Show the user what will be recorded as THEIR statement — today’s count and, at each price, how many ' +
      'stay — never the id, and call authorise_change with this proposal_id only once they agree.',
  };
}

/** The operand with today's count written the way the value path writes a user's figure (`set-factor-value.ts`). */
function withTodayWritten(node: ReadNode, w: TodayWrite): Rec {
  const { extractionType: _producerRead, elicited_from: _panel, ...kept } = (node.observed_state ?? {}) as Rec;
  const { extractionType: _nodeRead, ...rest } = node as unknown as Rec;
  const observed = { ...kept, ...w.observed_state };
  const out: Rec = { ...rest, observed_state: observed, provenance: USER_EDIT_PROVENANCE };
  if (w.moved) {
    const display = synthesiseDisplayValue({
      ...(num(observed.value) ? { value: observed.value } : {}),
      ...(num(observed.raw_value) ? { raw_value: observed.raw_value } : {}),
      ...(typeof observed.unit === 'string' ? { unit: observed.unit } : {}),
      ...(typeof rest.factor_type === 'string' ? { factor_type: rest.factor_type } : {}),
    });
    if (display !== undefined) out.display_value = display;
    else delete out.display_value;
  }
  return out;
}

/**
 * Apply an APPROVED stated response: ONE registration of the approved read with the fact on the identity's node (and
 * today's count on the operand, when the proposal carries it), CAS-gated on the revision the approval read AND the
 * identity of the same read. "Saved" only when THIS registration answered 200 and a read afterwards holds the fact
 * exactly and the operand's count as the user's.
 */
export async function applyStatedResponse(
  deps: {
    readonly dispatch: InternalDispatch;
    readonly readGraph: (scenarioId: string) => Promise<StatedResponseRead | null>;
    readonly proposals: ProposalStore;
    readonly operationId: (key: string) => string;
  },
  ctx: AgentToolContext,
  proposal: StructuredProposal,
  approved: StatedResponseRead,
): Promise<ToolResult> {
  const op = proposal.operations[0]!;
  const v = opValueOf(op)!;
  const fact = v.stated_response;
  const write = v.today_write;
  const base = { ok: false, mutated: false, applied: false, proposal_id: proposal.proposal_id } as const;
  const carrier = approved.nodes.find((n) => n.id === op.path);
  if (carrier === undefined) return { ...base, refusal: 'not_applied', detail: 'The goal is no longer in the model, so nothing was written.' };
  // ⛔ RE-VALIDATED AT APPLY TIME: the identity, a fact already there, today's count and every option price on the factor.
  const now = snapshotOf(approved, op.path, fact.operand_node_id, fact.at[0]!.price_node_id);
  if (now === null || !isDeepStrictEqual(now, v.against)) {
    return {
      ...base, refusal: 'superseded',
      detail: `"${carrier.label}", today's count or an option's price changed after this was prepared, so nothing was written. Read the model again and propose afresh.`,
    };
  }

  const operationId = deps.operationId(`${proposal.proposal_id}#stated_response`);
  const nodes = approved.nodes.map((n) => {
    if (n.id === op.path) return { ...n, [STATED_RESPONSE_FIELD]: fact };
    if (write !== undefined && n.id === write.node_id) return withTodayWritten(n, write);
    return n;
  });
  // A level that moves sizes Olumi's own links on it, exactly as the value path does (`frameDefaultedLinks`).
  const framed = write?.moved === true ? frameDefaultedLinks({ ...approved.raw, nodes }, write.node_id) : undefined;
  const graph = framed !== undefined && framed.sized.length > 0 ? framed.graph : { ...approved.raw, nodes };
  const reg = await deps.dispatch(`/assist/v1/scenarios/${ctx.scenario_id}/graph/register`, {
    graph,
    ...(approved.graph_hash !== '' ? { expected_graph_hash: approved.graph_hash } : {}),
    ...(approved.graph_identity_hash !== '' ? { expected_graph_identity_hash: approved.graph_identity_hash } : {}),
    operation_id: operationId,
  });
  if (reg.status !== 200) {
    const code = String((reg.json.details as { code?: unknown } | undefined)?.code ?? reg.json.code ?? '');
    return code === 'GRAPH_STALE'
      ? { ...base, refusal: 'superseded', detail: 'The model changed after this was approved, so nothing was written. Read it again and propose afresh.' }
      : { ...base, refusal: 'not_applied', detail: `What the user said could not be saved (http ${reg.status}). Nothing was written.` };
  }
  const receipts: ReceiptSummary[] = [];
  const mv = reg.json.model_version as { version_number?: unknown; version_id?: unknown; mutation_id?: unknown } | undefined;
  if (mv !== undefined && typeof mv.version_id === 'string') {
    receipts.push({
      version: Number(mv.version_number), version_id: mv.version_id,
      mutation_id: typeof mv.mutation_id === 'string' ? mv.mutation_id : '',
      source_turn_id: registrationTurnId(ctx.scenario_id, operationId),
    });
  }
  // ⛔ CONFIRMED FROM STATE: the fact exactly as approved, and today's count as the user's.
  const after = await deps.readGraph(ctx.scenario_id);
  const held = after?.nodes.find((n) => n.id === op.path);
  const operandNow = after?.nodes.find((n) => n.id === fact.operand_node_id);
  const landed = held !== undefined && isDeepStrictEqual(field(held, STATED_RESPONSE_FIELD), fact) && holdsUsersCount(operandNow, fact.today.value);
  if (!landed) {
    return {
      ok: false, mutated: true, applied: false, proposal_id: proposal.proposal_id, refusal: 'not_verified', receipts,
      detail: 'What the user said was saved, but the model changed again straight afterwards, so what it now holds could not be confirmed. Read the model again before saying what it holds.',
    };
  }
  deps.proposals.markApplied(proposal.proposal_id, receipts);
  const operandLabel = approved.nodes.find((n) => n.id === fact.operand_node_id)?.label ?? fact.operand_node_id;
  const priceNode = approved.nodes.find((n) => n.id === fact.at[0]!.price_node_id);
  const priceUnit = typeof priceNode?.observed_state?.unit === 'string' ? priceNode.observed_state.unit.trim() : '';
  const priceWords = (p: number): string => figureInUserUnits(p, priceUnit) ?? `${p}${priceUnit !== '' ? ` ${priceUnit}` : ''}`;
  const t = fact.today;
  return {
    ok: true, mutated: true, applied: true,
    proposal_id: proposal.proposal_id,
    receipts,
    goal: carrier.label,
    recorded: { operand: operandLabel, today: { value: t.value, unit: t.unit }, at: fact.at.map((a) => ({ price: a.price, stay: a.level })) },
    revision_before: approved.graph_hash,
    revision_after: after?.graph_hash ?? approved.graph_hash,
    follow_up:
      `Recorded as you said it: ${t.value} ${t.unit} today` +
      fact.at.map((a) => `; at ${priceWords(a.price)}, ${a.level} stay`).join('') + '.',
    note:
      'Recorded as the user’s own statement, beside the goal. It is Olumi’s arithmetic input, never the analysis engine’s. ' +
      'If today’s count or an option’s price changes later, it no longer applies: ask the user again then.',
  };
}
