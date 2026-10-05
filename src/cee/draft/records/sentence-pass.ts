/**
 * ⭐ THE SENTENCE-LEVEL TYPED LINK PASS: its deterministic inventory, its strict wire shape and its instruction
 * (design: output/model-construction-20261004/DESIGN-SENTENCE-PASS.md §1–§2; PL stop rule, DL-accepted 5 Oct).
 *
 * The pass sees the WHOLE brief plus an inventory of ids (binding condition 1): `S<j>` for every sentence and `F<i>`
 * for every figure the SAME collector the validators use locates (`findStatedAmounts`, as `boundLiteral` and
 * `locatedAmounts` do). The model picks ids; it never writes an offset. The compile maps each id back to its brief span
 * (`SentenceInventory`), and the existing validators decide everything the pass proposes (`sentence-links.ts`).
 *
 * Nothing here reads a label, parses a unit or supplies a value: the inventory enumerates spans, and the wire shape and
 * instruction only ask.
 */
import { z } from 'zod';
import { segmentSentences } from '../../../orchestrator-v5/compose/defaulted-value-egress.js';
import { findStatedAmounts } from '../../provenance/stated-amounts.js';
import {
  DRAFT_RECORD_DIRECTIONS, DRAFT_RECORD_OPTION_SETTINGS, DRAFT_RECORD_UNRESOLVED, DRAFT_RECORD_VALUE_SCALES,
  STATED_RELATIONSHIP_SCHEMA, VALUE_RANGE_SCHEMA, type DraftValueRange,
} from './grammar.js';

/** The wire schema's name: the transport sends it as `text.format.name`, and the eval bank keys on it. */
export const SENTENCE_PASS_SCHEMA_NAME = 'sentence_links';
/**
 * The prompt alias the usage ledger records for this call: the registered construction alias (the registry is pinned;
 * `agent.construct` already covers several construction instructions, told apart by `prompt_sha256` and here also by the
 * schema name `sentence_links`).
 */
export const SENTENCE_PASS_PROMPT_ALIAS = 'agent.construct' as const;

export interface InventorySentence { readonly id: number; readonly start: number; readonly end: number; readonly text: string }
export interface InventoryFigure {
  readonly id: number;
  readonly sentence: number;
  /** Brief offsets of the collector's own matched text. */
  readonly start: number;
  readonly end: number;
  readonly literal: string;
}
export interface SentenceInventory { readonly sentences: readonly InventorySentence[]; readonly figures: readonly InventoryFigure[] }

/**
 * Every sentence (`segmentSentences`: it keeps its separators, so offsets are cumulative lengths) and every figure in
 * it (`findStatedAmounts` over the sentence's own bytes). Ids are 1-based, in brief order. Pure.
 */
export function buildSentenceInventory(brief: string): SentenceInventory {
  const sentences: InventorySentence[] = [];
  const figures: InventoryFigure[] = [];
  let offset = 0;
  for (const segment of segmentSentences(brief)) {
    const sentence: InventorySentence = { id: sentences.length + 1, start: offset, end: offset + segment.text.length, text: segment.text };
    sentences.push(sentence);
    for (const amount of findStatedAmounts(segment.text)) {
      const start = offset + amount.index;
      figures.push({ id: figures.length + 1, sentence: sentence.id, start, end: start + amount.matchedText.length, literal: amount.matchedText });
    }
    offset += segment.text.length + segment.sep.length;
  }
  return { sentences, figures };
}

/** A brief with no located figure makes no pass call (design §1: brief-3 "two developers" is a collector gap). */
export function sentencePassSelected(inventory: SentenceInventory): boolean {
  return inventory.figures.length > 0;
}

/** The pass's input: the whole brief, then the inventory of ids. Offsets are never shown; the model writes none. */
export function renderSentencePassInput(brief: string, inventory: SentenceInventory): string {
  const lines = ['BRIEF', brief, '', 'SENTENCES'];
  for (const s of inventory.sentences) lines.push(`S${s.id}: ${s.text}`);
  lines.push('', 'FIGURES');
  for (const f of inventory.figures) lines.push(`F${f.id}: ${JSON.stringify(f.literal)} in S${f.sentence}`);
  return lines.join('\n');
}

