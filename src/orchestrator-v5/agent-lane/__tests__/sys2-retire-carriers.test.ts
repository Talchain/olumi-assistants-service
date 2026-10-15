/**
 * ⛔ SYSTEM 2 retirement of `baseline_evidence` + `stated_evidence` (DL ruling 15 Oct ~02:4xZ, PROMPT's default adopted):
 * the drafter is no longer sent them; the strict provider boundary REQUIRES `statements` (decoder-enforced), so a served raw
 * always carries `statements[]` and never reaches the one recorded-raw reader; only recordings made before SYSTEM 2 do.
 * An invalid or unverifiable statement is REFUSED (kept, unknown), never a draft failure (the DL's #3152 condition).
 * Corpus: the served capacity raw e4ff6039 (md5 = the DB's), which still carries both retired carriers.
 */
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildCandidateSchema, buildModelFromBrief, strictForTheDrafter } from '../runtime/build-model.js';
import { recordedRawLevelQuote, recordedRawSettingQuote } from '../verified-option-setting.js';
import { sourceMapOf } from '../construction-source-map.js';

type Rec = Record<string, any>;
const SERVED = JSON.parse(readFileSync('tests/fixtures/sys2/served-capacity-e4ff6039.json', 'utf8')) as { brief: string; raw_text: string };
const RAW = JSON.parse(SERVED.raw_text) as Rec;
const sid = '7a7a7a7a-7a7a-4a7a-8a7a-7a7a7a7a7a7a';
// Two builds are compared whole: construction records its statements with the build's time (AIE 6183705670), so the clock is pinned.
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-15T03:00:00.000Z')); });
afterEach(() => { vi.useRealTimers(); });
async function registered(draft: Rec): Promise<Rec> {
  let graph: Rec | undefined;
  const result = await buildModelFromBrief(sid, SERVED.brief, (async (path: string, body: Rec) => {
    if (path.endsWith('/graph/register')) { graph = structuredClone(body.graph); return { status: 200, json: { registered: true, model_version: { version_number: 1 } } }; }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: null } };
  }) as never, (async () => ({ text: JSON.stringify(draft), status: 'completed' })) as never) as Rec;
  if (result.ok !== true || graph === undefined) throw new Error(JSON.stringify(result).slice(0, 2000));
  return graph;
}
const stripped = (r: Rec): Rec => ({ ...r, factors: r.factors.map(({ baseline_evidence: _b, ...f }: Rec) => f),
  options: r.options.map((o: Rec) => ({ ...o, interventions: o.interventions.map(({ stated_evidence: _s, ...i }: Rec) => i) })) });
const required = (s: unknown): string[] => (s as { required?: string[] }).required ?? [];

describe('SYSTEM 2 retirement: the carriers are not sent, and a served raw never reaches the recorded-raw reader', () => {
  it('the strict provider boundary requires statements[] and names neither retired carrier; the candidate contract keeps statements optional', () => {
    const sent = strictForTheDrafter(buildCandidateSchema());
    expect(required(sent)).toContain('statements');
    expect(JSON.stringify(sent)).not.toMatch(/baseline_evidence|stated_evidence/);
    expect(required(strictForTheDrafter(buildCandidateSchema(), { providerBoundary: false }))).not.toContain('statements');
  });

  it('NEVER REACHES: the served raw still holds both carriers, yet the reader gives nothing and the registered graph equals the stripped raw\'s', async () => {
    const factor = RAW.factors.find((f: Rec) => f.label === 'Existing team support capacity');
    const iv = RAW.options.find((o: Rec) => o.label === 'Add one specialist').interventions[0];
    expect([factor.baseline_evidence?.quote, typeof iv.stated_evidence?.quote]).toEqual(['Our existing team resolves 80 tickets per week.', 'string']);
    expect([recordedRawLevelQuote(RAW as never, factor), recordedRawSettingQuote(RAW as never, iv)]).toEqual([undefined, undefined]);
    // CONTRAST: the same recording without statements[] (made before SYSTEM 2) is read through the reader.
    const { statements: _st, ...recording } = RAW;
    expect(recordedRawLevelQuote(recording as never, factor)).toBe('Our existing team resolves 80 tickets per week.');
    expect(await registered(RAW)).toEqual(await registered(stripped(RAW)));
  });

  it('an invalid or unverifiable statement is REFUSED and kept, never a draft failure', async () => {
    const bad = [{ quote: 'We resolve 999 tickets per week.', subject: { kind: 'factor', label: 'Existing team support capacity' }, field: 'level', form: 'point', value: 999 },
      { quote: 42, subject: 'nope', field: 'colour' }];
    const draft = { ...RAW, statements: [...RAW.statements, ...bad] };
    const map = sourceMapOf(draft.statements, SERVED.brief);
    const added = map.refused.filter((r) => r.index >= RAW.statements.length);
    expect(added.map((r) => [r.index, r.refusal])).toEqual([[RAW.statements.length, 'statement_not_found'], [RAW.statements.length + 1, 'statement_malformed']]);
    expect(added[0]!.given.quote).toBe('We resolve 999 tickets per week.');
    const g = await registered(draft);
    expect(g.nodes.length).toBeGreaterThan(0);
    expect(g).toEqual(await registered(RAW));
  });
});
