/**
 * P1 READABILITY — the intake wall of text.
 *
 * `composeClarifyV2Response` joined its numbered questions with a SINGLE
 * SPACE, so the first thing a new user ever reads from Olumi was one
 * unbroken paragraph with "1." "2." "3." buried inside it. Paul's manual
 * test: the questions were there and nobody could see them.
 *
 * The fix is shape only — not one word of copy changes. These assertions
 * therefore bind to STRUCTURE (line membership, ordering, blank-line
 * separation) rather than to wording, so a future copy edit does not have to
 * come back here, and a regression to `.join(' ')` cannot pass.
 */
import { describe, expect, it } from 'vitest';

import { composeClarifyV2Response } from '../preflight.js';
import type { ClarifyQuestion } from '../questions.js';

function q(text: string, impact: string, dimension: ClarifyQuestion['dimension']): ClarifyQuestion {
  return { dimension, text, impact, candidates: [] };
}

const THREE: readonly ClarifyQuestion[] = [
  q('What is the deadline?', 'changes how much risk is worth taking', 'timeframe'),
  q('What is the budget?', 'sets the ceiling on every option', 'quantities'),
  q('Who decides?', 'determines what evidence will land', 'options'),
];

describe('B — each numbered question gets its own line', () => {
  it('the three questions are on THREE DISTINCT lines, in order', () => {
    const text = composeClarifyV2Response(THREE, 'initial').assistant_text;
    const lines = text.split('\n');

    const idx1 = lines.findIndex((l) => l.startsWith('1. '));
    const idx2 = lines.findIndex((l) => l.startsWith('2. '));
    const idx3 = lines.findIndex((l) => l.startsWith('3. '));

    // Present…
    expect(idx1).toBeGreaterThanOrEqual(0);
    expect(idx2).toBeGreaterThanOrEqual(0);
    expect(idx3).toBeGreaterThanOrEqual(0);
    // …distinct (this is the assertion `.join(' ')` cannot satisfy: all three
    // markers landed on ONE line)…
    expect(new Set([idx1, idx2, idx3]).size).toBe(3);
    // …and in reading order.
    expect(idx1).toBeLessThan(idx2);
    expect(idx2).toBeLessThan(idx3);
  });

  it('a numbered line carries EXACTLY ONE question — bound by identity to its own text', () => {
    const lines = composeClarifyV2Response(THREE, 'initial').assistant_text.split('\n');
    const line1 = lines.find((l) => l.startsWith('1. '))!;
    const line2 = lines.find((l) => l.startsWith('2. '))!;

    expect(line1).toContain('What is the deadline?');
    // The discriminating half: question 2's text must NOT be on question 1's
    // line. A value predicate ("contains a question mark") would pass on the
    // wall of text; this binds to the specific question.
    expect(line1).not.toContain('What is the budget?');
    expect(line2).toContain('What is the budget?');
    expect(line2).not.toContain('What is the deadline?');
  });

  it('the impact clause stays with its own question on the same line', () => {
    const lines = composeClarifyV2Response(THREE, 'initial').assistant_text.split('\n');
    const line2 = lines.find((l) => l.startsWith('2. '))!;
    expect(line2).toContain('sets the ceiling on every option');
  });

  it('lead and tail are separated from the list by a blank line', () => {
    const text = composeClarifyV2Response(THREE, 'initial').assistant_text;
    const lines = text.split('\n');
    const idx1 = lines.findIndex((l) => l.startsWith('1. '));
    const idx3 = lines.findIndex((l) => l.startsWith('3. '));

    // Lead sits above the list, with a blank line between.
    expect(idx1).toBeGreaterThanOrEqual(2);
    expect(lines[idx1 - 1]).toBe('');
    expect(lines[0]).toContain('Before I draft the model');
    // Tail sits below the list, with a blank line between.
    expect(lines[idx3 + 1]).toBe('');
    expect(lines[lines.length - 1]).toContain('go ahead');
  });

  it('COPY IS UNCHANGED — every token of the old single-line text is still present', () => {
    // The fix is shape only. Collapsing the new text's whitespace must
    // reproduce exactly what the old `.join(' ')` produced, so this pins that
    // no wording was smuggled in alongside the layout change.
    const text = composeClarifyV2Response(THREE, 'initial').assistant_text;
    const collapsed = text.replace(/\s+/g, ' ').trim();
    expect(collapsed).toBe(
      'Before I draft the model, a few quick questions will make it sharper. '
        + '1. What is the deadline? (changes how much risk is worth taking) '
        + '2. What is the budget? (sets the ceiling on every option) '
        + '3. Who decides? (determines what evidence will land) '
        + 'Answer whichever matters most — tap an option below or type your own — '
        + "or say “go ahead” and I'll draft now, filling any gaps with my own assumptions.",
    );
  });

  it('the single-question case gets the same shape (no special-casing regression)', () => {
    const text = composeClarifyV2Response([THREE[0]!], 'initial').assistant_text;
    const lines = text.split('\n');
    const idx1 = lines.findIndex((l) => l.startsWith('1. '));
    expect(idx1).toBeGreaterThanOrEqual(2);
    expect(lines[idx1 - 1]).toBe('');
    expect(lines[idx1 + 1]).toBe('');
  });
});

describe('B — nothing downstream collapses the newlines', () => {
  it('the shape SURVIVES the V5 egress chokepoint every exit path funnels through', async () => {
    // The brief's "confirm nothing downstream collapses newlines" obligation,
    // discharged against the REAL downstream rather than against a module this
    // path may not even use. `composeClarifyV2Response`'s response ships via
    // `sendFinalised200` -> `sanitiseOlumiResponseForEgress`, so that is the
    // pass that would eat the layout if any pass did.
    const { sanitiseOlumiResponseForEgress } = await import('../../compose/output-safety.js');
    const response = composeClarifyV2Response(THREE, 'initial');

    const out = sanitiseOlumiResponseForEgress(response, {
      graph: null,
      requestId: 'req_test',
      exitPath: 'test',
      userMessage: null,
      mayNameLeadingOption: true,
    });

    // PRECONDITION PIN — the input genuinely carries the newlines under test,
    // so a GREEN here cannot come from a fixture that never had them.
    expect(response.assistant_text.split('\n').length).toBeGreaterThan(4);
    expect(out.assistant_text).toBe(response.assistant_text);
  });
});