export const SENTENCE_PASS_ROLES = ['goal', 'figure', 'cause', 'option_setting', 'context', 'option_effect'] as const;
export type SentencePassRole = (typeof SENTENCE_PASS_ROLES)[number];
type Fig = number | typeof DRAFT_RECORD_UNRESOLVED;

export interface SentencePassRelationship {
  from_figure: Fig;
  to_figure: Fig;
  amount?: number;
  amount_literal?: string;
  range?: DraftValueRange;
  per_source_change?: number;
  per_source_literal?: string;
  no_effect_literal?: string;
}
export interface SentencePassRecord {
  sentence: number;
  role: SentencePassRole;
  kind?: 'change_quantity';
  quantity_label?: string;
  option_effect?: {
    option_sentence: number;
    option_literal: string;
    quantity_figure: Fig;
    setting: (typeof DRAFT_RECORD_OPTION_SETTINGS)[number];
    value: number;
    value_literal: string;
    range?: DraftValueRange;
  };
  figure?: Fig;
  value?: number;
  value_literal?: string;
  unit?: string;
  unit_literals?: string[];
  value_scale?: (typeof DRAFT_RECORD_VALUE_SCALES)[number];
  quantity_of?: Fig;
  direction?: (typeof DRAFT_RECORD_DIRECTIONS)[number] | typeof DRAFT_RECORD_UNRESOLVED;
  direction_literal?: string;
  baseline_figure?: Fig;
  setting?: (typeof DRAFT_RECORD_OPTION_SETTINGS)[number];
  relationship?: SentencePassRelationship;
}

// ── The wire shape. Reuses the records grammar's own range and relationship shapes (design §2), with the
// relationship's endpoints renamed so the field says which namespace it indexes (design note 1b): figure ids. ──
const FIG_SCHEMA = { anyOf: [{ type: 'integer' }, { type: 'string', enum: [DRAFT_RECORD_UNRESOLVED] }] };
const RELATIONSHIP_PROPERTIES = (STATED_RELATIONSHIP_SCHEMA.properties as Record<string, unknown>);
const { from_quantity: _from, to_quantity: _to, ...relationshipRest } = RELATIONSHIP_PROPERTIES;
const SENTENCE_RELATIONSHIP_SCHEMA = {
  ...STATED_RELATIONSHIP_SCHEMA,
  properties: { from_figure: FIG_SCHEMA, to_figure: FIG_SCHEMA, ...relationshipRest },
  required: ['from_figure', 'to_figure'],
};

/** The pass's base shape (optional fields optional); `strictSentencePassSchema` makes it OpenAI-strict. */
export function buildSentencePassBaseSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      records: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            sentence: { type: 'integer' },
            role: { type: 'string', enum: [...SENTENCE_PASS_ROLES] },
            kind: { type: 'string', enum: ['change_quantity'] },
            quantity_label: { type: 'string' },
            option_effect: {
              type: 'object', properties: {
                option_sentence: { type: 'integer' }, option_literal: { type: 'string' }, quantity_figure: FIG_SCHEMA,
                setting: { type: 'string', enum: [...DRAFT_RECORD_OPTION_SETTINGS] },
                value: { type: 'number' }, value_literal: { type: 'string' }, range: VALUE_RANGE_SCHEMA,
              }, required: ['option_sentence', 'option_literal', 'quantity_figure', 'setting', 'value', 'value_literal'], additionalProperties: false,
            },
            figure: FIG_SCHEMA,
            value: { type: 'number' },
            value_literal: { type: 'string' },
            unit: { type: 'string' },
            unit_literals: { type: 'array', items: { type: 'string' } },
            value_scale: { type: 'string', enum: [...DRAFT_RECORD_VALUE_SCALES] },
            quantity_of: FIG_SCHEMA,
            direction: { type: 'string', enum: [...DRAFT_RECORD_DIRECTIONS, DRAFT_RECORD_UNRESOLVED] },
            direction_literal: { type: 'string' },
            baseline_figure: FIG_SCHEMA,
            setting: { type: 'string', enum: [...DRAFT_RECORD_OPTION_SETTINGS] },
            relationship: SENTENCE_RELATIONSHIP_SCHEMA,
          },
          required: ['sentence', 'role'],
          additionalProperties: false,
        },
      },
    },
    required: ['records'],
    additionalProperties: false,
  };
}

