/**
 * ⭐ SYSTEM 2 step 3 (additive; DL ruling 15 Oct ~02:1xZ): an option's setting is the user's through its verified statement,
 * and a draft that carries `statements[]` is read ONLY through them (the whole-raw switch): the legacy `stated_evidence` /
 * `baseline_evidence` apply only to a draft with no `statements[]` at all, never as a per-subject fallback. Both carriers
 * retire together once fresh served raws exist (DL condition 2). Corpus: served raws only (md5 = the DB's).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { verifiedFactorLevel, verifiedOptionSetting } from '../verified-option-setting.js';
import { census, censusInput, level } from './fixtures/r5-verified-cases.js';

type Rec = Record<string, any>;
const load = (f: string): { brief: string; raw: Rec } => {
  const fx = JSON.parse(readFileSync(f, 'utf8')) as { brief: string; raw_text: string };
  return { brief: fx.brief, raw: JSON.parse(fx.raw_text) as Rec };
};
const CAPACITY = load('tests/fixtures/sys2/served-capacity-e4ff6039.json');
const PRICING = load('tests/fixtures/sys2/served-pricing-30d64bc7.json');
const EIGHTY = 'Our existing team resolves 80 tickets per week.';
const optionOf = (raw: Rec, label: string): Rec => raw.options.find((o: Rec) => o.label === label);
const settingOk = (raw: Rec, brief: string, option: string): boolean => {
  const o = optionOf(raw, option);
  return verifiedOptionSetting(raw as never, o as never, o.interventions[0], brief);
};
const without = (raw: Rec, quote: string): Rec => ({ ...raw, statements: raw.statements.filter((s: Rec) => s.quote !== quote) });
const legacyOnly = (raw: Rec): Rec => { const r = { ...raw }; delete r.statements; return r; };

describe('SYSTEM 2 step 3: an option\'s setting through its statement; a draft with statements[] is read only through them', () => {
  const statement = (option: string, factor: string, quote: string, value: number): Rec => ({ quote, subject: { kind: 'option', label: option, to_label: null,
    factor_label: factor }, field: 'level', form: 'point', value, low: null, high: null, unit: null, qualifier: null, conditions: null });
  // Two served briefs from the r5 census whose setting the verifier credits (expected `explicit`, credited by the raw verifier): Saturday sessions, starter tier.
  for (const index of [0, 7]) {
    const c = census[index]!;
    it(`RED + SWITCH (${c.sc}, "${c.option}" → ${c.factor} = ${c.value}): the statement path credits it; with statements[] and none for it, stated_evidence is IGNORED`, () => {
      const { model, brief } = censusInput(index);
      const iv = level(model, c.option, c.factor);
      const option = model.options.find((o) => o.label === c.option)!;
      const quote = (iv as Rec).stated_evidence.quote as string;
      expect(verifiedOptionSetting(model, option, iv, brief)).toBe(true); // legacy: no statements[] at all
      const withIt = { ...model, statements: [statement(c.option, c.factor, quote, c.value)] } as never;
      expect(verifiedOptionSetting(withIt, option, iv, brief)).toBe(true);
      const withoutIt = { ...model, statements: [] } as never;
      expect(verifiedOptionSetting(withoutIt, option, iv, brief)).toBe(false);
      // A statement whose figure is not the setting's is no credit either.
      const wrong = { ...model, statements: [statement(c.option, c.factor, quote, c.value + 1)] } as never;
      expect(verifiedOptionSetting(wrong, option, iv, brief)).toBe(false);
    });
  }

  it('WHOLE-RAW SWITCH (levels, served capacity raw): with statements[] but no statement for the 80, its baseline_evidence is IGNORED', () => {
    const r = without(CAPACITY.raw, EIGHTY);
    const f = r.factors.find((x: Rec) => x.label === 'Existing team support capacity');
    expect(f.baseline_evidence.quote).toBe(EIGHTY);
    expect(verifiedFactorLevel(r as never, f, CAPACITY.brief)).toBe(false);
    expect(verifiedFactorLevel(CAPACITY.raw as never, CAPACITY.raw.factors.find((x: Rec) => x.label === 'Existing team support capacity'), CAPACITY.brief)).toBe(true);
  });

  it('EQUIVALENCE on served settings the verifier cannot credit (capacity e4ff6039, pricing 30d64bc7): the statement path says what the legacy one says', () => {
    expect(settingOk(legacyOnly(CAPACITY.raw), CAPACITY.brief, 'Add one specialist')).toBe(false);
    // S4 SHORTCUT (Paul 15 Oct 09:15Z): the drafter's setting statement is trusted as filed, so the statement path credits it.
    expect(settingOk(CAPACITY.raw, CAPACITY.brief, 'Add one specialist')).toBe(true);
    const iv = optionOf(PRICING.raw, 'Raise Pro price to £59').interventions[0];
    const legacy = settingOk(PRICING.raw, PRICING.brief, 'Raise Pro price to £59');
    const viaStatement = settingOk({ ...PRICING.raw, statements: [statement('Raise Pro price to £59', iv.factor_label, iv.stated_evidence.quote, 59)] }, PRICING.brief, 'Raise Pro price to £59');
    expect([legacy, viaStatement]).toEqual([false, true]);
  });
});
