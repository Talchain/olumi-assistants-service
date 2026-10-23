// model-program/executable.ts. The S1/S2 interface (DL spike interface, 23 Oct). S1 owns it; S2 imports it.
// r2 (DL rulings on the seam, 23 Oct): every Quantity carries its READING, set by the compiler.
export type Dist =
  | { kind: 'fixed'; value: number }
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
 *  - end:              a state reads S[s+p]; a flow reads interval s+p−1;
 *  - sum, mean, every: a flow reads intervals s … s+p−1; a state reads boundaries s+1 … s+p.
 * So "the stock after six months" is S[6] with window {0, 6}, and "revenue in months 6 to 8" is intervals 6, 7, 8 with
 * window {6, 3}. The horizon `periods` always covers every window; never an extra period to fit a reading.
 */
export type Reading = 'state' | 'flow';
export type Quantity = { id: string; unit: string; reading: Reading; dist?: Dist; equation?: Equation; stock?: Stock };
// Exactly one of dist / equation / stock. An ASKED or UNKNOWN quantity never reaches the executable model: the compiler withholds the goals it feeds.
export type Cmp = '>=' | '<=' | '>' | '<';
export type Window = { start_period: number; periods: number };                                  // 0-based; window measured from the model's period 0
export type Aggregation = 'end' | 'sum' | 'mean' | 'every';
export type Goal = { id: string; quantity: string; cmp: Cmp; target: string; aggregation: Aggregation; window: Window };
export type Limit = { id: string; quantity: string; cmp: Cmp; bound: string; aggregation: Aggregation; window: Window };
export type OptionSet = { quantity: string; to: string; from_period: number };                   // `to` is a quantity id (no bare numbers)
export type Option = { id: string; label: string; sets: OptionSet[] };
export type Risk = { id: string; occurrence: string; severity: string; effect_on: string; mode: 'add' | 'multiply'; from_period: number };
// occurrence = a chance quantity (0..1) over the whole horizon; severity is drawn ONLY when it occurs; the effect applies from from_period.
export type ExecutableModel = { periods: number; period_unit: 'week' | 'month' | 'year'; quantities: Quantity[]; goals: Goal[]; limits: Limit[]; options: Option[]; risks: Risk[] };
