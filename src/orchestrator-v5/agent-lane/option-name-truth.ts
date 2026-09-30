/**
 * A display-only reading of an option whose human-authored name still contains an
 * old figure. The graph label remains the tool address and is never rewritten.
 * This deliberately recognises only the PoC's unambiguous single-price case.
 */
export interface OptionNameAlias { readonly raw: string; readonly display: string }

const record = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const periodOf = (s: string): string | null => /\bmonth(?:ly)?\b/i.test(s) ? 'month'
  : /\byear(?:ly)?\b/i.test(s) ? 'year'
  : /\bweek(?:ly)?\b/i.test(s) ? 'week'
  : /\b(?:day|daily)\b/i.test(s) ? 'day' : null;
const pounds = (s: string): boolean => /£|\bGBP\b/i.test(s);

export function optionNameAliases(graph: unknown): ReadonlyMap<string, OptionNameAlias> {
  const nodes = record(graph)?.nodes;
  if (!Array.isArray(nodes)) return new Map();
  const byId = new Map<string, Record<string, unknown>>();
  const options: Record<string, unknown>[] = [];
  for (const value of nodes) {
    const node = record(value);
    if (node === null || typeof node.id !== 'string') continue;
    byId.set(node.id, node);
    if (node.kind === 'option') options.push(node);
  }
  const labels = options.flatMap((o) => typeof o.label === 'string' ? [o.label] : []);
  const aliases = new Map<string, OptionNameAlias>();
  for (const option of options) {
    const label = option.label;
    const interventions = record(option.interventions);
    if (typeof option.id !== 'string' || typeof label !== 'string' || interventions === null) continue;
    // A prefix of another option name is unsafe to replace in a reply.
    if (labels.filter((other) => other === label).length !== 1
      || labels.some((other) => other !== label && other.includes(label))) continue;
    const cells = Object.entries(interventions);
    if (cells.length !== 1) continue;
    const [factorId, rawCell] = cells[0]!;
    const cell = record(rawCell);
    const factor = byId.get(factorId);
    if (cell === null || factor?.kind !== 'factor' || !finite(cell.value)) continue;
    const observed = record(factor.observed_state);
    const factorUnit = typeof observed?.unit === 'string' ? observed.unit : '';
    const cellUnit = typeof cell.unit === 'string' ? cell.unit : '';
    const unit = cellUnit || factorUnit;
    if (!pounds(unit) || (cellUnit && factorUnit && (!pounds(cellUnit) || !pounds(factorUnit)))) continue;
    const cellPeriod = periodOf(cellUnit);
    const factorPeriod = periodOf(factorUnit);
    if (cellPeriod !== null && factorPeriod !== null && cellPeriod !== factorPeriod) continue;
    const frame = finite(observed?.cap) && observed.cap > 1 ? observed.cap
      : finite(factor.scale_frame) && factor.scale_frame > 1 ? factor.scale_frame : null;
    if (frame === null) continue;
    const modelled = cell.value * frame;
    if (!Number.isFinite(modelled)) continue;
    if (cell.raw_value !== undefined && (!finite(cell.raw_value) || Math.abs(modelled - cell.raw_value) > 0.011)) continue;
    const current = finite(cell.raw_value) ? cell.raw_value : modelled;
    // Currency copy rounds to pennies. Refuse if the persisted figure has a
    // finer precision: rounding would make a new claim about the run's input.
    if (Math.abs(current * 100 - Math.round(current * 100)) > 0.000001) continue;
    const figures = [...label.matchAll(/\d[\d,]*(?:\.\d+)?/g)];
    const prices = [...label.matchAll(/£\s*(\d[\d,]*(?:\.\d+)?)(?![\dA-Za-z])/g)];
    // A single price is a target. For the witnessed "from £49 to £59" name,
    // only the second price is the target: £49 is the baseline, kept verbatim.
    // Any other two-figure shape is ambiguous and gets no alias.
    let named: number;
    if (figures.length === 1 && prices.length === 1) {
      named = Number(prices[0]![1]!.replaceAll(',', ''));
    } else if (figures.length === 2 && prices.length === 2) {
      const fromTo = label.match(/\bfrom\s+£\s*(\d[\d,]*(?:\.\d+)?)\s+to\s+£\s*(\d[\d,]*(?:\.\d+)?)(?![\dA-Za-z])/i);
      if (fromTo === null || fromTo[1] !== prices[0]![1] || fromTo[2] !== prices[1]![1]) continue;
      named = Number(fromTo[2]!.replaceAll(',', ''));
    } else continue;
    if (!Number.isFinite(named) || Math.abs(named - current) < 0.005) continue;
    const shown = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 }).format(current);
    const period = cellPeriod ?? factorPeriod;
    aliases.set(option.id, { raw: label, display: `${label} (set to £${shown}${period === null ? '' : `/${period}`})` });
  }
  return aliases;
}