/**
 * OpenAI STRICT: every key required, original optionality as explicit nullability (the records bridge's own rule,
 * `buildStrictDraftRecordsSchema`). A union child is flattened (`anyOf [..., null]`), never nested.
 */
export function strictSentencePassSchema(schema: Record<string, unknown> = buildSentencePassBaseSchema()): Record<string, unknown> {
  const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
  const walk = (s: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = { ...s };
    if (isObject(s.properties)) {
      const required = Array.isArray(s.required) ? s.required : [];
      out.properties = Object.fromEntries(Object.entries(s.properties).map(([key, value]) => {
        if (!isObject(value)) return [key, value];
        const child = walk(value);
        if (required.includes(key)) return [key, child];
        return [key, Array.isArray(child.anyOf) ? { anyOf: [...child.anyOf, { type: 'null' }] } : { anyOf: [child, { type: 'null' }] }];
      }));
      out.required = Object.keys(s.properties);
    }
    if (isObject(s.items)) out.items = walk(s.items);
    return out;
  };
  return walk(schema);
}

const FigZ = z.union([z.number().int(), z.literal(DRAFT_RECORD_UNRESOLVED)]);
const RangeZ = z.object({
  low: z.number(), high: z.number(), low_literal: z.string(), high_literal: z.string(),
  meaning: z.enum(['min_max', 'likely_range']).optional(),
}).strict();
const RecordZ = z.object({
  sentence: z.number().int(),
  role: z.enum(SENTENCE_PASS_ROLES),
  kind: z.literal('change_quantity').optional(),
  quantity_label: z.string().optional(),
  option_effect: z.object({
    option_sentence: z.number().int(), option_literal: z.string(), quantity_figure: FigZ,
    setting: z.enum(DRAFT_RECORD_OPTION_SETTINGS), value: z.number().finite(), value_literal: z.string(), range: RangeZ.optional(),
  }).strict().optional(),
  figure: FigZ.optional(),
  value: z.number().optional(),
  value_literal: z.string().optional(),
  unit: z.string().optional(),
  unit_literals: z.array(z.string()).optional(),
  value_scale: z.enum(DRAFT_RECORD_VALUE_SCALES).optional(),
  quantity_of: FigZ.optional(),
  direction: z.union([z.enum(DRAFT_RECORD_DIRECTIONS), z.literal(DRAFT_RECORD_UNRESOLVED)]).optional(),
  direction_literal: z.string().optional(),
  baseline_figure: FigZ.optional(),
  setting: z.enum(DRAFT_RECORD_OPTION_SETTINGS).optional(),
  relationship: z.object({
    from_figure: FigZ, to_figure: FigZ,
    amount: z.number().optional(), amount_literal: z.string().optional(), range: RangeZ.optional(),
    per_source_change: z.number().optional(), per_source_literal: z.string().optional(), no_effect_literal: z.string().optional(),
  }).strict().optional(),
}).strict();
const PassZ = z.object({ records: z.array(RecordZ) }).strict();

/** Null means omitted (the strict wire's explicit nullability), recursively. */
function dropNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(dropNulls);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== null).map(([k, v]) => [k, dropNulls(v)]));
}

/** The pass's answer, validated; a malformed answer is "pass invalid" (a receipt), never a guess. */
export function parseSentencePassOutput(text: string): { ok: true; records: SentencePassRecord[] } | { ok: false; reason: string } {
  let json: unknown;
  try { json = JSON.parse(text); } catch { return { ok: false, reason: 'sentence_pass_unparsable' }; }
  const parsed = PassZ.safeParse(dropNulls(json));
  if (!parsed.success) return { ok: false, reason: 'sentence_pass_not_a_record_set' };
  return { ok: true, records: parsed.data.records as SentencePassRecord[] };
}

