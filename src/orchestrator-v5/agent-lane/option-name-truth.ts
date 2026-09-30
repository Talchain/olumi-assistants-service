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

/**
 * Final answer guard for an Agent's result claim. Only an analytical line or
 * leader clause is changed; an ordinary mention or the user's quoted brief is
 * left verbatim. The read-only alias gives the model the same wording up front.
 */
export function qualifyOptionResultClaims(text: string, aliases: ReadonlyMap<string, OptionNameAlias>): string {
  let answer = text;
  for (const { raw, display } of aliases.values()) {
    const suffix = display.slice(raw.length);
    let at = 0;
    while ((at = answer.indexOf(raw, at)) !== -1) {
      const lineStart = answer.lastIndexOf('\n', at - 1) + 1;
      const lineEndAt = answer.indexOf('\n', at + raw.length);
      const lineEnd = lineEndAt < 0 ? answer.length : lineEndAt;
      const before = answer.slice(lineStart, at);
      const after = answer.slice(at + raw.length, lineEnd);
      // A current reply may compare an earlier Run. Never apply today's level
      // to that historical result, even beneath a Markdown heading and blank
      // line. Only an explicit later current-Run marker supersedes it.
      const lastRunContext = [...answer.slice(0, at).matchAll(/\b(earlier|prior|previous|historical|current|latest)\s+(?:run|analysis|result)\b/gi)].at(-1);
      if (/\b(?:brief|original(?:ly)?|you (?:said|wrote|named)|your words)\b/i.test(before)
        || (lastRunContext !== undefined && /^(?:earlier|prior|previous|historical)$/i.test(lastRunContext[1]!))) {
        at += raw.length; continue;
      }
      const closingQuote = /^["”’]/.test(after) ? 1 : 0;
      const closingBold = after.slice(closingQuote).startsWith('**') ? 2 : 0;
      const closingWidth = closingQuote + closingBold;
      const afterName = after.slice(closingWidth).trimStart();
      const resultClaim = /^:\s*(?:\*\*)?\s*(?:\d+(?:\.\d+)?\s*%|[£$€]?\s*\d)/.test(afterName)
        || /^(?:leads?\b|is\s+(?:the\s+)?(?:leading|winner|best|top)\b)/i.test(afterName)
        || /\b(?:leading option|winner|best option|top option|result for|outcome for|probability for|chance for)\s*(?:is|was|:)?\s*["“‘]?\s*$/i.test(before);
      if (!resultClaim) { at += raw.length; continue; }
      const insertAt = at + raw.length + closingWidth;
      if (answer.slice(insertAt).startsWith(suffix)) { at = insertAt + suffix.length; continue; }
      answer = `${answer.slice(0, insertAt)}${suffix}${answer.slice(insertAt)}`;
      at = insertAt + suffix.length;
    }
  }
  return answer;
}
