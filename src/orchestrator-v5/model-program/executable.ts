// model-program/executable.ts. The S1/S2 interface (DL spike interface, 23 Oct). S1 owns it; S2 imports it.
// r2 (DL rulings on the seam, 23 Oct): every Quantity carries its READING, set by the compiler.
// r3 (DL, phase 0b + gold-model format gaps, 23 Oct): labels; the author of every fixed value; max/min aggregation; a goal
//    or limit read as a ratio of two window aggregates (`per`); `withheld[]` echoed through to the result; limits-only runs.
export type FixedAuthor = 'person' | 'olumi' | 'structure' | 'placeholder';
// structure: an exact constant that defines the model's structure (a unit conversion, a 0/1 switch, a count); never an estimate.
// placeholder: a value for an asked figure that CANCELS out of every goal and limit in this model (checked numerically by the
//              compiler); it can change no result, and is never shown as anyone's figure.
export type Dist =
  | { kind: 'fixed'; value: number; author: FixedAuthor }
  | { kind: 'range'; low: number; high: number; mode?: number; basis: 'person_range' | 'olumi_estimate' };
export type Equation =
  | { form: 'definition'; op: 'sum' | 'difference' | 'product' | 'ratio'; parts: string[] }      // difference/ratio: parts[0] − / ÷ the rest
  | { form: 'effect'; base: string; terms: { coefficient: string; driver: string }[] };         // base + Σ coefficient × driver
export type Stock = { start: string; inflows: string[]; outflows: string[] };                    // per period
/**
 * READING CONVENTION (DL ruling on the S1/S2 seam, 23 Oct; S1 owns it, the compiler sets it).
 *  - state: a BOUNDARY reading. S[0] is the initial value; S[t+1] = S[t] + flows(t). Stocks are state; so is anything derived
 *    only from states and constants.
 *  - flow: an INTERVAL reading. Interval t is computed from the start-of-t state. A stock's inflows and outflows are flows; so
 *    is anything depending on a flow, or on a period-dated effect (an option set from a period after 0, or a risk effect).
 * Goal and limit aggregation over a window { start_period: s, periods: p }:
 *  - end:                        a state reads S[s+p]; a flow reads interval s+p−1;
 *  - sum, mean, every, max, min: a flow reads intervals s … s+p−1; a state reads boundaries s+1 … s+p.
 * So "the stock after six months" is S[6] with window {0, 6}, and "revenue in months 6 to 8" is intervals 6, 7, 8 with
 * window {6, 3}. The horizon `periods` always covers every window; never an extra period to fit a reading.
 */
export type Reading = 'state' | 'flow';
export type Quantity = { id: string; label: string; unit: string; reading: Reading; dist?: Dist; equation?: Equation; stock?: Stock };
// Exactly one of dist / equation / stock. An ASKED or UNKNOWN quantity never reaches the executable model: the compiler withholds the goals it feeds.
export type Cmp = '>=' | '<=' | '>' | '<';
export type Window = { start_period: number; periods: number };                                  // 0-based; window measured from the model's period 0
export type Aggregation = 'end' | 'sum' | 'mean' | 'every' | 'max' | 'min';
// max / min: the highest / lowest reading in the window ("reach 400 members within six months" is max ≥ 400).
// per (optional): the goal's value is agg(quantity) ÷ agg(per), both aggregated the same way over the same window, each read
//   by its own reading ("conversion over the first three months" = sum(sign-ups) ÷ sum(visitors)). Never with `every`.
export type Goal = { id: string; label: string; quantity: string; per?: string; cmp: Cmp; target: string; aggregation: Aggregation; window: Window };
export type Limit = { id: string; label: string; quantity: string; per?: string; cmp: Cmp; bound: string; aggregation: Aggregation; window: Window };
export type OptionSet = { quantity: string; to: string; from_period: number };                   // `to` is a quantity id (no bare numbers)
export type Option = { id: string; label: string; sets: OptionSet[] };
export type Risk = { id: string; occurrence: string; severity: string; effect_on: string; mode: 'add' | 'multiply'; from_period: number };
// occurrence = a chance quantity (0..1) over the whole horizon; severity is drawn ONLY when it occurs; the effect applies from from_period.
// withheld: every goal, limit, option or risk of the person's model that is NOT in this run, with its reason, echoed unchanged
//   into the result so it can say what the chances cover ("covers productivity and budget only").
export type Withheld = { id: string; kind: 'goal' | 'limit' | 'option' | 'risk'; label: string; reason: string };
// goals may be [] when the run checks limits only (within_limits is then the only result).
export type ExecutableModel = { periods: number; period_unit: 'week' | 'month' | 'year'; quantities: Quantity[]; goals: Goal[]; limits: Limit[]; options: Option[]; risks: Risk[]; withheld: Withheld[] };
