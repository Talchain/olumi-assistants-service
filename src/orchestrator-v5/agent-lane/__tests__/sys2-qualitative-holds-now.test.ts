/**
 * ⭐ AIE 6183352754 H0/H1 (the statements PRODUCER, 15 Oct): 0 of 31 statement-era served raws carried a real holds_now
 * statement, and the instruction's "no numeric interpretation" escape could suppress a safely bound qualitative statement.
 * Now a qualitative current condition is a holds_now statement with null numerics, and the escape is replaced.
 * Rows: the SENT drafter request carries the amended text once (bound to the AIE's packet, never retyped); the host keeps
 * such a statement VERIFIED with no figure (Paul's marketing "not that experienced", hiring "lacking leadership"); a
 * misquoted sentence is REFUSED and kept, never a draft failure. Whether the drafter now emits them is AI behaviour,
 * observed on the served capture (raw → admission → saved → consumer), never claimed here.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { STATEMENTS_INSTRUCTION, buildModelFromBrief } from '../runtime/build-model.js';
import { sourceMapOf, subjectKey } from '../construction-source-map.js';

type Rec = Record<string, any>;
const PACKET = JSON.parse(readFileSync('tests/fixtures/sys2/aie-qualitative-statement-amendment-v1.json', 'utf8')) as { changes: { id: string; old: string; replacement: string }[] };
const MARKETING = { brief: (JSON.parse(readFileSync(new URL('./fixtures/marketing-e2e-de659cfd-read05-before.json', import.meta.url), 'utf8')) as Rec).body.brief_text as string,
  label: 'Limited marketing experience', sentence: 'I can\'t spend more than 25% of my time on this, and I\'m not that experienced with marketing.' };
const HIRING = { brief: (JSON.parse(readFileSync('tests/fixtures/introduction-stamp/served-hiring-post3007.json', 'utf8')) as Rec).brief as string,
  draft: JSON.parse(readFileSync('tests/fixtures/introduction-stamp/served-hiring-post3007-draft.json', 'utf8')) as Rec,
  label: 'Leadership shortfall', sentence: 'We currently have six mid-weight developers, so we\'re lacking leadership.' };
const holdsNow = (label: string, quote: string): Rec => ({ quote, subject: { kind: 'risk', label, to_label: null, factor_label: null },
  field: 'holds_now', form: 'holds_now', value: null, low: null, high: null, unit: null, qualifier: null, conditions: null });

describe('AIE H0/H1: a qualitative current condition is a holds_now statement with null numerics', () => {
  it('RED: the SENT drafter request carries both replacements once, and neither old text', async () => {
    let sent: Rec | undefined;
    await buildModelFromBrief('5e5e5e5e-5e5e-4e5e-8e5e-5e5e5e5e5e5e', HIRING.brief, (async (path: string) => (path.endsWith('/graph/register')
      ? { status: 200, json: { registered: true, model_version: { version_number: 1 } } } : { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: null } })) as never,
    (async (req: Rec) => { sent ??= structuredClone(req); return { text: JSON.stringify(HIRING.draft), status: 'completed' }; }) as never);
    const text = String(sent?.instructions);
    expect(PACKET.changes.map((c) => c.id)).toEqual(['H0', 'H1']);
    for (const c of PACKET.changes) {
      expect(text.split(c.replacement), c.id).toHaveLength(2);
      expect(STATEMENTS_INSTRUCTION.includes(c.old), `${c.id} old text gone`).toBe(false);
    }
  });

  for (const c of [MARKETING, HIRING]) {
    it(`${c.label}: the brief's qualitative sentence, as a holds_now statement with no figure, is VERIFIED and kept by the host`, () => {
      expect(c.brief).toContain(c.sentence);
      const map = sourceMapOf([holdsNow(c.label, c.sentence)], c.brief);
      expect(map.refused).toEqual([]);
      expect(map.verified.get(subjectKey({ kind: 'risk', label: c.label }, 'holds_now'))?.map((s) => [s.quote, s.form, s.low, s.high]))
        .toEqual([[c.sentence, 'holds_now', undefined, undefined]]);
    });
    it(`${c.label}: ⭐ LEAN CORE (DL-3 18 Oct, PL-0048 3): a literal span of the sentence is the user's, recorded with the COMPLETE line as its source; words they never wrote stay refused and kept`, () => {
      const short = c.sentence.split(',').at(-1)!.trim();
      const map = sourceMapOf([holdsNow(c.label, short)], c.brief);
      expect(map.verified.get(subjectKey({ kind: 'risk', label: c.label }, 'holds_now'))?.map((s) => [s.quote, s.form, s.source.includes(c.sentence)]))
        .toEqual([[short, 'holds_now', true]]);
      const unwritten = `${short.replace(/\.$/u, '')} at all.`;
      const refused = sourceMapOf([holdsNow(c.label, unwritten)], c.brief);
      expect(refused.verified.size).toBe(0);
      expect(refused.refused.map((r) => [r.refusal, r.given.quote])).toEqual([['statement_not_found', unwritten]]);
    });
  }
});
