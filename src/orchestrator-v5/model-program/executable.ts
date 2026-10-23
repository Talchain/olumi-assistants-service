// model-program/executable.ts. S1 writes this file FIRST, exactly as below, and pushes it; S2 copies it byte-identical until S1's push exists.
export type Dist =
  | { kind: 'fixed'; value: number }
  | { kind: 'range'; low: number; high: number; mode?: number; basis: 'person_range' | 'olumi_estimate' };
export type Equation =
  | { form: 'definition'; op: 'sum' | 'difference' | 'product' | 'ratio'; parts: string[] }      // difference/ratio: parts[0] − / ÷ the rest
  | { form: 'effect'; base: string; terms: { coefficient: string; driver: string }[] };         // base + Σ coefficient × driver
export type Stock = { start: string; inflows: string[]; outflows: string[] };                    // per period
export type Quantity = { id: string; unit: string; dist?: Dist; equation?: Equation; stock?: Stock };
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
