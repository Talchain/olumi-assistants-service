import { GOAL_FIGURES_PLACEHOLDER_PATH, goalFiguresWithheldWarnings } from '../../orchestrator/context/option-result-source.js';
import { readMayNameLeadingOptionFromResult } from '../../orchestrator/context/constraint-feasibility.js';

/** The Run caller records its licence fact; readers never walk the graph again. */
export interface UnsizedPathLink {
  readonly from: string;
  readonly to: string;
  readonly from_label: string;
  readonly to_label: string;
}

export interface UnsizedPathLeaderCause extends UnsizedPathLink {
  readonly links?: readonly UnsizedPathLink[];
}

/** Internal persisted enrichment, deliberately absent from the safe transport allowlist. */
export const UNSIZED_PATH_LEADER_CAUSE_KEY = '__cee_unsized_path_leader_cause';

const record = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;

/** Read only a complete caller-stated cause from the SAME result as the permission. */
export function readUnsizedPathLeaderCause(result: unknown): UnsizedPathLeaderCause | undefined {
  const cause = record(record(record(result)?.enrichment)?.[UNSIZED_PATH_LEADER_CAUSE_KEY]);
  if (cause === null || !['from', 'to', 'from_label', 'to_label'].every(k =>
    typeof cause[k] === 'string' && (cause[k] as string).trim() !== '')) return undefined;
  return { from: cause.from as string, to: cause.to as string,
    from_label: cause.from_label as string, to_label: cause.to_label as string,
    ...(Array.isArray(cause.links) && cause.links.every(l => {
      const link = record(l);
      return link !== null && ['from', 'to', 'from_label', 'to_label'].every(k => typeof link[k] === 'string' && (link[k] as string).trim() !== '');
    }) ? { links: cause.links as unknown as UnsizedPathLink[] } : {}),
  };
}

/** The Run's existing typed warning records the licence withhold independently of its optional stated cause. */
export function unsizedPathLeaderWithheld(result: unknown): boolean {
  const enrichment = record(record(result)?.enrichment);
  return enrichment !== null && goalFiguresWithheldWarnings(enrichment)
    .some(w => w.code === GOAL_FIGURES_PLACEHOLDER_PATH);
}

/** The constraint permission itself passed; the missing path cause must not become a constraint refusal. */
export function unsizedPathLeaderWithheldWithoutConstraintCause(result: unknown): boolean {
  return unsizedPathLeaderWithheld(result) && readMayNameLeadingOptionFromResult(result);
}

/** One list grammar shared by the warning, summary, reply and P5. */
export function linkList(links: readonly UnsizedPathLink[], count = Math.min(3, links.length), quote = true): string {
  const label = (v: string): string => quote ? `‘${v}’` : v;
  const names = links.slice(0, count).map(l => `from ${label(l.from_label)} to ${label(l.to_label)}`);
  const more = links.length - names.length;
  const joined = names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `link${links.length > 1 ? 's' : ''} ${joined}${more > 0 ? ` and ${more} more` : ''}`;
}

/** R8 Science copy: fewer names, then compact labels, only when needed for the 400 character carrier. */
function linkSentence(links: readonly UnsizedPathLink[], legacy: boolean, invite = true): string {
  if (links.length === 0) return '';
  const plural = links.length > 1;
  const render = (named: readonly UnsizedPathLink[], count: number): string => legacy
    ? `Olumi supplied the figures for the ${linkList(named, count)}. Set your own to see how much ${plural ? 'they matter' : 'it matters'}.`
    : `This comparison turns on the ${linkList(named, count)}, whose ${plural ? 'strengths' : 'strength'} nobody has set yet.${invite
      ? ` Set ${plural ? 'them' : 'it'} to see how much ${plural ? 'they matter' : 'it matters'}.` : ''}`;
  for (let count = Math.min(3, links.length); count > 0; count--) {
    const full = render(links, count);
    if (full.length <= 400) return full;
  }
  const compact = (v: string, limit: number): string => v.length <= limit ? v : `${v.slice(0, limit - 1).trimEnd()}…`;
  const blank = links.map(l => ({ ...l, from_label: '', to_label: '' }));
  const budget = Math.max(1, Math.floor((400 - render(blank, 1).length) / 2));
  return render(links.map(l => ({ ...l, from_label: compact(l.from_label, budget), to_label: compact(l.to_label, budget) })), 1);
}

export const unsizedLinkSentence = (links: readonly UnsizedPathLink[]): string => linkSentence(links, false);
/** #2613 CR (b): the same statement with no invitation, for a Run whose goal product (Gate 5) still blocks every option. */
export const unsizedLinkStatement = (links: readonly UnsizedPathLink[]): string => linkSentence(links, false, false);
export const legacyLinkSentence = (links: readonly UnsizedPathLink[]): string => linkSentence(links, true);
