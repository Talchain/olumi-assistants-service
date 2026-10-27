/**
 * MODEL-COMPARE FORMAT TEST (27 Oct, measurement only; never pushed). MC_FORMAT unset = (A), today's drafter, byte for byte.
 * (B) a risk's chance written on the risk (low / likely / high, and whose), turned by `mcShim` into today's occurrence quantity
 *     before the draft is read; (C) a sharper "one statement, one home" rule for evidence, claim, assumption and dissent;
 * (D) a short title on every qualitative record, its full wording in text (titles are stripped before the read and kept in
 *     MC_FORMAT_DIR, so the compiler sees today's shape).
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod-v4';
import { CanonicalModel, CanonicalRisk, CanonicalClaim, CanonicalEvidence, CanonicalAssumption, CanonicalDissent, CanonicalCondition, CanonicalLeftOut } from '../model-program/canonical.js';
import { strictSchema } from './prompt.js';

export const mcFormat = (): 'B' | 'C' | 'D' | null => { const f = process.env['MC_FORMAT']; return f === 'B' || f === 'C' || f === 'D' ? f : null; };

const RISK_OLD = '- Risk: occurrence is a chance quantity (unit "1"); severity is in the affected quantity\'s unit (add) or "1" (multiply).';
const RISK_B = '- Risk: its chance is written on the risk itself: chance low, likely or high (how likely it is to happen at least once over the model\'s horizon), chance_whose person when their words say how likely it is (chance_quote their words) or olumi for Olumi\'s own reading (chance_quote null). severity is in the affected quantity\'s unit (add) or "1" (multiply).';
const ONCE_START = '- One statement, one record';
const ONCE_C = '- One statement, one home. Sort each statement once, by what it is: evidence is something observed or measured (records, a survey, what happened), with its source; a claim is an assertion about the situation with no observation given for it; an assumption is a premise the calculation or the reasoning takes as true without checking; dissent is a view someone holds against another view, with who holds it. Never put one statement in two families, and never restate a claim as an assumption or as evidence: an assertion and the evidence for it stay two records, the evidence concerning the claim; a figure and the relationship assumed about it stay two. left_out holds only what matters to the result but cannot be calculated, with the reason; a condition the plan must not break → limits, a prerequisite or a doubt → conditions.';
const TITLE_D = '- Every claim, evidence, assumption, dissent, condition and left_out record has a title: a few words (at most six) naming it, so it reads at a glance; its full wording goes in text (a dissent\'s in position). Labels of quantities, goals, options and risks are kept as short.';

export function mcInstructions(base: string): string {
  const f = mcFormat();
  if (f === null) return base;
  const lines = base.split('\n');
  const at = (p: string) => { const i = lines.findIndex((l) => l.startsWith(p)); if (i < 0) throw new Error(`mc-format: no line ${p}`); return i; };
  if (f === 'B') lines[at(RISK_OLD)] = RISK_B;
  if (f === 'C') lines[at(ONCE_START)] = ONCE_C;
  if (f === 'D') lines.splice(at(ONCE_START) + 1, 0, TITLE_D);
  return lines.join('\n');
}

const title = z.string().describe('A few words (at most six) naming this record; the full wording goes in text.');
const RiskB = CanonicalRisk.omit({ occurrence: true }).extend({
  chance: z.enum(['low', 'likely', 'high']).describe('How likely it is to happen at least once over the model horizon.'),
  chance_whose: z.enum(['person', 'olumi']).describe('person: their words say how likely; olumi: Olumi\'s own reading.'),
  chance_quote: z.string().nullable().describe('With chance_whose person: their words, copied exactly. Null otherwise.'),
}).strict();
const cached = new Map<string, Readonly<Record<string, unknown>>>();
export function mcSchema(base: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const f = mcFormat();
  if (f === null || f === 'C') return base;
  const hit = cached.get(f); if (hit) return hit;
  const m = CanonicalModel.omit({ history: true });
  const built = Object.freeze(strictSchema(f === 'B' ? m.extend({ risks: z.array(RiskB) }) : m.extend({
    claims: z.array(CanonicalClaim.extend({ title }).strict()), evidence: z.array(CanonicalEvidence.extend({ title }).strict()),
    assumptions: z.array(CanonicalAssumption.extend({ title }).strict()), dissent: z.array(CanonicalDissent.extend({ title }).strict()),
    conditions: z.array(CanonicalCondition.extend({ title }).strict()), left_out: z.array(CanonicalLeftOut.extend({ title }).strict()),
  })));
  cached.set(f, built); return built;
}

/** B's mapping (stated in the report): low 0.1 (0.05–0.2), likely 0.55 (0.4–0.7), high 0.8 (0.7–0.9), plausible, unit 1. */
const CHANCE = { low: [0.1, 0.05, 0.2], likely: [0.55, 0.4, 0.7], high: [0.8, 0.7, 0.9] } as const;
const QUAL = ['claims', 'evidence', 'assumptions', 'dissent', 'conditions', 'left_out'] as const;
const isRec = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

/** A first draft's raw JSON, before the host reads it: B's chance into an occurrence quantity; D's titles kept aside. */
export function mcShim(json: unknown, sourceText: string, attempt: number): unknown {
  const f = mcFormat();
  if (f === null || f === 'C' || !isRec(json)) return json;
  const dir = process.env['MC_FORMAT_DIR'];
  const keep = (what: string, data: unknown) => { if (!dir) return; mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${createHash('sha256').update(sourceText).digest('hex').slice(0, 12)}-${Date.now()}-a${attempt}-${what}.json`), JSON.stringify(data)); };
  if (f === 'B' && Array.isArray(json['risks']) && Array.isArray(json['quantities'])) {
    const qs = [...json['quantities']]; const kept: unknown[] = [];
    const risks = json['risks'].map((r) => {
      if (!isRec(r) || !(typeof r['chance'] === 'string' && r['chance'] in CHANCE)) return r;
      const { chance, chance_whose, chance_quote, ...rest } = r; const [value, low, high] = CHANCE[chance as keyof typeof CHANCE];
      const person = chance_whose === 'person' && typeof chance_quote === 'string';
      const qid = `${String(r['id'])}_chance`;
      qs.push({ id: qid, label: `Chance: ${String(r['label'] ?? r['id'])}`, unit: '1', value, low, high, range_kind: 'plausible', floor: 0, ceiling: 1,
        kind: 'coefficient', status: person ? 'known' : 'estimated', question: null, basis: `Read from "${String(chance)}" (${person ? 'their words' : 'Olumi\'s reading'}).`,
        direction: null, author: person ? 'person' : 'olumi', party: null, quote: person ? chance_quote : null });
      kept.push({ id: r['id'], chance, chance_whose, chance_quote });
      return { ...rest, occurrence: qid };
    });
    keep('chance', kept);
    return { ...json, quantities: qs, risks };
  }
  if (f === 'D') {
    const titles: Record<string, unknown[]> = {};
    const out = { ...json };
    for (const fam of QUAL) {
      if (!Array.isArray(json[fam])) continue;
      out[fam] = (json[fam] as unknown[]).map((r) => { if (!isRec(r)) return r; const { title: t, ...rest } = r; (titles[fam] ??= []).push({ id: r['id'], title: t, text: r['text'] ?? r['position'] }); return rest; });
    }
    keep('titles', { titles, labels: Object.fromEntries(['quantities', 'goals', 'options', 'risks'].map((k) => [k, Array.isArray(json[k]) ? (json[k] as unknown[]).map((r) => (isRec(r) ? r['label'] : null)) : []])) });
    return out;
  }
  return json;
}
