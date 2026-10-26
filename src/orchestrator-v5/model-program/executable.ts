// model-program/executable.ts. The S1/S2 interface (DL spike interface, 23 Oct). S1 owns it; S2 imports it.
// r2 (DL rulings on the seam, 23 Oct): every Quantity carries its READING, set by the compiler.
// r3 (DL, phase 0b + gold-model format gaps, 23 Oct): labels; the author of every fixed value; max/min aggregation; a goal
//    or limit read as a ratio of two window aggregates (`per`); `withheld[]` echoed through to the result; limits-only runs.
// r5 (DL, 23 Oct): from_period on OptionSet and Risk may name a quantity (uncertain or per-option timing).
// r4 (PL rulings A and B, 23 Oct): readings are STRUCTURAL only (options and risks never change one); a range carries
//    range_kind (bounds | plausible, from the person's words) and its domain (a stated hard restriction or a mathematical one).
export type FixedAuthor = 'person' | 'olumi' | 'structure';
// structure: an exact constant that defines the model's structure (a unit conversion, a 0/1 switch, a count); never an estimate.
// (r5: no 'placeholder': the compiler never gives an asked fact a value. An asked fact never reaches the executable model.)
export type Dist =
  | { kind: 'fixed'; value: number; author: FixedAuthor }
  | { kind: 'range'; low: number; high: number; mode?: number; basis: 'person_range' | 'olumi_estimate'; range_kind: 'bounds' | 'plausible'; domain?: Domain };
// range_kind: bounds = the person's words fix hard ends ("between", "no more than", "at least"): the ruled Normal CONDITIONED on
//   [low, high], never clamped onto the ends. plausible = a rough span ("about", "roughly", "likely"): read so that it falls
//   below its low end 1 time in 10 and above its high end 1 time in 10, an end on a hard edge of its domain being that edge
//   (W10, interim). Either way the law is Olumi's provisional reading, never the person's calibration (simulate/range-law.ts).
// domain: truncation ONLY for a mathematical domain (a chance in [0, 1], a non-negative count) or a stated hard restriction.
export type Domain = { min?: number; max?: number };
export type Equation =
  | { form: 'definition'; op: 'sum' | 'difference' | 'product' | 'ratio'; parts: string[] }      // difference/ratio: parts[0] − / ÷ the rest
  | { form: 'effect'; base: string; terms: { coefficient: string; driver: string }[] };         // base + Σ coefficient × driver
export type Stock = { start: string; inflows: string[]; outflows: string[] };                    // per period
/**
 * READING CONVENTION (DL ruling on the S1/S2 seam, 23 Oct; S1 owns it, the compiler sets it).
 *  - state: a BOUNDARY reading. S[0] is the initial value; S[t+1] = S[t] + flows(t). Stocks are state; so is anything derived
 *    only from states and constants.
 *  - flow: an INTERVAL reading. Interval t is computed from the start-of-t state. A stock's inflows and outflows are flows; so
 *    is anything depending on one. Everything else is state.
 *  - STRUCTURAL ONLY (PL ruling A): options and risks never change a reading, so adding an option never changes another
 *    option's question. Option sets and risk effects are time-indexed overrides, active at interval t and at boundary t when
 *    t ≥ from_period.
 * Goal and limit aggregation over a window { start_period: s, periods: p }:
 *  - end:                   a state reads S[s+p]; a flow reads interval s+p−1;
 *  - sum:                   the start-of-interval samples s … s+p−1, for a state and a flow alike (the PL's ruling, 23 Oct);
 *  - mean, every, max, min: a flow reads intervals s … s+p−1; a state reads boundaries s+1 … s+p.
 * Interval k is the (k+1)th period: "the stock after six months" is S[6] with window {0, 6}, and "revenue in months 6 to 8"
 * (ordinal) is intervals 5, 6, 7 with window {5, 3}. The horizon `periods` always covers every window; never an extra period
 * to fit a reading.
 */
export type Reading = 'state' | 'flow';
export type Quantity = { id: string; label: string; unit: string; reading: Reading; dist?: Dist; equation?: Equation; stock?: Stock; domain?: Domain };
// Exactly one of dist / equation / stock. An ASKED or UNKNOWN quantity never reaches the executable model: the compiler withholds the goals it feeds.
// domain (spec §3.7): what the value can be, given or worked out: its declared floor and ceiling, within a chance's [0, 1] or a
//   timing's 0 or more. A draw in which its value (after the options and risks act) leaves it is outside the model's domain
//   (invalid_domain) for everything resting on it, never clamped. A range's conditioning stays on its dist.
export type Cmp = '>=' | '<=' | '>' | '<';
export type Window = { start_period: number; periods: number };                                  // 0-based; window measured from the model's period 0
export type Aggregation = 'end' | 'sum' | 'mean' | 'every' | 'max' | 'min';
// max / min: the highest / lowest reading in the window ("reach 400 members within six months" is max ≥ 400).
// per (optional): the goal's value is agg(quantity) ÷ agg(per), both aggregated the same way over the same window, each read
//   by its own reading ("conversion over the first three months" = sum(sign-ups) ÷ sum(visitors)). Never with `every`.
/** no_deadline: the aim states no window, so it is read once with every option in effect, and said "with no deadline". */
export type Goal = { id: string; label: string; quantity: string; per?: string; cmp: Cmp; target: string; aggregation: Aggregation; window: Window; no_deadline?: true };
export type Limit = { id: string; label: string; quantity: string; per?: string; cmp: Cmp; bound: string; aggregation: Aggregation; window: Window; no_deadline?: true };
// from_period: a whole period, or the id of a quantity in the period unit when the timing is uncertain or per option (S2
//   samples it on the same draws; its whole-period reading, e.g. ceil, is with the PL). A fixed timing is always a number.
export type OptionSet = { quantity: string; to: string; from_period: number | string };          // `to` is a quantity id (no bare numbers)
export type Option = { id: string; label: string; sets: OptionSet[] };
export type Risk = { id: string; occurrence: string; severity: string; effect_on: string; mode: 'add' | 'multiply'; from_period: number | string };
// occurrence = a chance quantity (0..1) over the whole horizon; severity is drawn ONLY when it occurs; the effect applies from from_period.
// withheld: every goal, limit, option or risk of the person's model that is NOT in this run, with its reason, echoed unchanged
//   into the result so it can say what the chances cover ("covers productivity and budget only").
export type Withheld = { id: string; kind: 'goal' | 'limit' | 'option' | 'risk'; label: string; reason: string };
// goals may be [] when the run checks limits only (within_limits is then the only result).
export type ExecutableModel = { periods: number; period_unit: 'week' | 'month' | 'year'; quantities: Quantity[]; goals: Goal[]; limits: Limit[]; options: Option[]; risks: Risk[]; withheld: Withheld[] };
