/**
 * ⭐ S5 (DL 15 Oct; served hiring e2e on CEE c1e944a4, turn 16): an option named for a count of what it sets ("Hire two
 * developers") whose committed level now holds another count (3 developers) contradicts its own name, and a reopen keeps both.
 * Olumi proposes; the user authors: the name is never changed automatically. The edit's receipt offers ONE rename card, and only
 * its press renames, through the existing label writer (`structural_rename`). This reads the clash and proposes the name.
 *
 * Narrow on purpose: a whole-number count, written as digits or a word from zero to twenty, followed (within three words) by the
 * noun of the level's own unit ("two developers" ↔ unit "developers"). Exactly one such count in the name, or nothing is offered.
 * "a"/"an" and every other wording are left alone. Pure.
 */
import { sayFigureRead } from './say-figure.js';

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen',
  'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'] as const;

export interface OptionLabelCountClash {
  /** The count the name says. */
  readonly said: number;
  /** The count the committed level holds. */
  readonly now: number;
  /** The name with only that count (and its noun's number) changed, in the name's own style. */
  readonly proposed: string;
}

const stemOf = (word: string): string => word.toLowerCase().replace(/[^a-z]/g, '').replace(/s$/, '');
const countOf = (token: string): number | undefined => {
  if (/^\d{1,3}$/.test(token)) return Number(token);
  const i = (WORDS as readonly string[]).indexOf(token.toLowerCase());
  return i >= 0 ? i : undefined;
};
const sameCase = (like: string, word: string): string => (/^[A-Z]/.test(like) ? word.charAt(0).toUpperCase() + word.slice(1) : word);

/** The clash between an option's name and the count its level now holds, with the proposed name; `undefined` when none is clear. */
export function optionLabelCountClash(label: string, unit: string, committed: number): OptionLabelCountClash | undefined {
  const noun = stemOf(unit.trim().split(/\s+/).at(-1) ?? '');
  if (noun === '' || !Number.isInteger(committed) || committed < 0 || committed > 999) return undefined;
  const words = label.trim().split(/\s+/);
  const hits: { at: number; nounAt: number; said: number }[] = [];
  words.forEach((w, at) => {
    const said = countOf(w);
    if (said === undefined) return;
    const nounAt = words.slice(at + 1, at + 4).findIndex((x) => stemOf(x) === noun);
    if (nounAt >= 0) hits.push({ at, nounAt: at + 1 + nounAt, said });
  });
  if (hits.length !== 1 || hits[0]!.said === committed) return undefined;
  const { at, nounAt, said } = hits[0]!;
  const out = [...words];
  out[at] = /^\d+$/.test(words[at]!) || committed > 20 ? String(committed) : sameCase(words[at]!, WORDS[committed]!);
  // The noun agrees with the new count: "one developer", "three developers".
  const n = words[nounAt]!;
  const plural = /s$/i.test(n.replace(/[^A-Za-z]+$/, ''));
  if (committed === 1 && plural) out[nounAt] = n.replace(/s([^A-Za-z]*)$/i, '$1');
  else if (committed !== 1 && !plural) out[nounAt] = n.replace(/([A-Za-z])([^A-Za-z]*)$/, '$1s$2');
  return { said, now: committed, proposed: out.join(' ') };
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);

export interface OptionRenameCard {
  readonly option_id: string;
  readonly expected_label: string;
  readonly label: string;
  /** The card's words: what the name says, what the level now holds, and the proposed name, as a question. */
  readonly words: string;
}

/**
 * The ONE rename card a committed level edit owes, read from the committed graph: the option's name counts its own level's unit,
 * and that count is not what the level now holds. `undefined` when there is no clear clash, or when another node already has the
 * proposed name (a rename never creates two nodes with one name).
 */
export function optionRenameCardOf(graph: unknown, optionId: string, factorId: string): OptionRenameCard | undefined {
  const nodes = isRec(graph) && Array.isArray(graph.nodes) ? graph.nodes.filter(isRec) : [];
  const option = nodes.find((n) => n.id === optionId && n.kind === 'option');
  const factor = nodes.find((n) => n.id === factorId);
  const cells = [option?.interventions, isRec(option?.data) ? (option!.data as Rec).interventions : undefined].find(isRec);
  const cell = cells?.[factorId];
  if (option === undefined || !isRec(cell) || typeof option.label !== 'string' || typeof cell.raw_value !== 'number'
    || typeof cell.unit !== 'string') return undefined;
  const clash = optionLabelCountClash(option.label, cell.unit, cell.raw_value);
  if (clash === undefined) return undefined;
  const taken = (l: unknown): boolean => typeof l === 'string' && l.trim().toLowerCase() === clash.proposed.trim().toLowerCase();
  if (nodes.some((n) => n.id !== optionId && taken(n.label))) return undefined;
  const factorLabel = typeof factor?.label === 'string' ? factor.label : factorId;
  return { option_id: optionId, expected_label: option.label, label: clash.proposed,
    words: `‘${option.label}’ now sets ‘${factorLabel}’ to ${sayFigureRead(clash.now, cell.unit.trim())}, but its name still says ${countWords(clash.said)}. `
      + `Rename it ‘${clash.proposed}’?` };
}

const countWords = (n: number): string => (n <= 20 ? WORDS[n]! : String(n));
