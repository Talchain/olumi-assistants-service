/** INERT OpenAI-strict records instruction. Anthropic continues to serve staging v25. */
import { createHash } from 'node:crypto';
import { DRAFT_RECORDS_SHAPE_INSTRUCTION, DRAFT_RECORDS_CONNECT_INSTRUCTION } from './instruction.js';

// Replace the claim-side repetition with one stated relationship. Preserve the remaining v25 rules.
const start = DRAFT_RECORDS_CONNECT_INSTRUCTION.indexOf('When the brief explicitly states a natural effect');
const end = DRAFT_RECORDS_CONNECT_INSTRUCTION.indexOf('Do not emit a factor you cannot connect.', start);
if (start < 0 || end < 0) throw new Error('v25 natural-effect paragraph boundary changed');
const connect = DRAFT_RECORDS_CONNECT_INSTRUCTION.slice(0, start) + DRAFT_RECORDS_CONNECT_INSTRUCTION.slice(end);

export const V_NEXT_TYPED_QUANTITY_INSTRUCTION = `
TYPED QUANTITY EVIDENCE
One quantity, one declaration. A quantity is the stated_items index of the item
that declares it. That item's own quantity is absent or equals its own index.
It declares unit, including the period ("£/month", "vans", "deliveries/month"),
unit_literals, and value_scale when it has a number. Every other record about
that quantity sets quantity to this declaring index and does not restate unit
or value_scale. A range and each end of a relationship use their quantity's unit.
The declaring item may give plausible_max, the largest level the quantity could
plausibly reach; every level is read against it. It is Olumi's estimate unless a
stated figure bounds it. Omit it rather than guess when nothing bounds it.
Never identify endpoints by their labels or by a matching unit.

Copy, do not count. Every *_literal is copied character for character from that
record's own source_quote and must occur there exactly once. If a bare figure
occurs twice, copy it with a neighbouring word. Keep the currency or percent sign
in a figure literal. Never borrow a number or a unit from another clause.

Unit words may be in separate pieces. "We spend £2,400 on fuel every month"
gives value 2400, value_literal "£2,400", unit "£/month", unit_literals
["every month"]. "We make 640 deliveries every month" uses unit
"deliveries/month" and unit_literals ["deliveries", "every month"].

Write value in the declared convention and keep the literal as written.
"a 12% late rate" gives value 0.12, value_scale "unit_interval", unit "%",
value_literal "12%". Declare ratio or raw_count where appropriate; absence
means undeclared, never an assumed unit_interval.

A cause that states an effect owns relationship. Set from_quantity and
to_quantity to the declaring indices. Type signed per_source_change and its
per_source_literal. Type the signed target change as amount and amount_literal,
or range when only bounds are given, or both. Range is the one shared shape
{low, high, low_literal, high_literal, meaning}. Set low <= high; copy each
bound's written figure with any words needed to make it unique. Set meaning
min_max for literal bounds, likely_range only when explicitly likely.
"Adding 5 vans would cut late deliveries by 18 to 36 every month" gives
per_source_change 5, per_source_literal "5 vans", range {low: -36, high: -18,
low_literal: "36", high_literal: "18"}. Both ends and the source figure belong
to one relationship clause. Each, Every or per can locate exactly one source
unit; a signed per_source_change still has absolute size one. Do not repeat the
relationship on a causal_link. The compiler connects its quantity identities.
A stated point must lie within its own range. Do not substitute a midpoint for
a stated point. A range without a point uses its midpoint.

No effect only when said. "Repainting the vans will not change late deliveries"
gives relationship.no_effect_literal "will not change", with no amount and no
range. Silence never means no effect. The compiler withholds that relationship.

On a factor, risk or outcome that IS the total change in another quantity over
the goal's own horizon, set change_of to that quantity's declaring index. The
flow must declare its own unit, or its own quantity with a declared unit; it is
not inherited from change_of. Its unit, period included, must equal the target's
unit. Link it to that quantity with effect positive for a gain, negative for a
loss; no size is needed for this definition. A per-month rate feeding a level
over several months is not a change_of identity. If the flow's declaring item
has horizon_ref, it must name the same horizon as the goal.

An option naming its own setting ("lease 5 more vans") sets quantity to the lever
it sets, the declaring index, which is its own index when it first declares that
lever. It also sets value and value_literal. Do not add a duplicate figure merely
to cite the option's setting. The compiler binds the option to that one lever.
Type how the option sets that lever in setting: "change_by" when it changes the
lever by an amount ("lease 5 more vans" is setting "change_by", value 5; a cut
is negative), "sets_to" when it names the level itself ("run 12 vans in total").
A change_by needs the lever's current level stated elsewhere; never assume zero.
Keep sets_to for other option-to-factor links. The same range shape belongs to
a figure's value or an option link's sets_to, never to a neighbouring quantity.

Keep baseline_ref and horizon_ref: the baseline is a quoted baseline item of the
same quantity, and the horizon is a quoted month-count item. If supplied,
baseline and horizon_months must agree with their references. direction_literal
copies the comparator words for a typed floor or ceiling. Preserve out-of-goal
figures as evidence; never invent a causal connection to bring them into the
goal. The compiler discloses what it cannot place.
`;

export const V_NEXT_DRAFT_RECORDS_INSTRUCTION =
  `${DRAFT_RECORDS_SHAPE_INSTRUCTION}\n${connect}\n${V_NEXT_TYPED_QUANTITY_INSTRUCTION}`.trimEnd();

/** New identity; no historic v25 pin is changed. No provider run is claimed. */
export function vNextDraftRecordsInstructionHash(): string {
  return createHash('sha256').update(V_NEXT_DRAFT_RECORDS_INSTRUCTION, 'utf8').digest('hex');
}
