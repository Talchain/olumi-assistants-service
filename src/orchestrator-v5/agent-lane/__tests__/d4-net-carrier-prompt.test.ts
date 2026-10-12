/**
 * D4 (post-F; DL 12 Oct, AIE #94 6132054663): the drafter may propose the EXISTING goal-net accumulation for a stated
 * no-change forecast, in the AIE's words, byte for byte. Three restrictions are REPLACED in place (the identities schema
 * description, its factors description, the net instruction); nothing is appended beside them.
 *
 * The fixture is the AIE's post as fetched, sha-pinned; each replacement is read out of the post here, never retyped.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BUILD_INSTRUCTIONS, buildCandidateSchema } from '../runtime/build-model.js';

const FX = JSON.parse(readFileSync(new URL('./fixtures/aie-d4-net-carrier-6132054663.json', import.meta.url), 'utf8')) as {
  source_pin: string; post_sha256: string; post_text: string; old_markers: Record<string, string> };
/** The quoted line that follows an "Exact replacement for …" header in the post. */
const exact = (header: string): string => {
  const after = FX.post_text.slice(FX.post_text.indexOf(header) + header.length).split('\n').map((l) => l.trim()).filter((l) => l !== '');
  const line = after[0]!;
  expect([line.startsWith('“'), line.endsWith('”')]).toEqual([true, true]);
  return line.slice(1, -1);
};
const DESCRIPTION = exact('Exact replacement for identities schema description (line337):');
const FACTORS = exact('Exact replacement for identities.factors description (line341):');
const NET = exact('Exact replacement for the net instruction (line446):');
const count = (text: string, part: string): number => text.split(part).length - 1;
const identities = (): { description?: unknown; items?: { properties?: { factors?: { description?: unknown } } } } =>
  (buildCandidateSchema().properties as Record<string, never>).identities;

describe('IDENTITY: the AIE post, as fetched', () => {
  it('sha256 dd972077…; read at 86be1ef; three exact replacements, each found once in the post', () => {
    expect(createHash('sha256').update(FX.post_text, 'utf8').digest('hex')).toBe(FX.post_sha256);
    expect(FX.post_sha256).toBe('dd972077d8efb7ab36de8470e374b3b2b34e242c6564d272b23d1709916b089c');
    expect(FX.source_pin).toBe('86be1ef5359f960df69967b14420f0cc0b1a7fc7');
    for (const words of [DESCRIPTION, FACTORS, NET]) expect(count(FX.post_text, words)).toBe(1);
  });
});

describe('the source carries the AIE\'s words in place of the old restrictions', () => {
  it('identities: the schema description is the replacement, exactly; the old "BY DEFINITION … multiplied" gone', () => {
    expect(identities().description).toBe(DESCRIPTION);
    expect(JSON.stringify(buildCandidateSchema())).not.toContain(FX.old_markers['identities.description@337']);
  });
  it('identities.factors: the description is the replacement, exactly; the old "for a stated net change" gone', () => {
    expect(identities().items?.properties?.factors?.description).toBe(FACTORS);
    expect(JSON.stringify(buildCandidateSchema())).not.toContain(FX.old_markers['identities.factors.description@341']);
  });
  it('the net instruction: the replacement, once; the old "ONLY for a stated net change" gone; no paragraph appended', () => {
    expect(count(BUILD_INSTRUCTIONS, NET)).toBe(1);
    expect(BUILD_INSTRUCTIONS).not.toContain(FX.old_markers['BUILD_INSTRUCTIONS.net@446']);
    expect(BUILD_INSTRUCTIONS).not.toContain('NO-CHANGE FORECAST');
    expect(count(BUILD_INSTRUCTIONS, 'reading ‘net’')).toBe(1);
  });
});