/**
 * The instruction. ONE general rule per field and NO example: no figure, no quoted brief text, nothing from any test
 * brief (a row asserts it). The only quoted token is the typed escape itself.
 */
export const SENTENCE_PASS_INSTRUCTION = `SENTENCE LINKS
You read a strategic brief and type the links its sentences state. The input gives the whole brief, then an inventory: every sentence as S<j> and every stated figure as F<i> with the sentence it sits in. Use the whole brief to understand each sentence; a sentence may refer to a quantity stated in another sentence. Refer to sentences and figures only by their ids. Never write a character position.

Write one record for each stated figure the brief uses, and one record for each sentence that states an effect of one quantity on another or states that something has no effect. Each field has one rule. Set a field to null when its rule does not apply to the record.

sentence: the id of the sentence the record transcribes.
kind: change_quantity only when the quantity is explicitly typed as an increment from today; its level today is definitionally zero, except as a product or ratio identity operand, whose level stays unknown.
quantity_label: on a change_quantity only, name the increment itself rather than the stock it changes.
role: goal for the target the user wants to reach; figure for a stated current level of a quantity; cause for a sentence that states how a change in one quantity changes another, or that it changes nothing; option_setting for the figure an option names as its own setting; context for any other stated figure; option_effect for an effect explicitly tied to a particular option.
figure: the id of the figure the record is about, or "unresolved" when the record has no figure of its own.
value: the record's figure or option effect's number, signed as the brief states it, in the convention value_scale declares.
value_literal: the figure or option effect's characters copied exactly from its own sentence, keeping any currency or percent sign, with a neighbouring word added when the bare characters occur more than once in that sentence.
unit: what the figure is measured in, including its period when the brief gives one.
unit_literals: the words of the record's sentence that state that unit, each copied exactly.
value_scale: the convention value is written in (unit_interval, ratio or raw_count); null when undeclared, never assumed.
quantity_of: the id of the figure that declares the quantity this figure measures, its own id when it declares that quantity, or "unresolved" when the brief does not say which quantity it measures.
direction: on the goal only: floor when the user wants the quantity at or above the figure, ceiling when at or below, "unresolved" when the brief states no comparator.
direction_literal: on the goal only: the comparator words copied exactly from the goal's sentence, or "unresolved".
baseline_figure: on the goal only: the id of the figure stating the current level of the same quantity, or "unresolved".
setting: on an option_setting or option_effect, change_by for a signed shift from the quantity's level today, sets_to for its level under that option.
option_effect: on an option_effect only, transcribe the particular option's intervention on a quantity without adding a causal relationship, using these fields.
option_sentence: the id of the sentence that declares the particular option.
option_literal: the characters in option_sentence that select that option, copied exactly; never omit the option binding.
quantity_figure: the id of the figure declaring the affected quantity, or "unresolved" when the brief does not bind it.
relationship: on a cause only, with these fields.
from_figure: the id of the figure that declares the quantity whose change causes the effect, wherever in the brief it is stated, or "unresolved".
to_figure: the id of the figure that declares the quantity that is changed, wherever in the brief it is stated, or "unresolved".
per_source_change: the signed size of the source change the sentence states; an effect stated for each, every or per single unit has size one.
per_source_literal: the characters of the cause's sentence that state that source change, copied exactly.
amount: the signed change in the changed quantity for that source change.
amount_literal: the characters of the cause's sentence that state that amount, copied exactly.
range: the low and high bounds of the relationship amount or option effect value when the sentence states bounds, low not above high, each bound's characters copied exactly; meaning min_max unless the brief says the bounds are likely values.
no_effect_literal: only when the sentence says the change has no effect: the words that say so, with no amount and no range.

Never take a number, a unit or a word from a sentence other than the one a field names. Never add a link the brief does not state. Write "unresolved" for any link you cannot state from the brief.`;
