/**
 * ⭐ SYSTEM 2 step 4 (PROMPT, 15 Oct; DESIGN §4.4): a risk's "holds now" brief sentence (`already_true_quote`, the one quote the
 * statement door's holds-now card binds by) comes, for a draft carrying `statements[]`, ONLY from the risk's verified `holds_now`
 * statement; the legacy `already_true_evidence` applies only to a draft with no `statements[]` at all (DL whole-raw switch,
 * 02:10Z). A conditional reading, or two different sentences, is not "true now" as said: it stays retained in the map, and the
 * risk keeps today's ask. Two served briefs: Paul's marketing brief and the hiring post3007 brief (the sentences served raws
 * 8d31405c and 9d4868bd read as holding now). It records nothing: only the user's press on the card does.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { admitCandidateModel, type CandidateModel } from '../admit-model.js';

type Rec = Record<string, any>;
const MARKETING = { brief: (JSON.parse(readFileSync(new URL('./fixtures/marketing-e2e-de659cfd-read05-before.json', import.meta.url), 'utf8')) as Rec).body.brief_text as string,
  raw: JSON.parse(readFileSync(new URL('./fixtures/marketing-2992-drafter-raw-f81dfd89.json', import.meta.url), 'utf8')) as CandidateModel,
  label: 'Limited marketing experience', sentence: 'I can\'t spend more than 25% of my time on this, and I\'m not that experienced with marketing.' };
const HIRING = { brief: (JSON.parse(readFileSync('tests/fixtures/introduction-stamp/served-hiring-post3007.json', 'utf8')) as Rec).brief as string,
  raw: JSON.parse(readFileSync('tests/fixtures/introduction-stamp/served-hiring-post3007-draft.json', 'utf8')) as CandidateModel,
  label: 'Leadership shortfall', sentence: 'We currently have six mid-weight developers, so we\'re lacking leadership.' };
type Case = typeof MARKETING;

const holdsNow = (c: Case, quote: string, conditions: string | null = null): Rec => ({ quote, subject: { kind: 'risk', label: c.label, to_label: null, factor_label: null },
  field: 'holds_now', form: 'holds_now', value: null, low: null, high: null, unit: null, qualifier: null, conditions });
/** The drafter's candidate with the risk; `legacy` is its `already_true_evidence`, `statements` (when given) its statements[]. */
function candidate(c: Case, legacy: { quote: string } | null, statements?: Rec[]): CandidateModel {
  const raw = structuredClone(c.raw) as Rec;
  return { ...raw, risks: [...raw.risks, { label: c.label, provenance: 'explicit', unit: null, plausible_max: null, already_true_evidence: legacy }],
    links: [...raw.links, { ...structuredClone(raw.links[0]), from: c.label, to: raw.goal.metric, direction: 'negative', effect_amount: null,
      effect_per_source_change: null, effect_provenance: null, source_quote: null }],
    ...(statements !== undefined ? { statements } : {}) } as CandidateModel;
}
const quoteOn = (c: Case, m: CandidateModel): unknown => {
  const n = admitCandidateModel(m, {}, c.brief).nodes.find((x) => x.label === c.label) as Rec | undefined;
  if (n === undefined) throw new Error(`risk ${c.label} not admitted`);
  return n.already_true_quote;
};

describe('SYSTEM 2 step 4: a risk holding now, through its verified holds_now statement', () => {
  for (const c of [MARKETING, HIRING]) {
    it(`${c.label}: the statement path keeps the sentence; with statements[] and none for it, already_true_evidence is IGNORED`, () => {
      expect(c.brief).toContain(c.sentence);
      expect(quoteOn(c, candidate(c, { quote: c.sentence })), 'legacy draft (no statements[])').toBe(c.sentence);
      expect(quoteOn(c, candidate(c, null, [holdsNow(c, c.sentence)])), 'statement path').toBe(c.sentence);
      expect(quoteOn(c, candidate(c, { quote: c.sentence }, [])), 'whole-raw switch').toBeUndefined();
    });
    it(`${c.label}: CONTRASTS: a conditional reading, a sentence not in the brief, or a statement about another risk keeps nothing`, () => {
      expect(quoteOn(c, candidate(c, null, [holdsNow(c, c.sentence, 'if the launch slips')]))).toBeUndefined();
      expect(quoteOn(c, candidate(c, null, [holdsNow(c, 'We have never run a campaign.')]))).toBeUndefined();
      expect(quoteOn(c, candidate(c, null, [{ ...holdsNow(c, c.sentence), subject: { kind: 'risk', label: 'Some other risk', to_label: null, factor_label: null } }]))).toBeUndefined();
    });
  }
});
