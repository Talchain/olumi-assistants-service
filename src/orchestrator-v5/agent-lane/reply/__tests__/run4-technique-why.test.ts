/**
 * Technique (c) (AIE 6130197656 §3, DL 12 Oct): the policy's "Why?" is never attached to a reply. It stays with the
 * guidance row: the row shows its own why (`copy.why`, the variant's why_now), and its science basis is the row's detail
 * on click (`guidance.slot1.science`; RC-WIDEN `progressive_detail`: "Detail on click: the science basis in one
 * sentence"). Ordinary replies answer the ask; the model's context keeps the method (`eligible_intervention`), so a user
 * who asks about it gets it explained.
 *
 * The corpus is every run 4 reply (CEE a770ce49) that ended with the appended "Why? …" (5 of 54 turns), sha-pinned
 * (`fixtures/run4-technique-why.json`). Hiring 2 asked whether faint connections were a UI or a data issue, and was told
 * "Why? Assumption-based planning: …"; hiring 15 asked how many developers and what budget, and got the row's own why
 * a second time. The three conversational inputs are rebuilt as the route passes them; on the served composer each
 * reproduces its served reply byte for byte (scratch spec), and R4's composition of each (2e7c4a46) is recorded.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import fx from './fixtures/run4-technique-why.json';
import { composeReplyShape } from '../compose-reply.js';
import { eligibleInterventionFor, guidanceWireFor } from '../../turn-context/guidance-wire.js';

type Rec = Record<string, any>;
const cases = fx.cases as unknown as Record<string, Rec>;
const paras = (t: string): string[] => t.split('\n\n');
const count = (text: string, s: string): number => text.split(s).length - 1;
/** A conversational turn's composer input, as `agent-v1-turn.ts` passes it (profile coaching, no face contract). */
function coachingInput(c: Rec): Rec {
  const s = c.served_shape as Rec; const label = c.guidance_slot1.primary_action.label as string;
  const own = (s.bullets as string[]).filter((b) => b !== label).map((b) => `- ${b}`);
  const detail = paras(String(s.detail)).filter((p) => p !== `Why? ${c.served_why}` && p !== `- ${label}`);
  const text = [s.headline, ...(own.length > 0 ? [own.join('\n')] : []), ...detail].join('\n\n');
  return { text, profile: 'coaching', eligibleIntervention: eligibleInterventionFor({ slot1: c.guidance_slot1 } as never), interventionActionLabel: label };
}
const CONVERSATIONAL = ['deadline_02', 'hiring_02', 'hiring_15'];

describe('IDENTITY: the five served replies that carried the appended Why?', () => {
  for (const [name, c] of Object.entries(cases)) {
    it(`${name}: sha-pinned; ends with "Why? <the method's why>"; the model's context had that same method`, () => {
      expect(createHash('sha256').update(String(c.assistant_text)).digest('hex')).toBe(c.text_sha256);
      expect(String(c.assistant_text).endsWith(`\n\nWhy? ${c.served_why}`)).toBe(true);
      expect(eligibleInterventionFor({ slot1: c.guidance_slot1 } as never)?.why, 'the method the model is told is the row\'s own').toBe(c.served_why);
    });
  }
});

describe('(c) the reply: no Why? is attached; the action stays; nothing else moves', () => {
  for (const name of CONVERSATIONAL) {
    it(`${name}: R4's reply less its "Why?" paragraph, shipped whole; the row's action said once`, () => {
      const c = cases[name]!;
      const out = composeReplyShape(coachingInput(c) as never);
      expect(out.text).not.toContain('Why? ');
      expect(out.text).toBe(String(c.r4_composition.text).replace(`\n\nWhy? ${c.served_why}`, ''));
      expect(out.shape).toBeNull();
      expect(count(out.text, `- ${c.guidance_slot1.primary_action.label}`), 'the action, once').toBe(1);
    });
  }
});

describe('(c) the row: its explanation is carried with the current guidance', () => {
  for (const [name, c] of Object.entries(cases)) {
    const row = c.guidance_slot1 as Rec;
    it(`${name} (${row.policy_id} ${row.variant}): the row's science basis is its detail when true of the variant, else its own why already says it`, () => {
      const wire = guidanceWireFor({ slot1: row } as never, null)!;
      expect([wire.slot1!.policy_id, wire.slot1!.variant, wire.slot1!.state_key_hash], 'the same row').toEqual([row.policy_id, row.variant, row.state_key_hash]);
      if (c.served_why === row.copy.why) {
        // RC-WIDEN W6: the appended Why? repeated the row's own visible why; no science sentence is true of W6 (SYS2 G1).
        expect(wire.slot1).not.toHaveProperty('science');
      } else {
        expect((wire.slot1 as Rec).science, 'the science basis, byte for byte').toBe(c.served_why);
      }
    });
  }
  it('CONTRAST: no row, no science (a selection with no slot 1 carries nothing)', () => {
    expect(guidanceWireFor({} as never, null)).toBeUndefined();
  });
});
